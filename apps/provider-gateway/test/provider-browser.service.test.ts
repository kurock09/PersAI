import assert from "node:assert/strict";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { loadProviderGatewayConfig } from "@persai/config";
import { HostBrowserScriptRegistryService } from "../src/modules/providers/host-browser-script-registry.service";
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

function createProviderBrowserService(
  internalApi: FakePersaiInternalApiClientService
): ProviderBrowserService {
  return new ProviderBrowserService(
    loadProviderGatewayConfig({
      APP_ENV: "local",
      PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
      PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://browserless.example.com",
      PERSAI_API_BASE_URL: "http://api.local",
      PERSAI_INTERNAL_API_TOKEN: "internal-token"
    }),
    internalApi as unknown as PersaiInternalApiClientService,
    new HostBrowserScriptRegistryService()
  );
}

export async function runProviderBrowserServiceTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const sleepCalls: number[] = [];

  function recordRequest(input: URL | RequestInfo, init?: RequestInit): string {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(init === undefined ? { url } : { url, init });
    return url;
  }

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof timeout === "number" && timeout > 0 && timeout < 10_000) {
      sleepCalls.push(timeout);
      if (typeof handler === "function") {
        handler(...args);
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;

  try {
    const internalApi = new FakePersaiInternalApiClientService();
    const service = createProviderBrowserService(internalApi);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      recordRequest(input, init);
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
    const snapshotBody = JSON.parse(String(requests[0]?.init?.body ?? "{}")) as {
      code?: string;
      context?: {
        url?: string;
        action?: string;
        operations?: unknown[];
        maxChars?: number;
        timeoutMs?: number;
        format?: string;
        optimizeForSpeed?: boolean;
      };
    };
    assert.match(snapshotBody.code ?? "", /page\.goto/);
    assert.doesNotMatch(snapshotBody.code ?? "", /networkidle2/);
    assert.match(snapshotBody.code ?? "", /const waitUntil = "domcontentloaded"/);
    assert.match(snapshotBody.code ?? "", /settleAfterGotoMs/);
    assert.match(snapshotBody.code ?? "", /getClientRects\(\)\.length === 0/);
    assert.match(snapshotBody.code ?? "", /\.filter\(isVisibleInPage\)/);
    assert.match(snapshotBody.code ?? "", /takeRankedInteractiveElements/);
    assert.match(snapshotBody.code ?? "", /scoreInteractiveElement/);
    assert.match(snapshotBody.code ?? "", /\}, 200\);/);
    assert.deepEqual(snapshotBody.context, {
      url: "https://example.com/",
      action: "snapshot",
      operations: [],
      maxChars: 12000,
      timeoutMs: 45000,
      format: "text",
      optimizeForSpeed: false
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
        format?: string;
        optimizeForSpeed?: boolean;
      };
    };
    assert.equal(internalApi.secretIds[1], "secret-2");
    assert.equal(actBody.context?.action, "act");
    assert.equal(actBody.context?.maxChars, 5000);
    assert.equal(actBody.context?.timeoutMs, 30000);
    assert.equal(actBody.context?.format, "text");
    assert.equal(actBody.context?.optimizeForSpeed, false);
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
          action: "act",
          url: "https://example.com",
          maxChars: null,
          operations: [{ kind: "click", selector: "#x" }],
          timeoutMs: null,
          stayOnPage: true,
          credential: {
            toolCode: "browser",
            secretId: "secret-stay-on-page",
            providerId: "browserless"
          }
        }),
      BadRequestException
    );

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      recordRequest(input, init);
      if (requests.at(-1)?.url.includes("/pdf?")) {
        return new Response(Buffer.from("JVBERi0xLjQK", "base64"), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf"
          }
        });
      }
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://example.com/report",
            finalUrl: "https://example.com/report",
            title: "Report",
            content: "",
            truncated: false,
            elements: [],
            pdfBase64: "JVBERi0xLjQK"
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

    const pdfResult = await service.browserAction({
      action: "snapshot",
      url: "https://example.com/report",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      format: "pdf",
      credential: {
        toolCode: "browser",
        secretId: "secret-pdf",
        providerId: "browserless"
      }
    });
    assert.equal(requests[2]?.url, "https://browserless.example.com/pdf?token=browserless-secret");
    const pdfBody = JSON.parse(String(requests[2]?.init?.body ?? "{}")) as {
      url?: string;
      options?: { printBackground?: boolean };
      gotoOptions?: { waitUntil?: string };
    };
    assert.equal(pdfBody.url, "https://example.com/report");
    assert.equal(pdfBody.options?.printBackground, true);
    assert.equal(pdfBody.gotoOptions?.waitUntil, "domcontentloaded");
    assert.equal(pdfResult.pdfBase64, "JVBERi0xLjQK");
    assert.equal(pdfResult.artifactMimeType, "application/pdf");
    assert.deepEqual(pdfResult.elements, []);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      recordRequest(input, init);
      if (requests.at(-1)?.url.includes("/screenshot?")) {
        return new Response(Buffer.from("aGVsbG8td2VicA==", "base64"), {
          status: 200,
          headers: {
            "Content-Type": "image/webp"
          }
        });
      }
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://example.com/hero",
            finalUrl: "https://example.com/hero",
            title: "Hero",
            content: "",
            truncated: false,
            elements: [],
            artifactBase64: "aGVsbG8td2VicA==",
            artifactMimeType: "image/webp"
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

    const webpResult = await service.browserAction({
      action: "snapshot",
      url: "https://example.com/hero",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      format: "webp",
      credential: {
        toolCode: "browser",
        secretId: "secret-webp",
        providerId: "browserless"
      }
    });
    assert.equal(
      requests[3]?.url,
      "https://browserless.example.com/screenshot?token=browserless-secret"
    );
    const webpBody = JSON.parse(String(requests[3]?.init?.body ?? "{}")) as {
      url?: string;
      options?: { type?: string; quality?: number };
    };
    assert.equal(webpBody.url, "https://example.com/hero");
    assert.equal(webpBody.options?.type, "webp");
    assert.equal(webpBody.options?.quality, 80);
    assert.equal(webpResult.artifactBase64, "aGVsbG8td2VicA==");
    assert.equal(webpResult.artifactMimeType, "image/webp");

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      recordRequest(input, init);
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://example.com/",
            finalUrl: "https://example.com/",
            title: "Example",
            content: "Example content",
            truncated: false,
            elements: [],
            operationWarning:
              "Browser operation warnings: op_0 (click): Waiting for selector `#missing` failed: timeout 30000ms exceeded"
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

    const operationWarningResult = await service.browserAction({
      action: "act",
      url: "https://example.com",
      maxChars: null,
      operations: [
        {
          kind: "click",
          selector: "#missing"
        }
      ],
      timeoutMs: null,
      credential: {
        toolCode: "browser",
        secretId: "secret-op-warning",
        providerId: "browserless"
      }
    });
    assert.equal(operationWarningResult.title, "Example");
    assert.equal(operationWarningResult.finalUrl, "https://example.com/");
    assert.match(
      operationWarningResult.warning ?? "",
      /Browser-rendered page content is untrusted/
    );
    assert.match(
      operationWarningResult.warning ?? "",
      /Browser operation warnings: op_0 \(click\): Waiting for selector `#missing` failed/
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

    let rateLimitedAttempts = 0;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      recordRequest(input, init);
      rateLimitedAttempts += 1;
      if (rateLimitedAttempts < 3) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://example.com/",
            finalUrl: "https://example.com/final",
            title: "Example page",
            content: "Rendered browser content",
            truncated: false,
            elements: []
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const rateLimitedResult = await service.browserAction({
      action: "snapshot",
      url: "https://example.com",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      credential: {
        toolCode: "browser",
        secretId: "secret-rate-limit",
        providerId: "browserless"
      }
    });
    assert.equal(rateLimitedAttempts, 3);
    assert.equal(rateLimitedResult.title, "Example page");
    assert.deepEqual(sleepCalls.slice(0, 2), [1000, 2000]);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      recordRequest(input, init);
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://lavka.yandex.ru/",
            finalUrl: "https://lavka.yandex.ru/search?text=test",
            title: "Lavka",
            content: "search results",
            truncated: false,
            elements: [{ selector: "#generic", tagName: "button", disabled: false }]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    await service.browserAction({
      action: "snapshot",
      url: "https://lavka.yandex.ru/search?text=test",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      credential: {
        toolCode: "browser",
        secretId: "secret-lavka-host-script",
        providerId: null
      }
    });
    const lavkaFunctionBody = JSON.parse(String(requests.at(-1)?.init?.body ?? "{}")) as {
      context?: { hostPageScript?: string };
    };
    assert.match(lavkaFunctionBody.context?.hostPageScript ?? "", /product-card/);
    assert.match(lavkaFunctionBody.context?.hostPageScript ?? "", /add-spin-button/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}
