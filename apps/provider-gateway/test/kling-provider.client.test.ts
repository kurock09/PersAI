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
    model: "kling-3.0/video",
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
    }
  };
}

export async function runKlingProviderClientTest(): Promise<void> {
  const client = new KlingProviderClient(createConfig());
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
    if (url === "https://kieai.redpandaai.co/api/file-stream-upload") {
      assert.equal((init?.headers as Record<string, string>)["Authorization"], "Bearer kling-key");
      assert.ok(init?.body instanceof FormData);
      const formData = init.body as FormData;
      assert.equal(formData.get("uploadPath"), "images/persai-video");
      assert.equal(formData.get("fileName"), "forest.png");
      assert.ok(formData.get("file") instanceof Blob);
      return new Response(
        JSON.stringify({
          success: true,
          code: 200,
          msg: "File uploaded successfully",
          data: {
            downloadUrl: "https://tempfile.redpandaai.co/kling/forest.png"
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "https://api.kie.ai/api/v1/jobs/createTask") {
      assert.equal((init?.headers as Record<string, string>)["Authorization"], "Bearer kling-key");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        model: "kling-3.0/video",
        input: {
          prompt: "Animate a calm paper-cut forest at sunrise",
          image_urls: ["https://tempfile.redpandaai.co/kling/forest.png"],
          sound: false,
          duration: "4",
          aspect_ratio: "16:9",
          mode: "pro",
          multi_shots: false,
          multi_prompt: []
        }
      });
      return new Response(
        JSON.stringify({
          code: 200,
          msg: "success",
          data: { taskId: "task_kling_1" }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_kling_1") {
      const pollCount = requests.filter(
        (entry) => entry.url === "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_kling_1"
      ).length;
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({
            code: 200,
            msg: "success",
            data: { state: "generating" }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response(
        JSON.stringify({
          code: 200,
          msg: "success",
          data: {
            state: "success",
            resultJson: JSON.stringify({
              resultUrls: ["https://tempfile.redpandaai.co/kling/result.mp4"]
            })
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "https://tempfile.redpandaai.co/kling/result.mp4") {
      return new Response(Buffer.from("kling-video"), {
        status: 200,
        headers: { "Content-Type": "video/mp4" }
      });
    }
    throw new Error(`Unexpected fetch URL in Kling provider client test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await client.generateVideo(createRequest(), { apiKey: "kling-key" });
    assert.equal(result.provider, "kling");
    assert.equal(result.model, "kling-3.0/video");
    assert.equal(result.video.bytesBase64, Buffer.from("kling-video").toString("base64"));
    assert.deepEqual(result.billingFacts, {
      providerKey: "kling",
      modelKey: "kling-3.0/video",
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
