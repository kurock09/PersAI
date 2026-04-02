import { fapiUrlFromPublishableKey, stripTrailingSlashes } from "@clerk/backend/proxy";

const NPM_PREFIX = "/clerk-proxy/npm/";
const JSDELIVR_NPM = "https://cdn.jsdelivr.net/npm/";
const PROXY_PATH = "/clerk-proxy";

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

type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };

function derivePublicOrigin(request: Request, requestUrl: URL): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return requestUrl.origin;
}

function getClientIp(request: Request): string | undefined {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) {
    return cf;
  }
  const xReal = request.headers.get("x-real-ip");
  if (xReal) {
    return xReal;
  }
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]?.trim();
  }
  return undefined;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Copy FAPI response headers without losing multiple Set-Cookie.
 * @clerk/backend clerkFrontendApiProxy uses Headers.set() in a forEach — only one cookie survives.
 */
function buildFapiProxyResponseHeaders(
  upstream: Response,
  fapiBaseUrl: string,
  fapiHost: string,
  proxyUrl: string
): Headers {
  const out = new Headers();
  const inc = upstream.headers as HeadersWithSetCookie;
  const cookies = typeof inc.getSetCookie === "function" ? inc.getSetCookie() : [];
  for (const c of cookies) {
    out.append("Set-Cookie", c);
  }

  let rewrittenLocation: string | null = null;
  const locationHeader = upstream.headers.get("location");
  if (locationHeader) {
    try {
      const locationUrl = new URL(locationHeader, fapiBaseUrl);
      if (locationUrl.host === fapiHost) {
        rewrittenLocation = `${proxyUrl}${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`;
      }
    } catch {
      /* ignore */
    }
  }

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || HOP_BY_HOP.has(lower)) {
      return;
    }
    if (lower === "location" && rewrittenLocation) {
      return;
    }
    out.set(key, value);
  });

  if (rewrittenLocation) {
    out.set("Location", rewrittenLocation);
  }

  out.delete("transfer-encoding");
  out.delete("content-encoding");
  out.delete("content-length");

  return out;
}

/**
 * Same behavior as @clerk/nextjs clerkFrontendApiProxy, but preserves every Set-Cookie from FAPI.
 */
async function clerkFapiProxy(request: Request): Promise<Response> {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (!publishableKey) {
    return jsonError("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", 500);
  }
  if (!secretKey) {
    return jsonError("Missing CLERK_SECRET_KEY", 500);
  }

  const proxyPath = stripTrailingSlashes(PROXY_PATH);
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== proxyPath && !requestUrl.pathname.startsWith(`${proxyPath}/`)) {
    return jsonError(`Path does not match proxy path "${proxyPath}"`, 400);
  }

  const fapiBaseUrl = fapiUrlFromPublishableKey(publishableKey);
  const targetPath = requestUrl.pathname.slice(proxyPath.length) || "/";
  const targetUrl = new URL(targetPath, fapiBaseUrl);
  targetUrl.search = requestUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const publicOrigin = derivePublicOrigin(request, requestUrl);
  const proxyUrlFull = `${publicOrigin}${proxyPath}`;
  headers.set("Clerk-Proxy-Url", proxyUrlFull);
  headers.set("Clerk-Secret-Key", secretKey);

  const fapiHost = new URL(fapiBaseUrl).host;
  headers.set("Host", fapiHost);
  if (!headers.has("X-Forwarded-Host")) {
    headers.set("X-Forwarded-Host", requestUrl.host);
  }
  if (!headers.has("X-Forwarded-Proto")) {
    headers.set("X-Forwarded-Proto", requestUrl.protocol.replace(":", ""));
  }
  const clientIp = getClientIp(request);
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }

  const hasBody = ["POST", "PUT", "PATCH"].includes(request.method);
  const fetchInit: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers
  };
  if (hasBody) {
    fetchInit.duplex = "half";
  }
  if (hasBody && request.body) {
    fetchInit.body = request.body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), fetchInit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return jsonError(`Failed to proxy to Clerk FAPI: ${msg}`, 502);
  }

  const outHeaders = buildFapiProxyResponseHeaders(upstream, fapiBaseUrl, fapiHost, proxyUrlFull);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}

/**
 * Server-side fetch decompresses gzip/br; strip misleading encoding on npm CDN responses.
 */
function stripMisleadingEncodingHeaders(response: Response): Response {
  const out = new Headers();
  const strip = new Set(["transfer-encoding", "content-encoding", "content-length"]);

  const incoming = response.headers as HeadersWithSetCookie;
  const cookies = typeof incoming.getSetCookie === "function" ? incoming.getSetCookie() : [];
  for (const c of cookies) {
    out.append("Set-Cookie", c);
  }

  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || strip.has(lower)) {
      return;
    }
    out.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out
  });
}

async function proxyNpmStatic(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(NPM_PREFIX)) {
    return null;
  }
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }

  const subPath = url.pathname.slice(NPM_PREFIX.length);
  const target = `${JSDELIVR_NPM}${subPath}${url.search}`;
  const res = await fetch(target, {
    method,
    headers: { Accept: request.headers.get("Accept") ?? "*/*" },
    redirect: "follow"
  });

  return stripMisleadingEncodingHeaders(res);
}

function wrap(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const npm = await proxyNpmStatic(request);
    if (npm) {
      return npm;
    }
    return handler(request);
  };
}

export const GET = wrap(clerkFapiProxy);
export const POST = wrap(clerkFapiProxy);
export const PUT = wrap(clerkFapiProxy);
export const DELETE = wrap(clerkFapiProxy);
export const PATCH = wrap(clerkFapiProxy);

export async function OPTIONS(request: Request) {
  const npm = await proxyNpmStatic(request);
  if (npm) {
    return npm;
  }
  return clerkFapiProxy(request);
}
