import assert from "node:assert/strict";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { loadProviderGatewayConfig } from "@persai/config";
import type { PersistentBrowserCapabilityPolicy } from "@persai/runtime-contract";
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

function createPersistentCapabilityPolicy(profileKey: string): PersistentBrowserCapabilityPolicy {
  return {
    scope: "persistent_profile",
    profileIdentity: {
      assistantId: "assistant-1",
      profileKey
    },
    stealth: true,
    proxy: {
      mode: "sticky_residential",
      provider: "browserless_builtin",
      server: null
    }
  };
}

function createExternalCapabilityPolicy(profileKey: string): PersistentBrowserCapabilityPolicy {
  return {
    scope: "persistent_profile",
    profileIdentity: {
      assistantId: "assistant-1",
      profileKey
    },
    stealth: true,
    proxy: {
      mode: "sticky_residential",
      provider: "external",
      server: "http://proxy.example.com:8080"
    }
  };
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
    // "networkidle2" hangs indefinitely on SPAs with persistent background
    // traffic (live-tracking sockets, polling, analytics beacons) — goto
    // must always use domcontentloaded, with a short bounded settle window
    // instead of gambling the whole request on network silence.
    assert.doesNotMatch(snapshotBody.code ?? "", /networkidle2/);
    assert.match(snapshotBody.code ?? "", /const waitUntil = "domcontentloaded"/);
    assert.match(snapshotBody.code ?? "", /settleAfterGotoMs/);
    // Element extraction must rank by visibility before the top-N cap, and
    // the cap must come from the shared runtime-contract constant (60), not
    // a stale hardcoded 25 — see ADR-139 D11.
    assert.match(snapshotBody.code ?? "", /getClientRects\(\)\.length === 0/);
    assert.match(snapshotBody.code ?? "", /\.filter\(isVisibleInPage\)/);
    assert.match(snapshotBody.code ?? "", /\}, 60\);/);
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
    assert.equal(pdfBody.gotoOptions?.waitUntil, "domcontentloaded");
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
    assert.equal(pngBody.gotoOptions?.waitUntil, "domcontentloaded");
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
          capabilityPolicy: createPersistentCapabilityPolicy("crm"),
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
      capabilityPolicy: createPersistentCapabilityPolicy("crm"),
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
    assert.match(loginBqlBody.query ?? "", /userAgent\(userAgent: "[^"]*Chrome[^"]*"\)/);
    assert.doesNotMatch(loginBqlBody.query ?? "", /Headless/i);
    assert.match(
      loginBqlBody.query ?? "",
      /proxy\(network: residential, sticky: true, url: \["\*"\]\)/
    );
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
      capabilityPolicy: createPersistentCapabilityPolicy("crm"),
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
            pageText: { text: "Authenticated CRM content" },
            pageElements: {
              value: JSON.stringify([
                {
                  selector: "#crm-search",
                  tagName: "input",
                  text: null,
                  role: "searchbox",
                  type: "search",
                  href: null,
                  placeholder: "Search CRM",
                  disabled: false
                }
              ])
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

    const persistentSnapshot = await service.browserAction({
      action: "snapshot",
      url: "https://crm.example.com/dashboard",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      profileSessionId: "/session/session-login",
      capabilityPolicy: createPersistentCapabilityPolicy("crm"),
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
    assert.match(persistentBody.query ?? "", /goto\(url: \$url, waitUntil: domContentLoaded/);
    // "networkIdle" is Browserless's own "use with caution" wait condition —
    // real-world pages with persistent background traffic never satisfy it,
    // turning navigation into a hard timeoutMs failure. Always navigate on
    // domContentLoaded and settle briefly afterward instead.
    assert.doesNotMatch(persistentBody.query ?? "", /waitUntil: networkIdle/);
    assert.match(persistentBody.query ?? "", /settleAfterGoto: waitForTimeout\(time: 3000\)/);
    assert.match(persistentBody.query ?? "", /pageText: text \{ text \}/);
    assert.match(persistentBody.query ?? "", /pageElements: evaluate/);
    // Element extraction must rank by visibility before applying the top-N
    // cap — plain document order buries catalog/product content behind
    // header/nav/footer chrome (live-validated on Yandex Lavka, ADR-139
    // D11) — and the cap itself must come from the shared runtime-contract
    // constant, not a stale hardcoded 25.
    const interactiveElementsScript = String(
      persistentBody.variables?.interactiveElementsScript ?? ""
    );
    assert.match(interactiveElementsScript, /getClientRects\(\)\.length === 0/);
    assert.match(interactiveElementsScript, /\.filter\(isVisibleInPage\)/);
    assert.match(interactiveElementsScript, /\.slice\(0, 60\)/);
    assert.match(persistentBody.query ?? "", /userAgent\(userAgent: "[^"]*Chrome[^"]*"\)/);
    assert.doesNotMatch(persistentBody.query ?? "", /Headless/i);
    assert.match(
      persistentBody.query ?? "",
      /proxy\(network: residential, sticky: true, url: \["\*"\]\)/
    );
    assert.equal(persistentBody.variables?.url, "https://crm.example.com/dashboard");
    assert.equal(persistentSnapshot.title, "CRM");
    assert.equal(persistentSnapshot.finalUrl, "https://crm.example.com/dashboard");
    assert.equal(persistentSnapshot.content, "Authenticated CRM content");
    assert.equal(persistentSnapshot.elements[0]?.selector, "#crm-search");

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
            pageText: { text: "Authenticated CRM content" },
            pageElements: {
              value: JSON.stringify([
                {
                  selector: 'button[aria-label="Save"]',
                  tagName: "button",
                  text: "Save",
                  role: "button",
                  type: null,
                  href: null,
                  placeholder: null,
                  disabled: false
                }
              ])
            }
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
      capabilityPolicy: createPersistentCapabilityPolicy("crm"),
      credential: {
        toolCode: "browser",
        secretId: "secret-session-partial",
        providerId: "browserless"
      }
    });
    assert.equal(partialResult.title, "CRM");
    assert.equal(partialResult.finalUrl, "https://crm.example.com/dashboard");
    assert.equal(partialResult.content, "Authenticated CRM content");
    assert.equal(partialResult.elements[0]?.selector, 'button[aria-label="Save"]');
    assert.match(partialResult.warning ?? "", /Browser-rendered page content is untrusted/);
    assert.match(partialResult.warning ?? "", /Browserless BQL operation warnings/);
    assert.match(partialResult.warning ?? "", /op_0: Timeout of 5000ms/);

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: {
            goto: { status: 200 },
            pageTitle: { title: "CRM" },
            pageUrl: { url: "https://crm.example.com/dashboard" },
            pageText: { text: "Authenticated CRM content" }
          },
          errors: [
            {
              message: "Residential proxy is not enabled for this Browserless plan",
              path: ["proxy"]
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    await assert.rejects(
      () =>
        service.browserAction({
          action: "snapshot",
          url: "https://crm.example.com/dashboard",
          maxChars: null,
          operations: [],
          timeoutMs: null,
          profileSessionId: "/session/session-login",
          capabilityPolicy: createPersistentCapabilityPolicy("crm"),
          credential: {
            toolCode: "browser",
            secretId: "secret-session-proxy-fatal",
            providerId: "browserless"
          }
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadGatewayException);
        assert.match(String(error.message), /Residential proxy is not enabled/i);
        return true;
      }
    );

    await assert.rejects(
      () =>
        service.browserAction({
          action: "snapshot",
          url: "https://crm.example.com/dashboard",
          maxChars: null,
          operations: [],
          timeoutMs: null,
          profileSessionId: "/session/session-login",
          capabilityPolicy: createExternalCapabilityPolicy("crm"),
          credential: {
            toolCode: "browser",
            secretId: "secret-session-external",
            providerId: "browserless"
          }
        }),
      BadRequestException
    );

    await assert.rejects(
      () =>
        service.browserAction({
          action: "act",
          url: "https://crm.example.com/dashboard",
          maxChars: null,
          operations: [
            {
              kind: "press",
              key: "Enter"
            }
          ],
          timeoutMs: null,
          profileSessionId: "/session/session-login",
          capabilityPolicy: createPersistentCapabilityPolicy("crm"),
          credential: {
            toolCode: "browser",
            secretId: "secret-session-press",
            providerId: "browserless"
          }
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(String(error.message), /do not support press operations reliably/i);
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          data: {
            goto: { status: 200 },
            settleAfterGoto: { time: 3000 },
            op_0: { value: null },
            pageTitle: { title: "Catalog" },
            pageUrl: { url: "https://lavka.example.com/catalog/water" },
            pageText: { text: "Baikal water 430ml" },
            pageElements: { value: JSON.stringify([]) }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    await service.browserAction({
      action: "act",
      url: "https://lavka.example.com/catalog/water",
      maxChars: null,
      operations: [
        {
          kind: "scroll",
          selector: null
        }
      ],
      timeoutMs: null,
      profileSessionId: "/session/session-login",
      capabilityPolicy: createPersistentCapabilityPolicy("lavka"),
      credential: {
        toolCode: "browser",
        secretId: "secret-session-scroll",
        providerId: "browserless"
      }
    });
    const scrollBqlBody = JSON.parse(String(requests.at(-1)?.init?.body ?? "{}")) as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    // No native selector → scroll one viewport down via evaluate(), not the
    // BQL `scroll` mutation, so behavior matches the ephemeral `/function`
    // path exactly regardless of its exact required-argument combination.
    assert.match(scrollBqlBody.query ?? "", /op_0: evaluate\(content: \$scrollScript_0\)/);
    assert.match(
      String(scrollBqlBody.variables?.scrollScript_0 ?? ""),
      /window\.scrollBy\(0, window\.innerHeight\)/
    );

    await service.browserAction({
      action: "act",
      url: "https://lavka.example.com/catalog/water",
      maxChars: null,
      operations: [
        {
          kind: "scroll",
          selector: "#product-card"
        }
      ],
      timeoutMs: null,
      profileSessionId: "/session/session-login",
      capabilityPolicy: createPersistentCapabilityPolicy("lavka"),
      credential: {
        toolCode: "browser",
        secretId: "secret-session-scroll-selector",
        providerId: "browserless"
      }
    });
    const scrollSelectorBqlBody = JSON.parse(String(requests.at(-1)?.init?.body ?? "{}")) as {
      variables?: Record<string, unknown>;
    };
    assert.match(
      String(scrollSelectorBqlBody.variables?.scrollScript_0 ?? ""),
      /querySelector\("#product-card"\)\?\.scrollIntoView/
    );

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

    await service.browserAction({
      action: "act",
      url: "https://example.com",
      maxChars: null,
      operations: [
        {
          kind: "scroll",
          selector: null
        }
      ],
      timeoutMs: null,
      credential: {
        toolCode: "browser",
        secretId: "secret-scroll-ephemeral",
        providerId: "browserless"
      }
    });
    const scrollEphemeralBody = JSON.parse(String(requests.at(-1)?.init?.body ?? "{}")) as {
      context?: { operations?: Array<Record<string, unknown>> };
    };
    assert.deepEqual(scrollEphemeralBody.context?.operations, [{ kind: "scroll", selector: null }]);

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

    // ADR-139 D8 test-scoped v0 heuristic: persistent-session goto targets on
    // a `.ru` hostname request `country: RU` on the sticky residential proxy
    // mutation instead of leaving country selection to Browserless's
    // automatic pool choice.
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
      return new Response(
        JSON.stringify({
          data: {
            goto: { status: 200 },
            pageTitle: { title: "Lavka" },
            pageUrl: { url: "https://lavka.yandex.ru/catalog" },
            pageText: { text: "Catalog content" },
            pageElements: { value: JSON.stringify([]) }
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
      url: "https://lavka.yandex.ru/catalog",
      maxChars: null,
      operations: [],
      timeoutMs: null,
      profileSessionId: "/session/session-login",
      capabilityPolicy: createPersistentCapabilityPolicy("lavka"),
      credential: {
        toolCode: "browser",
        secretId: "secret-ru-proxy",
        providerId: "browserless"
      }
    });
    const ruProxyBody = JSON.parse(String(requests.at(-1)?.init?.body ?? "{}")) as {
      query?: string;
    };
    assert.match(
      ruProxyBody.query ?? "",
      /proxy\(network: residential, sticky: true, url: \["\*"\], country: RU\)/
    );
    assert.match(ruProxyBody.query ?? "", /userAgent\(userAgent: "[^"]*Chrome[^"]*"\)/);

    // A per-operation failure inside the ephemeral /function script (e.g. a
    // guessed selector that does not match anything live) must degrade to a
    // warning on an otherwise-successful result, not an opaque 502 that
    // discards the already-reached page's title/url/content — mirrors the
    // BQL path's op_* warning classification (Audit Finding 1).
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(init === undefined ? { url } : { url, init });
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
  } finally {
    globalThis.fetch = originalFetch;
  }
}
