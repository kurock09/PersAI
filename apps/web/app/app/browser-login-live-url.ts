import type { PendingBrowserLoginState } from "./assistant-api-client";

const PROXY_PATH_PREFIX = "/api/browser-login-live";

export function buildBrowserLoginLiveProxyUrl(assistantId: string, profileId: string): string {
  return `${PROXY_PATH_PREFIX}/${encodeURIComponent(assistantId)}/${encodeURIComponent(profileId)}`;
}

export function withWebBrowserLoginLiveProxy(
  pending: PendingBrowserLoginState,
  assistantId: string | null | undefined
): PendingBrowserLoginState {
  if (typeof assistantId !== "string" || assistantId.trim().length === 0) {
    return pending;
  }
  if (pending.liveUrl.startsWith(`${PROXY_PATH_PREFIX}/`)) {
    return pending;
  }
  return {
    ...pending,
    liveUrl: buildBrowserLoginLiveProxyUrl(assistantId, pending.profileId)
  };
}
