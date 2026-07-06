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
      if (url.includes("/pdf?")) {
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
    assert.equal(requests[3]?.url, "https://browserless.example.com/pdf?token=browserless-secret");
    const pdfBody = JSON.parse(String(requests[3]?.init?.body ?? "{}")) as {
      url?: string;
      options?: { printBackground?: boolean };
      gotoOptions?: { waitUntil?: string };
    };
    assert.equal(pdfBody.url, "https://example.com/report");
    assert.equal(pdfBody.options?.printBackground, true);
    assert.equal(pdfBody.gotoOptions?.waitUntil, "networkidle2");
    assert.equal(pdfResult.pdfBase64, "JVBERi0xLjQK");
    assert.equal(pdfResult.artifactMimeType, "application/pdf");
    assert.deepEqual(pdfResult.elements, []);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      if (url.includes("/screenshot?")) {
        return new Response(Buffer.from("aGVsbG8tcG5n", "base64"), {
          status: 200,
          headers: {
            "Content-Type": "image/png"
          }
        });
      }
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
    assert.equal(
      requests[4]?.url,
      "https://browserless.example.com/screenshot?token=browserless-secret"
    );
    const pngBody = JSON.parse(String(requests[4]?.init?.body ?? "{}")) as {
      url?: string;
      options?: { fullPage?: boolean; type?: string };
      gotoOptions?: { waitUntil?: string };
    };
    assert.equal(pngBody.url, "https://example.com/dashboard");
    assert.equal(pngBody.options?.type, "png");
    assert.equal(pngBody.options?.fullPage, true);
    assert.equal(pngBody.gotoOptions?.waitUntil, "networkidle2");
    assert.equal(pngResult.artifactBase64, "aGVsbG8tcG5n");
    assert.equal(pngResult.artifactMimeType, "image/png");
    assert.deepEqual(pngResult.elements, []);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      if (url.includes("/screenshot?")) {
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
            initialUrl: "https://example.com/dashboard",
            finalUrl: "https://example.com/dashboard",
            title: "Dashboard",
            content: "",
            truncated: false,
            elements: [{ tag: "div", text: "should be dropped" }],
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
      requests[5]?.url,
      "https://browserless.example.com/screenshot?token=browserless-secret"
    );
    const webpBody = JSON.parse(String(requests[5]?.init?.body ?? "{}")) as {
      url?: string;
      options?: { type?: string; quality?: number };
    };
    assert.equal(webpBody.url, "https://example.com/hero");
    assert.equal(webpBody.options?.type, "webp");
    assert.equal(webpBody.options?.quality, 80);
    assert.equal(webpResult.artifactBase64, "aGVsbG8td2VicA==");
    assert.equal(webpResult.artifactMimeType, "image/webp");

    // Any non-persistent `profileSessionId` must be rejected: `startLogin`
    // only ever stores `/e/{cloud}/session/{id}` or `/session/{id}`, so a
    // stray shape like `/reconnect/{id}` is unroutable garbage and we refuse
    // it up-front rather than falling back to a legacy `/function` path.
    await assert.rejects(
      () =>
        service.browserAction({
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
        }),
      BadRequestException
    );

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      if (url.includes("/session?")) {
        return new Response(
          JSON.stringify({
            id: "session-login",
            connect:
              "wss://browserless.example.com/session/connect/session-login?token=browserless-secret",
            stop: "https://browserless.example.com/session/session-login?token=browserless-secret",
            browserQL:
              "https://browserless.example.com/session/bql/session-login?token=browserless-secret",
            ttl: 2592000000
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            goto: { status: 200 },
            liveURL: {
              liveURL: "https://browserless.example.com/live/session-login"
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
    // Provider-gateway stores the canonical routable path derived from the
    // `session.stop` URL. This preserves any /e/{cloudEndpointId}/ prefix that
    // Browserless multi-cloud plans include (real prod), while remaining
    // compatible with fixtures that omit it (this test).
    assert.equal(loginResult.providerSessionId, "/session/session-login");
    assert.equal(loginResult.liveUrl, "https://browserless.example.com/live/session-login");
    assert.equal(
      requests[6]?.url,
      "https://browserless.example.com/session?token=browserless-secret"
    );
    assert.equal(requests[6]?.init?.method, "POST");
    const createSessionBody = JSON.parse(String(requests[6]?.init?.body ?? "{}")) as {
      ttl?: number;
      stealth?: boolean;
    };
    assert.equal(createSessionBody.stealth, true);
    assert.equal(createSessionBody.ttl, 30 * 24 * 60 * 60 * 1000);
    assert.equal(
      requests[7]?.url,
      "https://browserless.example.com/session/bql/session-login?token=browserless-secret"
    );
    const loginBqlBody = JSON.parse(String(requests[7]?.init?.body ?? "{}")) as {
      query?: string;
      variables?: { url?: string; liveUrlTimeoutMs?: number };
    };
    assert.match(loginBqlBody.query ?? "", /liveURL/);
    assert.match(loginBqlBody.query ?? "", /timeout:\s*\$liveUrlTimeoutMs/);
    assert.equal(loginBqlBody.variables?.url, "https://crm.example.com/login");
    assert.equal(loginBqlBody.variables?.liveUrlTimeoutMs, 15 * 60 * 1000);

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      if (url.includes("/session/session-login?")) {
        return new Response(null, { status: 204 });
      }
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
      providerSessionId: "/session/session-login",
      credential: {
        toolCode: "browser",
        secretId: "secret-delete",
        providerId: "browserless"
      }
    });
    assert.equal(
      requests[8]?.url,
      "https://browserless.example.com/session/session-login?token=browserless-secret&force=true"
    );
    assert.equal(requests[8]?.init?.method, "DELETE");

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      // Persistent-session verify hits the BrowserQL endpoint with a
      // schema-only `__typename` query — Browserless returns 200 with a
      // typed data payload only when the session is still routed.
      return new Response(
        JSON.stringify({
          data: { __typename: "Query" }
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
      providerSessionId: "/session/session-login",
      credential: {
        toolCode: "browser",
        secretId: "secret-verify",
        providerId: "browserless"
      }
    });
    assert.deepEqual(verifyResult, { ok: true });
    assert.equal(
      requests[9]?.url,
      "https://browserless.example.com/session/bql/session-login?token=browserless-secret"
    );
    const verifyBody = JSON.parse(String(requests[9]?.init?.body ?? "{}")) as { query?: string };
    assert.match(verifyBody.query ?? "", /__typename/);

    // Persistent connect-session (`/session/{id}` — or `/e/{cloud}/session/{id}`
    // in real prod) drives `browser-action` through BrowserQL, not `/function`
    // (Browserless `/function` returns 404 for persistent sessions).
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          data: {
            goto: { status: 200 },
            pageTitle: { title: "CRM" },
            pageUrl: { url: "https://crm.example.com/dashboard" },
            pageText: { text: "Authenticated CRM content" }
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

    const persistentSnapshot = await service.browserAction({
      action: "snapshot",
      url: "https://crm.example.com/dashboard",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      profileSessionId: "/session/session-login",
      credential: {
        toolCode: "browser",
        secretId: "secret-session-snapshot",
        providerId: "browserless"
      }
    });
    assert.equal(
      requests[10]?.url,
      "https://browserless.example.com/session/bql/session-login?token=browserless-secret"
    );
    const persistentBody = JSON.parse(String(requests[10]?.init?.body ?? "{}")) as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    assert.match(persistentBody.query ?? "", /goto\(url: \$url/);
    assert.match(persistentBody.query ?? "", /pageText: text \{ text \}/);
    assert.equal(persistentBody.variables?.url, "https://crm.example.com/dashboard");
    assert.equal(persistentSnapshot.title, "CRM");
    assert.equal(persistentSnapshot.finalUrl, "https://crm.example.com/dashboard");
    assert.equal(persistentSnapshot.content, "Authenticated CRM content");

    // Persistent-profile `act` with an operation whose selector times out on
    // the live page: Browserless BQL returns `200 { data: {...partial},
    // errors: [{ path: ["op_0"], message }] }`. The response MUST NOT be
    // treated as a fatal 502 — the model needs to see the extracted title/
    // url/text plus a `warning` describing the per-op runtime failure.
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          data: {
            goto: { status: 200 },
            op_0: null,
            pageTitle: { title: "CRM" },
            pageUrl: { url: "https://crm.example.com/dashboard" },
            pageText: { text: "Authenticated CRM content" }
          },
          errors: [
            {
              message: 'Timeout of 5000ms reached waiting for DOM selector "#missing"',
              path: ["op_0"]
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    const partialResult = await service.browserAction({
      action: "act",
      url: "https://crm.example.com/dashboard",
      maxChars: null,
      operations: [
        {
          kind: "click",
          selector: "#missing"
        }
      ],
      timeoutMs: null,
      profileSessionId: "/session/session-login",
      credential: {
        toolCode: "browser",
        secretId: "secret-session-partial",
        providerId: "browserless"
      }
    });
    assert.equal(partialResult.title, "CRM");
    assert.equal(partialResult.finalUrl, "https://crm.example.com/dashboard");
    assert.match(partialResult.warning ?? "", /Browser-rendered page content is untrusted/);
    assert.match(partialResult.warning ?? "", /Browserless BQL operation warnings/);
    assert.match(partialResult.warning ?? "", /op_0: Timeout of 5000ms/);

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
