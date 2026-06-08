import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import { isPersaiRuntimeYandexRoleAllowedForVoice } from "@persai/runtime-contract";
import type {
  ProviderGatewaySpeechGenerateRequest,
  RuntimeBillingFacts,
  ProviderGatewaySpeechGenerateResult
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

const YANDEX_TTS_API_URL = "https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis";
const YANDEX_SPEECH_MODEL = "speechkit-v3";

@Injectable()
export class YandexProviderClient {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest,
    options: { apiKey: string }
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await fetch(YANDEX_TTS_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: input.text,
          unsafeMode: true,
          outputAudioSpec: {
            containerAudio: {
              containerAudioType: input.deliveryKind === "voice_note" ? "OGG_OPUS" : "MP3"
            }
          },
          hints: this.buildHints(input)
        }),
        signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          this.extractErrorMessage(errorBody) ??
            `Yandex SpeechKit generation failed with status ${String(response.status)}.`
        );
      }

      const responseBody = await response.text();
      const bytesBase64 = this.extractAudioBase64FromResponseBody(responseBody);
      if (bytesBase64 === null) {
        throw new Error("Yandex SpeechKit did not return a supported audio payload.");
      }

      return {
        provider: "yandex",
        model: YANDEX_SPEECH_MODEL,
        deliveryKind: input.deliveryKind,
        bytesBase64,
        mimeType: input.deliveryKind === "voice_note" ? "audio/ogg" : "audio/mpeg",
        respondedAt: new Date().toISOString(),
        usage: null,
        billingFacts: this.buildBillingFacts(input),
        warning: null
      };
    } finally {
      dispose();
    }
  }

  private buildHints(
    input: ProviderGatewaySpeechGenerateRequest
  ): Array<Record<string, string | number>> {
    const voice = input.voiceProfile.yandex.voice ?? "jane";
    const hints: Array<Record<string, string | number>> = [
      { voice },
      { speed: this.resolveSpeed(input) }
    ];
    if (
      input.voiceProfile.yandex.role &&
      isPersaiRuntimeYandexRoleAllowedForVoice({
        voice,
        role: input.voiceProfile.yandex.role
      })
    ) {
      hints.push({ role: input.voiceProfile.yandex.role });
    }
    return hints;
  }

  private extractAudioBase64FromResponseBody(rawBody: string): string | null {
    const payloads = this.parseResponsePayloads(rawBody);
    const chunks = payloads
      .map((payload) => this.extractAudioBase64(payload))
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .map((entry) => Buffer.from(entry, "base64"));
    return chunks.length > 0 ? Buffer.concat(chunks).toString("base64") : null;
  }

  private parseResponsePayloads(rawBody: string): unknown[] {
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return [];
    }
    try {
      return [JSON.parse(trimmed) as unknown];
    } catch {
      const payloads: unknown[] = [];
      for (const line of trimmed.split(/\r?\n/)) {
        const normalized = line.trim();
        if (normalized.length === 0) {
          continue;
        }
        payloads.push(JSON.parse(normalized) as unknown);
      }
      return payloads;
    }
  }

  private resolveSpeed(input: ProviderGatewaySpeechGenerateRequest): number {
    const toneBase = (() => {
      switch (input.toneTag) {
        case "gentle":
        case "calm":
          return 0.92;
        case "cheerful":
          return 1.04;
        case "playful":
          return 1.08;
        case "confident":
          return 1.01;
        case "warm":
          return 0.98;
        case "neutral":
        default:
          return 1;
      }
    })();
    const playfulness =
      typeof input.traits?.playfulness === "number" ? input.traits.playfulness : 50;
    return this.clampRange(toneBase + (playfulness - 50) / 500, 0.85, 1.15);
  }

  private extractAudioBase64(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const directCandidates = [record.audioContent, record.data, record.audio];
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    const chunk = record.audioChunk;
    if (chunk && typeof chunk === "object") {
      const data = (chunk as Record<string, unknown>).data;
      if (typeof data === "string" && data.trim().length > 0) {
        return data.trim();
      }
    }

    const result = record.result;
    if (result && typeof result === "object") {
      return this.extractAudioBase64(result);
    }

    const chunks = record.chunks;
    if (Array.isArray(chunks)) {
      const combined = chunks
        .map((entry) => this.extractAudioBase64(entry))
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .map((entry) => Buffer.from(entry, "base64"));
      return combined.length > 0 ? Buffer.concat(combined).toString("base64") : null;
    }

    return null;
  }

  private extractErrorMessage(rawBody: string): string | null {
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const messageCandidates = [parsed.message, parsed.description, parsed.error];
      for (const candidate of messageCandidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate.trim();
        }
      }
      const details = parsed.details;
      if (Array.isArray(details) && details.length > 0) {
        const first = details[0];
        if (first && typeof first === "object") {
          const detailMessage = (first as Record<string, unknown>).message;
          if (typeof detailMessage === "string" && detailMessage.trim().length > 0) {
            return detailMessage.trim();
          }
        }
      }
    } catch {
      // Fall back to the raw response body.
    }
    return trimmed;
  }

  private createTimedSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timeoutId)
    };
  }

  private clampRange(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private buildBillingFacts(input: ProviderGatewaySpeechGenerateRequest): RuntimeBillingFacts {
    return {
      providerKey: "yandex",
      modelKey: YANDEX_SPEECH_MODEL,
      capability: "text_to_speech",
      occurredAt: new Date().toISOString(),
      metering: {
        meteringKind: "text_chars_metered",
        textChars: input.text.length
      }
    };
  }
}
