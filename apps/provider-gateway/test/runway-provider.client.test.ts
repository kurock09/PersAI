import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type { ProviderGatewayVideoGenerateRequest } from "@persai/runtime-contract";
import { RunwayProviderClient } from "../src/modules/providers/runway/runway-provider.client";

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
    model: "gen4.5",
    size: "1280x720",
    seconds: 4,
    referenceImage: {
      bytesBase64: "cmVmLXZpZGVvLWltYWdl",
      mimeType: "image/png",
      filename: "forest.png"
    },
    credential: {
      toolCode: "video_generate",
      secretId: "tool/video_generate/runway/api-key",
      providerId: "runway"
    }
  };
}

export async function runRunwayProviderClientTest(): Promise<void> {
  const client = new RunwayProviderClient(createConfig());
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      requests.push({ url });
    } else {
      requests.push({ url, init });
    }
    if (url === "https://api.dev.runwayml.com/v1/image_to_video") {
      assert.equal((init?.headers as Record<string, string>)["Authorization"], "Bearer runway-key");
      assert.equal((init?.headers as Record<string, string>)["X-Runway-Version"], "2024-11-06");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        model: "gen4.5",
        promptText: "Animate a calm paper-cut forest at sunrise",
        promptImage: "data:image/png;base64,cmVmLXZpZGVvLWltYWdl",
        ratio: "1280:720",
        duration: 4
      });
      return new Response(JSON.stringify({ id: "rw-task-1", status: "PENDING" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url === "https://api.dev.runwayml.com/v1/tasks/rw-task-1") {
      const pollCount = requests.filter(
        (entry) => entry.url === "https://api.dev.runwayml.com/v1/tasks/rw-task-1"
      ).length;
      if (pollCount === 1) {
        return new Response(JSON.stringify({ status: "RUNNING" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({
          status: "SUCCEEDED",
          output: ["https://runway.example/output.mp4"]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "https://runway.example/output.mp4") {
      return new Response(Buffer.from("runway-video"), {
        status: 200,
        headers: { "Content-Type": "video/mp4" }
      });
    }
    throw new Error(`Unexpected fetch URL in Runway provider client test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await client.generateVideo(createRequest(), { apiKey: "runway-key" });
    assert.equal(result.provider, "runway");
    assert.equal(result.model, "gen4.5");
    assert.equal(result.video.bytesBase64, Buffer.from("runway-video").toString("base64"));
    assert.deepEqual(result.billingFacts, {
      providerKey: "runway",
      modelKey: "gen4.5",
      capability: "video",
      occurredAt: result.billingFacts?.occurredAt,
      metering: {
        meteringKind: "time_metered",
        durationMs: 4000,
        durationSeconds: 4
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}
