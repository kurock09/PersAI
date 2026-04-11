import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import {
  ProviderGatewayClientService,
  type ProviderGatewayDependencyReadiness
} from "../src/modules/turns/provider-gateway.client.service";

function createConfig(baseUrl: string | undefined = "http://provider-gateway.local"): RuntimeConfig {
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
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000
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

export async function runProviderGatewayClientServiceTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, "http://provider-gateway.local/ready");
    assert.equal(requests[1]?.url, "http://provider-gateway.local/api/v1/providers/generate-text");
    assert.equal(requests[1]?.init?.method, "POST");

    const unconfiguredService = new ProviderGatewayClientService(
      createUnconfiguredConfig()
    );
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
