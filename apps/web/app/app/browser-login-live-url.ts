import type { PendingBrowserLoginState } from "./assistant-api-client";
import {
  ensureBrowserLoginLiveProxyEntryPath,
  ensureBrowserLoginLiveProxyTrailingSlash,
  normalizeBrowserLoginLiveProxyUrl
} from "@/app/lib/browser-login-live-proxy";

const PROXY_PATH_PREFIX = "/api/browser-login-live";
const BROWSER_LOGIN_PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBrowserLoginProfileId(profileId: string): boolean {
  return BROWSER_LOGIN_PROFILE_ID_PATTERN.test(profileId);
}

export function extractBrowserLoginLiveUpstreamSearch(liveUrl: string): string {
  try {
    const parsed = new URL(liveUrl);
    return parsed.search;
  } catch {
    return "";
  }
}

export function buildBrowserLoginLiveProxyUrl(
  assistantId: string,
  profileId: string,
  upstreamSearch = ""
): string {
  const path = `${PROXY_PATH_PREFIX}/${encodeURIComponent(assistantId)}/${encodeURIComponent(profileId)}/index.html`;
  if (upstreamSearch.length === 0) {
    return path;
  }
  const search = upstreamSearch.startsWith("?") ? upstreamSearch : `?${upstreamSearch}`;
  return `${path}${search}`;
}

export function withWebBrowserLoginLiveProxy(
  pending: PendingBrowserLoginState,
  assistantId: string | null | undefined
): PendingBrowserLoginState {
  if (typeof assistantId !== "string" || assistantId.trim().length === 0) {
    return pending;
  }
  const upstreamSearch = extractBrowserLoginLiveUpstreamSearch(pending.liveUrl);
  if (
    pending.liveUrl.startsWith(`${PROXY_PATH_PREFIX}/`) ||
    normalizeBrowserLoginLiveProxyUrl(pending.liveUrl).startsWith(`${PROXY_PATH_PREFIX}/`)
  ) {
    const normalized = normalizeBrowserLoginLiveProxyUrl(pending.liveUrl);
    const proxied =
      upstreamSearch.length > 0 && !normalized.includes("?")
        ? buildBrowserLoginLiveProxyUrl(assistantId, pending.profileId, upstreamSearch)
        : normalized;
    return {
      ...pending,
      liveUrl: ensureBrowserLoginLiveProxyEntryPath(proxied)
    };
  }
  return {
    ...pending,
    liveUrl: ensureBrowserLoginLiveProxyEntryPath(
      buildBrowserLoginLiveProxyUrl(assistantId, pending.profileId, upstreamSearch)
    )
  };
}

export { ensureBrowserLoginLiveProxyEntryPath, ensureBrowserLoginLiveProxyTrailingSlash };
