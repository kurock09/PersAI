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
        format?: string;
        optimizeForSpeed?: boolean;
      };
    };
    assert.match(snapshotBody.code ?? "", /page\.goto/);
    assert.deepEqual(snapshotBody.context, {
      url: "https://example.com/",
      action: "snapshot",
      operations: [],
      maxChars: 12000,
      timeoutMs: 120000,
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

    await service.browserAction({
      action: "snapshot",
      url: "https://example.com/fast",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      optimizeForSpeed: true,
      credential: {
        toolCode: "browser",
        secretId: "secret-speed",
        providerId: "browserless"
      }
    });
    const speedBody = JSON.parse(String(requests[2]?.init?.body ?? "{}")) as {
      code?: string;
      context?: { optimizeForSpeed?: boolean; format?: string };
    };
    assert.equal(speedBody.context?.optimizeForSpeed, true);
    assert.match(speedBody.code ?? "", /setRequestInterception/);
    assert.match(speedBody.code ?? "", /__persaiSpeedIntercept/);
    assert.match(speedBody.code ?? "", /domcontentloaded/);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
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
    const pdfBody = JSON.parse(String(requests[3]?.init?.body ?? "{}")) as {
      context?: { format?: string };
      code?: string;
    };
    assert.equal(pdfBody.context?.format, "pdf");
    assert.match(pdfBody.code ?? "", /page\.pdf/);
    assert.equal(pdfResult.pdfBase64, "JVBERi0xLjQK");
    assert.equal(pdfResult.artifactMimeType, "application/pdf");
    assert.deepEqual(pdfResult.elements, []);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://example.com/dashboard",
            finalUrl: "https://example.com/dashboard",
            title: "Dashboard",
            content: "",
            truncated: false,
            elements: [{ tag: "div", text: "should be dropped" }],
            artifactBase64: "aGVsbG8tcG5n",
            artifactMimeType: "image/png"
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

    const pngResult = await service.browserAction({
      action: "snapshot",
      url: "https://example.com/dashboard",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      format: "png",
      fullPage: true,
      credential: {
        toolCode: "browser",
        secretId: "secret-png",
        providerId: "browserless"
      }
    });
    const pngBody = JSON.parse(String(requests[4]?.init?.body ?? "{}")) as {
      context?: { format?: string; fullPage?: boolean };
      code?: string;
    };
    assert.equal(pngBody.context?.format, "png");
    assert.equal(pngBody.context?.fullPage, true);
    assert.match(pngBody.code ?? "", /page\.screenshot/);
    assert.equal(pngResult.artifactBase64, "aGVsbG8tcG5n");
    assert.equal(pngResult.artifactMimeType, "image/png");
    assert.deepEqual(pngResult.elements, []);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            initialUrl: "https://crm.example.com/",
            finalUrl: "https://crm.example.com/dashboard",
            title: "CRM",
            content: "Authenticated CRM content",
            truncated: false,
            elements: []
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

    await service.browserAction({
      action: "snapshot",
      url: "https://crm.example.com/dashboard",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      profileSessionId: "/reconnect/session-abc123",
      credential: {
        toolCode: "browser",
        secretId: "secret-reconnect",
        providerId: "browserless"
      }
    });
    const reconnectBody = JSON.parse(String(requests[5]?.init?.body ?? "{}")) as {
      code?: string;
      context?: { reuseSession?: boolean };
    };
    assert.equal(reconnectBody.context?.reuseSession, true);
    assert.match(reconnectBody.code ?? "", /urlMatchesHostPathPrefix/);
    assert.match(reconnectBody.code ?? "", /shouldNavigate/);
    assert.equal(
      requests[5]?.url,
      "https://browserless.example.com/reconnect/session-abc123/function?token=browserless-secret"
    );
    assert.notEqual(
      requests[5]?.url,
      "https://browserless.example.com/function?token=browserless-secret"
    );

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: {
            providerSessionId: "/reconnect/session-login",
            liveUrl: "https://browserless.example.com/live/session-login"
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

    const loginResult = await service.startLogin({
      loginUrl: "https://crm.example.com/login",
      timeoutMs: null,
      reconnectTimeoutMs: null,
      credential: {
        toolCode: "browser",
        secretId: "secret-login",
        providerId: "browserless"
      }
    });
    assert.equal(loginResult.providerSessionId, "/reconnect/session-login");
    assert.equal(loginResult.liveUrl, "https://browserless.example.com/live/session-login");
    const loginBody = JSON.parse(String(requests[6]?.init?.body ?? "{}")) as {
      code?: string;
      context?: { loginUrl?: string };
    };
    assert.match(loginBody.code ?? "", /Browserless\.liveURL/);
    assert.equal(loginBody.context?.loginUrl, "https://crm.example.com/login");

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: { closed: true }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    await service.deleteSession({
      providerSessionId: "/reconnect/session-login",
      credential: {
        toolCode: "browser",
        secretId: "secret-delete",
        providerId: "browserless"
      }
    });
    assert.equal(
      requests[7]?.url,
      "https://browserless.example.com/reconnect/session-login/function?token=browserless-secret"
    );
    const deleteBody = JSON.parse(String(requests[7]?.init?.body ?? "{}")) as { code?: string };
    assert.match(deleteBody.code ?? "", /browser\.close/);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          type: "application/json",
          data: { ok: true, url: "https://crm.example.com/dashboard" }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const verifyResult = await service.verifySession({
      providerSessionId: "/reconnect/session-login",
      credential: {
        toolCode: "browser",
        secretId: "secret-verify",
        providerId: "browserless"
      }
    });
    assert.deepEqual(verifyResult, { ok: true });
    assert.equal(
      requests[8]?.url,
      "https://browserless.example.com/reconnect/session-login/function?token=browserless-secret"
    );
    const verifyBody = JSON.parse(String(requests[8]?.init?.body ?? "{}")) as { code?: string };
    assert.match(verifyBody.code ?? "", /page\.url/);

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
            elements: []
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
