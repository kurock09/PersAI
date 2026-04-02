import { clerkFrontendApiProxy, createFrontendApiProxyHandlers } from "@clerk/nextjs/server";

const NPM_PREFIX = "/clerk-proxy/npm/";
const JSDELIVR_NPM = "https://cdn.jsdelivr.net/npm/";

const fapi = createFrontendApiProxyHandlers({
  proxyPath: "/clerk-proxy"
});

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

  const headers = new Headers(res.headers);
  headers.delete("transfer-encoding");
  // Node/undici fetch decompresses gzip/br; body is plain bytes but upstream
  // Content-Encoding may still say gzip → browser ERR_CONTENT_DECODING_FAILED.
  headers.delete("content-encoding");
  headers.delete("content-length");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
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
  return clerkFrontendApiProxy(request, { proxyPath: "/clerk-proxy" });
}
