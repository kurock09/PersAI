import { afterEach, describe, expect, it } from "vitest";
import {
  buildProxyPublicBase,
  normalizeBrowserLoginLiveProxyUrl,
  resolveProxyPublicOrigin
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
});
