import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import {
  ProviderGatewayClientService,
  type ProviderGatewayDependencyReadiness
} from "../src/modules/turns/provider-gateway.client.service";

function createConfig(
  baseUrl: string | undefined = "http://provider-gateway.local"
): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3012,
    LOG_LEVEL: "info",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 32,
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_BASE_URL: baseUrl,
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000
  };
}

function createUnconfiguredConfig(): RuntimeConfig {
  return {
    ...createConfig(),
    RUNTIME_PROVIDER_GATEWAY_BASE_URL: undefined
  };
}

function createGenerateTextRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "openai",
    model: "gpt-5.4",
    systemPrompt: "Be helpful.",
    messages: [
      {
        role: "user",
        content: "hello"
      }
    ]
  };
}

async function collectStreamEvents(
  generator: AsyncGenerator<ProviderGatewayTextStreamEvent>
): Promise<ProviderGatewayTextStreamEvent[]> {
  const events: ProviderGatewayTextStreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

export async function runProviderGatewayClientServiceTest(): Promise<void> {
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

    if (url.endsWith("/ready")) {
      const readiness: ProviderGatewayDependencyReadiness = {
        ready: true,
        providerCacheReady: true
      };
      return new Response(JSON.stringify(readiness), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.endsWith("/api/v1/providers/stream-text")) {
      return new Response(
        [
          JSON.stringify({
            type: "text_delta",
            delta: "generated",
            accumulatedText: "generated"
          }),
          JSON.stringify({
            type: "completed",
            result: {
              provider: "openai",
              model: "gpt-5.4",
              text: "generated text",
              respondedAt: "2026-04-11T12:00:01.000Z",
              usage: null
            }
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }

    const payload: ProviderGatewayTextGenerateResult = {
      provider: "openai",
      model: "gpt-5.4",
      text: "generated text",
      respondedAt: "2026-04-11T12:00:01.000Z",
      usage: null
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }) as typeof fetch;

  try {
    const service = new ProviderGatewayClientService(createConfig());
    const readiness = await service.getReadiness();
    assert.deepEqual(readiness, {
      ready: true,
      providerCacheReady: true
    });

    const result = await service.generateText(createGenerateTextRequest());
    assert.equal(result.text, "generated text");
    const stream = await service.streamText(createGenerateTextRequest());
    const streamEvents = await collectStreamEvents(stream);
    assert.equal(requests.length, 3);
    assert.equal(requests[0]?.url, "http://provider-gateway.local/ready");
    assert.equal(requests[1]?.url, "http://provider-gateway.local/api/v1/providers/generate-text");
    assert.equal(requests[1]?.init?.method, "POST");
    assert.deepEqual(
      streamEvents.map((event) => event.type),
      ["text_delta", "completed"]
    );
    assert.equal(requests[2]?.url, "http://provider-gateway.local/api/v1/providers/stream-text");
    assert.equal(requests[2]?.init?.method, "POST");

    const unconfiguredService = new ProviderGatewayClientService(createUnconfiguredConfig());
    const unconfiguredReadiness = await unconfiguredService.getReadiness();
    assert.deepEqual(unconfiguredReadiness, {
      ready: false,
      providerCacheReady: false
    });
    await assert.rejects(
      () => unconfiguredService.generateText(createGenerateTextRequest()),
      /base URL is not configured/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
