import assert from "node:assert/strict";
import type {
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewaySpeechGenerateResult
} from "@persai/runtime-contract";
import { ProviderSpeechGenerationService } from "../src/modules/providers/provider-speech-generation.service";
import type { ElevenLabsProviderClient } from "../src/modules/providers/elevenlabs/elevenlabs-provider.client";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";
import type { YandexProviderClient } from "../src/modules/providers/yandex/yandex-provider.client";

function createRequest(
  providerId: ProviderGatewaySpeechGenerateRequest["credential"]["providerId"] = "openai"
): ProviderGatewaySpeechGenerateRequest {
  return {
    text: "Привет, это короткий голосовой ответ.",
    locale: "ru-RU",
    toneTag: "warm",
    deliveryKind: "voice_note",
    assistantGender: "female",
    traits: {
      warmth: 82,
      formality: 40,
      playfulness: 35
    },
    voiceProfile: {
      schema: "persai.assistantVoiceProfile.v1",
      defaultLocale: "ru-RU",
      deliveryKind: "voice_note",
      elevenlabs: {
        voiceId: "voice-eleven"
      },
      yandex: {
        voice: "jane",
        role: null
      },
      openai: {
        voice: "marin"
      }
    },
    credential: {
      toolCode: "tts",
      secretId: "tool/tts/provider-key",
      providerId
    }
  };
}

class FakeElevenLabsProviderClient {
  calls: Array<{ input: ProviderGatewaySpeechGenerateRequest; apiKey: string | undefined }> = [];

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      deliveryKind: input.deliveryKind,
      bytesBase64: Buffer.from("eleven").toString("base64"),
      mimeType: "audio/ogg",
      respondedAt: "2026-04-13T12:00:00.000Z",
      usage: null,
      warning: null
    };
  }
}

class FakeYandexProviderClient {
  calls: Array<{ input: ProviderGatewaySpeechGenerateRequest; apiKey: string | undefined }> = [];

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "yandex",
      model: "speechkit-v3",
      deliveryKind: input.deliveryKind,
      bytesBase64: Buffer.from("yandex").toString("base64"),
      mimeType: "audio/ogg",
      respondedAt: "2026-04-13T12:00:01.000Z",
      usage: null,
      warning: null
    };
  }
}

class FakeOpenAIProviderClient {
  calls: Array<{ input: ProviderGatewaySpeechGenerateRequest; apiKey: string | undefined }> = [];

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    this.calls.push({ input, apiKey: options?.apiKey });
    return {
      provider: "openai",
      model: "gpt-4o-mini-tts",
      deliveryKind: input.deliveryKind,
      bytesBase64: Buffer.from("openai").toString("base64"),
      mimeType: "audio/ogg",
      respondedAt: "2026-04-13T12:00:02.000Z",
      usage: null,
      warning: null
    };
  }
}

class FakePersaiInternalApiClientService {
  secretIds: string[] = [];

  async resolveSecretValue(secretId: string): Promise<string> {
    this.secretIds.push(secretId);
    return "resolved-tool-secret";
  }
}

export async function runProviderSpeechGenerationServiceTest(): Promise<void> {
  const elevenLabsProviderClient = new FakeElevenLabsProviderClient();
  const yandexProviderClient = new FakeYandexProviderClient();
  const openaiProviderClient = new FakeOpenAIProviderClient();
  const persaiInternalApiClientService = new FakePersaiInternalApiClientService();
  const service = new ProviderSpeechGenerationService(
    elevenLabsProviderClient as unknown as ElevenLabsProviderClient,
    yandexProviderClient as unknown as YandexProviderClient,
    openaiProviderClient as unknown as OpenAIProviderClient,
    persaiInternalApiClientService as unknown as PersaiInternalApiClientService
  );

  const openaiResult = await service.generateSpeech(createRequest("openai"));
  assert.equal(openaiResult.provider, "openai");
  assert.equal(openaiProviderClient.calls.length, 1);
  assert.equal(openaiProviderClient.calls[0]?.apiKey, "resolved-tool-secret");

  const elevenlabsResult = await service.generateSpeech(createRequest("elevenlabs"));
  assert.equal(elevenlabsResult.provider, "elevenlabs");
  assert.equal(elevenLabsProviderClient.calls.length, 1);

  const yandexResult = await service.generateSpeech(createRequest("yandex"));
  assert.equal(yandexResult.provider, "yandex");
  assert.equal(yandexProviderClient.calls.length, 1);

  assert.deepEqual(persaiInternalApiClientService.secretIds, [
    "tool/tts/provider-key",
    "tool/tts/provider-key",
    "tool/tts/provider-key"
  ]);

  await assert.rejects(
    () =>
      service.generateSpeech({
        ...createRequest("openai"),
        toneTag: "dramatic" as never
      }),
    /toneTag must be a supported TTS tone/
  );

  await assert.rejects(
    () =>
      service.generateSpeech({
        ...createRequest(null),
        credential: {
          ...createRequest(null).credential,
          providerId: null
        }
      }),
    /credential.providerId must be a supported TTS provider/
  );
}
