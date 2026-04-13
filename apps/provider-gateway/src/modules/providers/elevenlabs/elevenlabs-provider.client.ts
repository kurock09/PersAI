import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewaySpeechGenerateResult
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

@Injectable()
export class ElevenLabsProviderClient {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest,
    options: { apiKey: string }
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    const voiceId = input.voiceProfile.elevenlabs.voiceId?.trim() ?? "";
    if (voiceId.length === 0) {
      throw new Error("ElevenLabs requires a saved voice ID for this assistant.");
    }

    const outputFormat = input.deliveryKind === "voice_note" ? "opus_48000_64" : "mp3_44100_128";
    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await fetch(
        `${ELEVENLABS_API_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": options.apiKey
          },
          body: JSON.stringify({
            text: input.text,
            model_id: ELEVENLABS_MODEL_ID,
            language_code: this.resolveLanguageCode(input.locale),
            voice_settings: this.buildVoiceSettings(input)
          }),
          signal
        }
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          this.extractErrorMessage(errorBody) ??
            `ElevenLabs speech generation failed with status ${String(response.status)}.`
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error("ElevenLabs speech generation returned an empty audio payload.");
      }

      return {
        provider: "elevenlabs",
        model: ELEVENLABS_MODEL_ID,
        deliveryKind: input.deliveryKind,
        bytesBase64: buffer.toString("base64"),
        mimeType: input.deliveryKind === "voice_note" ? "audio/ogg" : "audio/mpeg",
        respondedAt: new Date().toISOString(),
        usage: null,
        warning: null
      };
    } finally {
      dispose();
    }
  }

  private buildVoiceSettings(input: ProviderGatewaySpeechGenerateRequest): Record<string, number> {
    const baseline = this.resolveToneBaseline(input.toneTag);
    const warmth = typeof input.traits?.warmth === "number" ? input.traits.warmth : 50;
    const playfulness =
      typeof input.traits?.playfulness === "number" ? input.traits.playfulness : 50;

    return {
      stability: this.clampUnit(baseline.stability - (warmth - 50) / 500),
      similarity_boost: this.clampUnit(baseline.similarityBoost),
      style: this.clampUnit(baseline.style + (playfulness - 50) / 400),
      speed: this.clampRange(baseline.speed + (playfulness - 50) / 500, 0.85, 1.12)
    };
  }

  private resolveToneBaseline(toneTag: ProviderGatewaySpeechGenerateRequest["toneTag"]): {
    stability: number;
    similarityBoost: number;
    style: number;
    speed: number;
  } {
    switch (toneTag) {
      case "warm":
        return { stability: 0.48, similarityBoost: 0.8, style: 0.32, speed: 0.98 };
      case "gentle":
        return { stability: 0.62, similarityBoost: 0.8, style: 0.16, speed: 0.93 };
      case "calm":
        return { stability: 0.72, similarityBoost: 0.78, style: 0.08, speed: 0.92 };
      case "cheerful":
        return { stability: 0.42, similarityBoost: 0.78, style: 0.44, speed: 1.03 };
      case "playful":
        return { stability: 0.36, similarityBoost: 0.76, style: 0.56, speed: 1.06 };
      case "confident":
        return { stability: 0.64, similarityBoost: 0.82, style: 0.18, speed: 1.01 };
      case "neutral":
      default:
        return { stability: 0.55, similarityBoost: 0.8, style: 0.14, speed: 1 };
    }
  }

  private resolveLanguageCode(locale: string): string | null {
    const trimmed = locale.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const [language] = trimmed.split("-");
    return language && language.length > 0 ? language : null;
  }

  private extractErrorMessage(rawBody: string): string | null {
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const detail = parsed.detail;
      if (typeof detail === "string" && detail.trim().length > 0) {
        return detail.trim();
      }
      if (Array.isArray(detail) && typeof detail[0] === "string" && detail[0].trim().length > 0) {
        return detail[0].trim();
      }
    } catch {
      // Fall back to raw body below.
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

  private clampUnit(value: number): number {
    return this.clampRange(value, 0, 1);
  }

  private clampRange(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
