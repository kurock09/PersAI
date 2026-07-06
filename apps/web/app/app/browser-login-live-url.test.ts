import { describe, expect, it } from "vitest";
import {
  buildBrowserLoginLiveProxyUrl,
  withWebBrowserLoginLiveProxy
} from "./browser-login-live-url";

describe("browser-login-live-url", () => {
  it("builds same-origin proxy path for assistant profile", () => {
    expect(buildBrowserLoginLiveProxyUrl("assistant-1", "profile-1")).toBe(
      "/api/browser-login-live/assistant-1/profile-1/"
    );
  });

  it("rewrites pending login liveUrl for web modal iframe", () => {
    const pending = {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix",
      liveUrl: "https://production-sfo.browserless.io/live?token=abc",
      loginUrl: "https://crm.example.com/login"
    };
    expect(withWebBrowserLoginLiveProxy(pending, "assistant-1").liveUrl).toBe(
      "/api/browser-login-live/assistant-1/profile-1/"
    );
  });

  it("leaves already-proxied liveUrl unchanged", () => {
    const pending = {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix",
      liveUrl: "/api/browser-login-live/assistant-1/profile-1",
      loginUrl: "https://crm.example.com/login"
    };
    expect(withWebBrowserLoginLiveProxy(pending, "assistant-1")).toEqual(pending);
  });
});
