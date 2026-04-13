import assert from "node:assert/strict";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { loadProviderGatewayConfig } from "@persai/config";
import { ProviderBrowserService } from "../src/modules/providers/provider-browser.service";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

class FakePersaiInternalApiClientService {
  secretIds: string[] = [];
  secretValue = "browserless-secret";

  async resolveSecretValue(secretId: string): Promise<string> {
    this.secretIds.push(secretId);
    return this.secretValue;
  }
}

export async function runProviderBrowserServiceTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(init === undefined ? { url } : { url, init });
    return new Response(
      JSON.stringify({
        type: "application/json",
        data: {
          initialUrl: "https://example.com/",
          finalUrl: "https://example.com/final",
          title: "Example page",
          content: "Rendered browser content",
          truncated: false,
          elements: [
            {
              selector: "#search",
              tagName: "input",
              text: null,
              role: null,
              type: "search",
              href: null,
              placeholder: "Search",
              disabled: false
            }
          ]
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
    const internalApi = new FakePersaiInternalApiClientService();
    const service = new ProviderBrowserService(
      loadProviderGatewayConfig({
        APP_ENV: "local",
        PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
        PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
        PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://browserless.example.com",
        PERSAI_API_BASE_URL: "http://api.local",
        PERSAI_INTERNAL_API_TOKEN: "internal-token"
      }),
      internalApi as unknown as PersaiInternalApiClientService
    );

    const snapshotResult = await service.browserAction({
      action: "snapshot",
      url: "https://example.com",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      credential: {
        toolCode: "browser",
        secretId: "secret-1",
        providerId: null
      }
    });
    assert.equal(internalApi.secretIds[0], "secret-1");
    assert.equal(
      requests[0]?.url,
      "https://browserless.example.com/function?token=browserless-secret"
    );
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(
      (requests[0]?.init?.headers as Record<string, string>)?.["Content-Type"],
      "application/json"
    );
    const snapshotBody = JSON.parse(String(requests[0]?.init?.body ?? "{}")) as {
      code?: string;
      context?: {
        url?: string;
        action?: string;
        operations?: unknown[];
        maxChars?: number;
        timeoutMs?: number;
      };
    };
    assert.match(snapshotBody.code ?? "", /page\.goto/);
    assert.deepEqual(snapshotBody.context, {
      url: "https://example.com/",
      action: "snapshot",
      operations: [],
      maxChars: 12000,
      timeoutMs: 120000
    });
    assert.equal(snapshotResult.provider, "browserless");
    assert.equal(snapshotResult.action, "snapshot");
    assert.equal(snapshotResult.finalUrl, "https://example.com/final");
    assert.equal(snapshotResult.title, "Example page");
    assert.equal(snapshotResult.content, "Rendered browser content");
    assert.equal(snapshotResult.elements[0]?.selector, "#search");
    assert.match(snapshotResult.warning ?? "", /Browser-rendered page content is untrusted/);
    assert.deepEqual(snapshotResult.externalContent, {
      untrusted: true,
      source: "browser",
      provider: "browserless"
    });

    await service.browserAction({
      action: "act",
      url: "https://example.com",
      maxChars: 5000,
      operations: [
        {
          kind: "click",
          selector: "#open-menu"
        },
        {
          kind: "wait_for_timeout",
          timeoutMs: 250
        }
      ],
      timeoutMs: 30000,
      credential: {
        toolCode: "browser",
        secretId: "secret-2",
        providerId: "browserless"
      }
    });
    const actBody = JSON.parse(String(requests[1]?.init?.body ?? "{}")) as {
      context?: {
        action?: string;
        operations?: Array<Record<string, unknown>>;
        maxChars?: number;
        timeoutMs?: number;
      };
    };
    assert.equal(internalApi.secretIds[1], "secret-2");
    assert.equal(actBody.context?.action, "act");
    assert.equal(actBody.context?.maxChars, 5000);
    assert.equal(actBody.context?.timeoutMs, 30000);
    assert.deepEqual(actBody.context?.operations, [
      {
        kind: "click",
        selector: "#open-menu"
      },
      {
        kind: "wait_for_timeout",
        timeoutMs: 250
      }
    ]);

    await assert.rejects(
      () =>
        service.browserAction({
          action: "snapshot",
          url: "https://example.com",
          maxChars: null,
          operations: [
            {
              kind: "click",
              selector: "#should-fail"
            }
          ],
          timeoutMs: null,
          credential: {
            toolCode: "browser",
            secretId: "secret-3",
            providerId: "browserless"
          }
        }),
      BadRequestException
    );

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "browserless exploded"
          }
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;
    await assert.rejects(
      () =>
        service.browserAction({
          action: "snapshot",
          url: "https://example.com",
          maxChars: null,
          operations: [],
          timeoutMs: null,
          credential: {
            toolCode: "browser",
            secretId: "secret-4",
            providerId: "browserless"
          }
        }),
      BadGatewayException
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
