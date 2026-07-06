const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export type BrowserLoginLiveProxyPath = {
  assistantId: string;
  profileId: string;
  upstreamPath: string;
};

const BROWSER_LOGIN_PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBrowserLoginProfileId(profileId: string): boolean {
  return BROWSER_LOGIN_PROFILE_ID_PATTERN.test(profileId);
}

export function parseBrowserLoginLiveProxyPath(pathname: string): BrowserLoginLiveProxyPath | null {
  const match = /^\/api\/browser-login-live\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!match) {
    return null;
  }
  const assistantId = decodeURIComponent(match[1] ?? "");
  const profileId = decodeURIComponent(match[2] ?? "");
  if (assistantId.length === 0 || !isBrowserLoginProfileId(profileId)) {
    return null;
  }
  const rest = match[3] ?? "";
  return {
    assistantId,
    profileId,
    upstreamPath: rest.length > 0 ? `/${rest}` : ""
  };
}

export function buildUpstreamTargetUrl(
  upstreamLiveUrl: string,
  upstreamPath: string,
  search: string
): string {
  const upstream = new URL(upstreamLiveUrl);
  if (upstreamPath.length === 0) {
    return `${upstream.toString()}${search.length > 0 ? search : ""}`;
  }
  const target = new URL(upstreamPath, upstream);
  if (search.length > 0) {
    const params = new URLSearchParams(search);
    params.forEach((value, key) => {
      target.searchParams.set(key, value);
    });
  }
  return target.toString();
}

export function buildProxyPublicBase(
  request: Request,
  proxyPath: BrowserLoginLiveProxyPath
): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const origin =
    forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : requestUrl.origin;
  return `${origin}/api/browser-login-live/${encodeURIComponent(proxyPath.assistantId)}/${encodeURIComponent(proxyPath.profileId)}/`;
}

export function injectBrowserLoginLiveHtmlBase(html: string, proxyPublicBase: string): string {
  const baseHref = `${proxyPublicBase.replace(/\/$/, "")}/`;
  const baseTag = `<base href="${baseHref}">`;
  if (/<base\s/i.test(html)) {
    return html.replace(/<base\s[^>]*>/i, baseTag);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (headTag) => `${headTag}${baseTag}`);
  }
  return `${baseTag}${html}`;
}

export function rewriteBrowserLoginLiveBody(params: {
  body: string;
  upstreamOrigin: string;
  proxyPublicBase: string;
  contentType?: string | null;
}): string {
  const upstreamUrl = new URL(params.upstreamOrigin);
  const upstreamOrigin = upstreamUrl.origin;
  const upstreamWsOrigin = upstreamOrigin.replace(/^http/i, "ws");
  const proxyPublicBase = params.proxyPublicBase.replace(/\/$/, "");
  const proxyWsBase = proxyPublicBase.replace(/^http/i, "ws");

  let rewritten = params.body
    .replaceAll(upstreamOrigin, `${proxyPublicBase}/`)
    .replaceAll(upstreamWsOrigin, `${proxyWsBase}/`);

  if (params.contentType?.toLowerCase().includes("text/html")) {
    rewritten = injectBrowserLoginLiveHtmlBase(rewritten, proxyPublicBase);
  }

  return rewritten;
}

export function buildProxyResponseHeaders(
  upstream: Response,
  upstreamOrigin: string,
  proxyPublicBase: string
): Headers {
  const out = new Headers();
  const upstreamUrl = new URL(upstreamOrigin);
  const upstreamHost = upstreamUrl.host;
  const proxyHost = new URL(proxyPublicBase).host;

  let rewrittenLocation: string | null = null;
  const locationHeader = upstream.headers.get("location");
  if (locationHeader) {
    try {
      const locationUrl = new URL(locationHeader, upstreamOrigin);
      if (locationUrl.origin === upstreamUrl.origin) {
        const suffix = `${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`;
        rewrittenLocation = `${proxyPublicBase}${suffix}`;
      }
    } catch {
      /* ignore */
    }
  }

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "location") {
      return;
    }
    if (lower === "content-security-policy") {
      return;
    }
    out.set(key, value.replaceAll(upstreamHost, proxyHost));
  });

  if (rewrittenLocation) {
    out.set("Location", rewrittenLocation);
  }

  out.delete("transfer-encoding");
  out.delete("content-encoding");
  out.delete("content-length");

  return out;
}

export function shouldRewriteBrowserLoginLiveBody(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/html") ||
    normalized.includes("text/css") ||
    normalized.includes("javascript") ||
    normalized.includes("application/json") ||
    normalized.includes("text/plain")
  );
}

export function readApiBaseUrl(): string {
  const raw = process.env.PERSAI_WEB_API_PROXY_TARGET?.trim() ?? "http://localhost:3001";
  const normalized = raw.replace(/\/$/, "").replace(/\/api\/v1$/, "");
  return `${normalized}/api/v1`;
}
