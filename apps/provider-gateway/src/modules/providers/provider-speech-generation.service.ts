import { BadRequestException, Injectable } from "@nestjs/common";
import {
  MAX_RUNTIME_TTS_TEXT_CHARS,
  PERSAI_RUNTIME_OPENAI_TTS_VOICES,
  PERSAI_RUNTIME_TTS_DEFAULT_LOCALE,
  PERSAI_RUNTIME_TTS_DELIVERY_KINDS,
  PERSAI_RUNTIME_TTS_PROVIDER_IDS,
  PERSAI_RUNTIME_TTS_TONE_TAGS,
  PERSAI_RUNTIME_YANDEX_TTS_ROLES,
  PERSAI_RUNTIME_YANDEX_TTS_VOICES,
  type PersaiRuntimeOpenAITtsVoice,
  type PersaiRuntimeTtsProviderId,
  type PersaiRuntimeYandexTtsRole,
  type PersaiRuntimeYandexTtsVoice,
  type ProviderGatewaySpeechGenerateRequest,
  type ProviderGatewaySpeechGenerateResult,
  type RuntimeAssistantVoiceProfile
} from "@persai/runtime-contract";
import { ElevenLabsProviderClient } from "./elevenlabs/elevenlabs-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { YandexProviderClient } from "./yandex/yandex-provider.client";

@Injectable()
export class ProviderSpeechGenerationService {
  constructor(
    private readonly elevenLabsProviderClient: ElevenLabsProviderClient,
    private readonly yandexProviderClient: YandexProviderClient,
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    const normalized = this.normalizeInput(input);
    const apiKey = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId) {
      case "elevenlabs":
        return this.elevenLabsProviderClient.generateSpeech(normalized, { apiKey });
      case "yandex":
        return this.yandexProviderClient.generateSpeech(normalized, { apiKey });
      case "openai":
        return this.openaiProviderClient.generateSpeech(normalized, { apiKey });
    }
  }

  private normalizeInput(
    input: ProviderGatewaySpeechGenerateRequest
  ): ProviderGatewaySpeechGenerateRequest & {
    credential: ProviderGatewaySpeechGenerateRequest["credential"] & {
      providerId: PersaiRuntimeTtsProviderId;
    };
    voiceProfile: RuntimeAssistantVoiceProfile;
    traits: Record<string, number> | null;
  } {
    if (typeof input.text !== "string" || input.text.trim().length === 0) {
      throw new BadRequestException("text must be a non-empty string");
    }
    if (input.text.trim().length > MAX_RUNTIME_TTS_TEXT_CHARS) {
      throw new BadRequestException(
        `text must be at most ${String(MAX_RUNTIME_TTS_TEXT_CHARS)} characters`
      );
    }
    if (typeof input.locale !== "string" || input.locale.trim().length === 0) {
      throw new BadRequestException("locale must be a non-empty string");
    }
    if (!PERSAI_RUNTIME_TTS_TONE_TAGS.includes(input.toneTag)) {
      throw new BadRequestException("toneTag must be a supported TTS tone");
    }
    if (!PERSAI_RUNTIME_TTS_DELIVERY_KINDS.includes(input.deliveryKind)) {
      throw new BadRequestException("deliveryKind must be a supported TTS delivery kind");
    }
    if (input.credential.toolCode !== "tts") {
      throw new BadRequestException('credential.toolCode must be "tts"');
    }
    if (
      typeof input.credential.secretId !== "string" ||
      input.credential.secretId.trim().length === 0
    ) {
      throw new BadRequestException("credential.secretId must be a non-empty string");
    }
    if (
      input.credential.providerId === null ||
      !PERSAI_RUNTIME_TTS_PROVIDER_IDS.includes(input.credential.providerId)
    ) {
      throw new BadRequestException("credential.providerId must be a supported TTS provider");
    }

    return {
      text: input.text.trim(),
      locale: input.locale.trim(),
      toneTag: input.toneTag,
      deliveryKind: input.deliveryKind,
      assistantGender:
        typeof input.assistantGender === "string" && input.assistantGender.trim().length > 0
          ? input.assistantGender.trim()
          : null,
      traits: this.normalizeTraits(input.traits),
      voiceProfile: this.normalizeVoiceProfile(input.voiceProfile),
      credential: {
        toolCode: "tts",
        secretId: input.credential.secretId.trim(),
        providerId: input.credential.providerId
      }
    };
  }

  private normalizeVoiceProfile(value: unknown): RuntimeAssistantVoiceProfile {
    const row = this.asObject(value);
    const elevenlabs = this.asObject(row?.elevenlabs);
    const yandex = this.asObject(row?.yandex);
    const openai = this.asObject(row?.openai);

    return {
      schema: "persai.assistantVoiceProfile.v1",
      defaultLocale:
        this.normalizeOptionalString(row?.defaultLocale) ?? PERSAI_RUNTIME_TTS_DEFAULT_LOCALE,
      deliveryKind: this.parseDeliveryKind(row?.deliveryKind) ?? "voice_note",
      elevenlabs: {
        voiceId: this.normalizeOptionalString(elevenlabs?.voiceId)
      },
      yandex: {
        voice: this.parseYandexVoice(yandex?.voice),
        role: this.parseYandexRole(yandex?.role)
      },
      openai: {
        voice: this.parseOpenAiVoice(openai?.voice)
      }
    };
  }

  private normalizeTraits(value: unknown): Record<string, number> | null {
    const row = this.asObject(value);
    if (row === null) {
      return null;
    }
    const entries = Object.entries(row)
      .filter(([, entryValue]) => typeof entryValue === "number" && Number.isFinite(entryValue))
      .map(([key, entryValue]) => [key, entryValue] as const);
    return entries.length > 0 ? (Object.fromEntries(entries) as Record<string, number>) : null;
  }

  private parseDeliveryKind(
    value: unknown
  ): ProviderGatewaySpeechGenerateRequest["deliveryKind"] | null {
    return typeof value === "string" &&
      PERSAI_RUNTIME_TTS_DELIVERY_KINDS.includes(
        value as ProviderGatewaySpeechGenerateRequest["deliveryKind"]
      )
      ? (value as ProviderGatewaySpeechGenerateRequest["deliveryKind"])
      : null;
  }

  private parseYandexVoice(value: unknown): PersaiRuntimeYandexTtsVoice | null {
    return typeof value === "string" &&
      PERSAI_RUNTIME_YANDEX_TTS_VOICES.includes(value as PersaiRuntimeYandexTtsVoice)
      ? (value as PersaiRuntimeYandexTtsVoice)
      : null;
  }

  private parseYandexRole(value: unknown): PersaiRuntimeYandexTtsRole | null {
    return typeof value === "string" &&
      PERSAI_RUNTIME_YANDEX_TTS_ROLES.includes(value as PersaiRuntimeYandexTtsRole)
      ? (value as PersaiRuntimeYandexTtsRole)
      : null;
  }

  private parseOpenAiVoice(value: unknown): PersaiRuntimeOpenAITtsVoice | null {
    return typeof value === "string" &&
      PERSAI_RUNTIME_OPENAI_TTS_VOICES.includes(value as PersaiRuntimeOpenAITtsVoice)
      ? (value as PersaiRuntimeOpenAITtsVoice)
      : null;
  }

  private normalizeOptionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
