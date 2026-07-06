import { afterEach, describe, expect, it } from "vitest";
import {
  buildProxyPublicBase,
  buildUpstreamTargetUrl,
  normalizeBrowserLoginLiveProxyUrl,
  resolveProxyPublicOrigin,
  rewriteBrowserLoginLiveBody
} from "./browser-login-live-proxy";

describe("browser-login-live-proxy", () => {
  afterEach(() => {
    delete process.env.PERSAI_WEB_BASE_URL;
  });

  it("normalizeBrowserLoginLiveProxyUrl strips internal bind host", () => {
    expect(
      normalizeBrowserLoginLiveProxyUrl("https://0.0.0.0:3000/api/browser-login-live/a/b/")
    ).toBe("/api/browser-login-live/a/b/");
  });

  it("resolveProxyPublicOrigin prefers forwarded headers", () => {
    const request = new Request("http://0.0.0.0:3000/api/browser-login-live/a/b/", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "persai.dev"
      }
    });
    expect(resolveProxyPublicOrigin(request)).toBe("https://persai.dev");
  });

  it("resolveProxyPublicOrigin uses Host when not internal", () => {
    const request = new Request("http://10.0.0.5:3000/api/browser-login-live/a/b/", {
      headers: { host: "persai.dev" }
    });
    expect(resolveProxyPublicOrigin(request)).toBe("https://persai.dev");
  });

  it("resolveProxyPublicOrigin falls back to PERSAI_WEB_BASE_URL", () => {
    process.env.PERSAI_WEB_BASE_URL = "https://persai.dev";
    const request = new Request("http://0.0.0.0:3000/api/browser-login-live/a/b/", {
      headers: { host: "0.0.0.0:3000" }
    });
    expect(resolveProxyPublicOrigin(request)).toBe("https://persai.dev");
  });

  it("buildProxyPublicBase never emits 0.0.0.0 when Host is public", () => {
    const request = new Request(
      "http://0.0.0.0:3000/api/browser-login-live/assistant-1/9eef9e66-8e97-47e6-b986-fc094146b953/",
      { headers: { host: "persai.dev", "x-forwarded-proto": "https" } }
    );
    expect(
      buildProxyPublicBase(request, {
        assistantId: "assistant-1",
        profileId: "9eef9e66-8e97-47e6-b986-fc094146b953",
        upstreamPath: ""
      })
    ).toBe(
      "https://persai.dev/api/browser-login-live/assistant-1/9eef9e66-8e97-47e6-b986-fc094146b953/"
    );
  });

  it("buildUpstreamTargetUrl preserves Browserless auth query on subresources", () => {
    const upstream = "https://production-sfo.browserless.io/session/abc/live?token=secret";
    expect(buildUpstreamTargetUrl(upstream, "client.js", "")).toBe(
      "https://production-sfo.browserless.io/session/abc/client.js?token=secret"
    );
  });

  it("rewriteBrowserLoginLiveBody avoids double slashes after origin rewrite", () => {
    const rewritten = rewriteBrowserLoginLiveBody({
      body: '<script src="https://production-sfo.browserless.io/client.js"></script>',
      upstreamOrigin: "https://production-sfo.browserless.io",
      proxyPublicBase: "https://persai.dev/api/browser-login-live/a/b/",
      contentType: "text/html"
    });
    expect(rewritten).toContain("https://persai.dev/api/browser-login-live/a/b/client.js");
    expect(rewritten).not.toContain("/b//client.js");
  });
});
