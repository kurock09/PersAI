import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  PersaiRuntimeYandexTtsRole,
  PersaiRuntimeYandexTtsVoice,
  ProviderGatewaySpeechGenerateRequest
} from "@persai/runtime-contract";
import { YandexProviderClient } from "../src/modules/providers/yandex/yandex-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(params: {
  voice: PersaiRuntimeYandexTtsVoice;
  role: PersaiRuntimeYandexTtsRole | null;
}): ProviderGatewaySpeechGenerateRequest {
  return {
    text: "Привет, это тест Yandex TTS.",
    locale: "ru-RU",
    toneTag: "warm",
    deliveryKind: "voice_note",
    assistantGender: "female",
    traits: {
      warmth: 80,
      formality: 45,
      playfulness: 30
    },
    voiceProfile: {
      schema: "persai.assistantVoiceProfile.v1",
      defaultLocale: "ru-RU",
      deliveryKind: "voice_note",
      elevenlabs: {
        voiceId: null
      },
      yandex: {
        voice: params.voice,
        role: params.role
      },
      openai: {
        voice: "marin"
      }
    },
    credential: {
      toolCode: "tts",
      secretId: "tool/tts/yandex",
      providerId: "yandex"
    }
  };
}

export async function runYandexProviderClientTest(): Promise<void> {
  const client = new YandexProviderClient(createConfig());
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(init === undefined ? { url } : { url, init });
    return new Response(
      JSON.stringify({
        result: {
          audioChunk: {
            data: Buffer.from("yandex-audio").toString("base64")
          }
        }
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  try {
    await client.generateSpeech(createRequest({ voice: "jane", role: "friendly" }), {
      apiKey: "yandex-test-key"
    });
    const unsupportedPayload = JSON.parse(String(requests[0]?.init?.body ?? "{}")) as {
      hints?: Array<Record<string, string | number>>;
    };
    assert.equal(
      Boolean(
        unsupportedPayload.hints?.some((hint) => Object.prototype.hasOwnProperty.call(hint, "role"))
      ),
      false
    );

    requests.length = 0;

    await client.generateSpeech(createRequest({ voice: "masha", role: "friendly" }), {
      apiKey: "yandex-test-key"
    });
    const supportedPayload = JSON.parse(String(requests[0]?.init?.body ?? "{}")) as {
      hints?: Array<Record<string, string | number>>;
    };
    assert.equal(Boolean(supportedPayload.hints?.some((hint) => hint.role === "friendly")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
