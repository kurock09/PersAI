import { clerkFrontendApiProxy, createFrontendApiProxyHandlers } from "@clerk/nextjs/server";

const NPM_PREFIX = "/clerk-proxy/npm/";
const JSDELIVR_NPM = "https://cdn.jsdelivr.net/npm/";

const fapi = createFrontendApiProxyHandlers({
  proxyPath: "/clerk-proxy"
});

type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };

/**
 * Server-side fetch often decompresses gzip/br but leaves Content-Encoding set.
 * Forwarding that to the browser causes ERR_CONTENT_DECODING_FAILED (200 OK).
 *
 * Do not clone via `new Headers(response.headers)` alone: multiple Set-Cookie
 * values can be merged incorrectly → session/sign-up cookies break → 401 on FAPI.
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
    out.append(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out
  });
}

/**
 * Clerk prefixes both FAPI calls and static bundles with `NEXT_PUBLIC_CLERK_PROXY_URL`.
 * `/npm/@clerk/...` must be served from npm CDN, not forwarded to Frontend API (502).
 */
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
    const upstream = await handler(request);
    return stripMisleadingEncodingHeaders(upstream);
  };
}

export const GET = wrap(fapi.GET);
export const POST = wrap(fapi.POST);
export const PUT = wrap(fapi.PUT);
export const DELETE = wrap(fapi.DELETE);
export const PATCH = wrap(fapi.PATCH);

export async function OPTIONS(request: Request) {
  const npm = await proxyNpmStatic(request);
  if (npm) {
    return npm;
  }
  const upstream = await clerkFrontendApiProxy(request, { proxyPath: "/clerk-proxy" });
  return stripMisleadingEncodingHeaders(upstream);
}
