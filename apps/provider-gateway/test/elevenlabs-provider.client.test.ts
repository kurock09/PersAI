import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import {
  createDefaultTtsDeliveryIntent,
  type ProviderGatewaySpeechGenerateRequest
} from "@persai/runtime-contract";
import { ElevenLabsProviderClient } from "../src/modules/providers/elevenlabs/elevenlabs-provider.client";

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

function createRequest(
  overrides?: Partial<ProviderGatewaySpeechGenerateRequest>
): ProviderGatewaySpeechGenerateRequest {
  return {
    text: "Привет, это голосовой ответ.",
    locale: "ru-RU",
    toneTag: "warm",
    delivery: { ...createDefaultTtsDeliveryIntent(), delivery: "whisper" },
    deliveryKind: "voice_note",
    assistantGender: "female",
    traits: { warmth: 80, formality: 45, playfulness: 30 },
    voiceProfile: {
      schema: "persai.assistantVoiceProfile.v1",
      defaultLocale: "ru-RU",
      deliveryKind: "voice_note",
      elevenlabs: { voiceId: "voice-eleven" },
      yandex: { voice: "jane", role: null },
      openai: { voice: "marin" }
    },
    credential: {
      toolCode: "tts",
      secretId: "tool/tts/elevenlabs",
      providerId: "elevenlabs"
    },
    ...overrides
  };
}

export async function runElevenLabsProviderClientTest(): Promise<void> {
  const client = new ElevenLabsProviderClient(createConfig());
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(Buffer.from("eleven-audio"), {
      status: 200,
      headers: { "Content-Type": "audio/ogg" }
    });
  }) as typeof fetch;

  try {
    // Default (no modelKey) uses eleven_v3 and compiles structured delivery.
    const v3Result = await client.generateSpeech(createRequest(), { apiKey: "eleven-test-key" });
    assert.equal(v3Result.model, "eleven_v3");
    assert.equal(v3Result.billingFacts?.modelKey, "eleven_v3");
    const v3Body = requests[0]?.body;
    assert.equal(v3Body?.model_id, "eleven_v3");
    assert.equal(typeof v3Body?.text === "string" && v3Body.text.startsWith("[whispers]"), true);
    // v3 keeps voice_settings minimal: no language_code, discrete stability + boost.
    assert.equal("language_code" in (v3Body ?? {}), false);
    const v3Settings = (v3Body?.voice_settings ?? {}) as Record<string, unknown>;
    assert.equal(v3Settings.use_speaker_boost, true);
    assert.equal(typeof v3Settings.stability, "number");

    // Non-v3 catalog model keeps the legacy full voice_settings + language_code.
    requests.length = 0;
    const legacyResult = await client.generateSpeech(
      createRequest({
        credential: {
          toolCode: "tts",
          secretId: "tool/tts/elevenlabs",
          providerId: "elevenlabs",
          modelKey: "eleven_multilingual_v2"
        }
      }),
      { apiKey: "eleven-test-key" }
    );
    assert.equal(legacyResult.model, "eleven_multilingual_v2");
    const legacyBody = requests[0]?.body;
    assert.equal(legacyBody?.model_id, "eleven_multilingual_v2");
    assert.equal("language_code" in (legacyBody ?? {}), true);
    // Legacy path does not prepend compiled audio tags.
    assert.equal(
      typeof legacyBody?.text === "string" && legacyBody.text.startsWith("[whispers]"),
      false
    );
    const legacySettings = (legacyBody?.voice_settings ?? {}) as Record<string, unknown>;
    assert.equal(typeof legacySettings.style, "number");
    assert.equal(typeof legacySettings.speed, "number");

    // Missing saved voice id is rejected.
    await assert.rejects(
      () =>
        client.generateSpeech(
          createRequest({
            voiceProfile: {
              schema: "persai.assistantVoiceProfile.v1",
              defaultLocale: "ru-RU",
              deliveryKind: "voice_note",
              elevenlabs: { voiceId: null },
              yandex: { voice: "jane", role: null },
              openai: { voice: "marin" }
            }
          }),
          { apiKey: "eleven-test-key" }
        ),
      /requires a saved voice ID/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
