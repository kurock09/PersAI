import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type { ProviderGatewayVideoGenerateRequest } from "@persai/runtime-contract";
import { KlingProviderClient } from "../src/modules/providers/kling/kling-provider.client";

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

function createRequest(): ProviderGatewayVideoGenerateRequest {
  return {
    prompt: "Animate a calm paper-cut forest at sunrise",
    model: "kling-v3",
    size: "1280x720",
    seconds: 4,
    referenceImage: {
      bytesBase64: "cmVmLXZpZGVvLWltYWdl",
      mimeType: "image/png",
      filename: "forest.png"
    },
    credential: {
      toolCode: "video_generate",
      secretId: "tool/video_generate/kling/api-key",
      providerId: "kling"
    },
    providerParameters: {
      mode: "pro",
      sound: "off"
    }
  };
}

export async function runKlingProviderClientTest(): Promise<void> {
  const client = new KlingProviderClient(createConfig());
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const credentialValue = JSON.stringify({
    accessKey: "kling-ak",
    secretKey: "kling-sk"
  });

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      requests.push({ url });
    } else {
      requests.push({ url, init });
    }
    if (url === "https://api-singapore.klingai.com/v1/videos/image2video") {
      const authHeader = (init?.headers as Record<string, string>)["Authorization"];
      assert.match(authHeader ?? "", /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        model_name: "kling-v3",
        prompt: "Animate a calm paper-cut forest at sunrise",
        image: "cmVmLXZpZGVvLWltYWdl",
        duration: "4",
        aspect_ratio: "16:9",
        negative_prompt: "",
        mode: "pro",
        sound: "off"
      });
      return new Response(
        JSON.stringify({
          code: 0,
          data: { task_id: "task_kling_1" }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "https://api-singapore.klingai.com/v1/videos/image2video/task_kling_1") {
      const pollCount = requests.filter(
        (entry) =>
          entry.url === "https://api-singapore.klingai.com/v1/videos/image2video/task_kling_1"
      ).length;
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { task_status: "processing" }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            task_status: "succeed",
            task_result: {
              videos: [{ url: "https://cdn.klingai.com/result.mp4", duration: "4", id: "video-1" }]
            }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "https://cdn.klingai.com/result.mp4") {
      return new Response(Buffer.from("kling-video"), {
        status: 200,
        headers: { "Content-Type": "video/mp4" }
      });
    }
    throw new Error(`Unexpected fetch URL in Kling provider client test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await client.generateVideo(createRequest(), { credentialValue });
    assert.equal(result.provider, "kling");
    assert.equal(result.model, "kling-v3");
    assert.equal(result.video.bytesBase64, Buffer.from("kling-video").toString("base64"));
    assert.deepEqual(result.billingFacts, {
      providerKey: "kling",
      modelKey: "kling-v3",
      capability: "video",
      occurredAt: result.billingFacts?.occurredAt,
      metering: {
        meteringKind: "time_metered",
        durationMs: 4000,
        durationSeconds: 4
      }
    });

    await assert.rejects(
      () => client.generateVideo(createRequest(), { credentialValue: "not-json" }),
      /must be valid JSON/i
    );

    await assert.rejects(
      () =>
        client.generateVideo(createRequest(), {
          credentialValue: JSON.stringify({ access_key: "kling-ak" })
        }),
      /accessKey.*secretKey/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
