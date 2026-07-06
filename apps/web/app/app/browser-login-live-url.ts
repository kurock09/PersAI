import type { PendingBrowserLoginState } from "./assistant-api-client";
import {
  ensureBrowserLoginLiveProxyTrailingSlash,
  normalizeBrowserLoginLiveProxyUrl
} from "@/app/lib/browser-login-live-proxy";

const PROXY_PATH_PREFIX = "/api/browser-login-live";
const BROWSER_LOGIN_PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBrowserLoginProfileId(profileId: string): boolean {
  return BROWSER_LOGIN_PROFILE_ID_PATTERN.test(profileId);
}

export function buildBrowserLoginLiveProxyUrl(assistantId: string, profileId: string): string {
  return `${PROXY_PATH_PREFIX}/${encodeURIComponent(assistantId)}/${encodeURIComponent(profileId)}/`;
}

export function withWebBrowserLoginLiveProxy(
  pending: PendingBrowserLoginState,
  assistantId: string | null | undefined
): PendingBrowserLoginState {
  if (typeof assistantId !== "string" || assistantId.trim().length === 0) {
    return pending;
  }
  if (
    pending.liveUrl.startsWith(`${PROXY_PATH_PREFIX}/`) ||
    normalizeBrowserLoginLiveProxyUrl(pending.liveUrl).startsWith(`${PROXY_PATH_PREFIX}/`)
  ) {
    return {
      ...pending,
      liveUrl: ensureBrowserLoginLiveProxyTrailingSlash(
        normalizeBrowserLoginLiveProxyUrl(pending.liveUrl)
      )
    };
  }
  return {
    ...pending,
    liveUrl: buildBrowserLoginLiveProxyUrl(assistantId, pending.profileId)
  };
}

export { ensureBrowserLoginLiveProxyTrailingSlash };
