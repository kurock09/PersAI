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

  it("adds trailing slash to already-proxied root liveUrl", () => {
    const pending = {
      profileId: "9eef9e66-8e97-47e6-b986-fc094146b953",
      profileKey: "bitrix",
      displayName: "Bitrix",
      liveUrl:
        "/api/browser-login-live/c2df1500-ec77-4224-891d-efc32a16c810/9eef9e66-8e97-47e6-b986-fc094146b953",
      loginUrl: "https://crm.example.com/login"
    };
    expect(withWebBrowserLoginLiveProxy(pending, "assistant-1").liveUrl).toBe(
      "/api/browser-login-live/c2df1500-ec77-4224-891d-efc32a16c810/9eef9e66-8e97-47e6-b986-fc094146b953/"
    );
  });

  it("strips internal pod origin from proxied liveUrl", () => {
    const pending = {
      profileId: "cbb32094-2798-4dc4-887c-4c3f678851b3",
      profileKey: "admin",
      displayName: "PersAI Admin",
      liveUrl:
        "https://0.0.0.0:3000/api/browser-login-live/c2df1500-ec77-4224-891d-efc32a16c810/cbb32094-2798-4dc4-887c-4c3f678851b3/",
      loginUrl: "https://persai.dev/"
    };
    expect(withWebBrowserLoginLiveProxy(pending, "assistant-1").liveUrl).toBe(
      "/api/browser-login-live/c2df1500-ec77-4224-891d-efc32a16c810/cbb32094-2798-4dc4-887c-4c3f678851b3/"
    );
  });
});
