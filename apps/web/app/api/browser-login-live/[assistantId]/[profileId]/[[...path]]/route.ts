import { auth } from "@clerk/nextjs/server";
import {
  buildProxyPublicBase,
  buildProxyResponseHeaders,
  buildUpstreamTargetUrl,
  parseBrowserLoginLiveProxyPath,
  readApiBaseUrl,
  rewriteBrowserLoginLiveBody,
  shouldRewriteBrowserLoginLiveBody
} from "@/app/lib/browser-login-live-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TOKEN_HEADER = "x-persai-session-token";

async function resolveAuthToken(request: Request): Promise<string | null> {
  const headerToken = request.headers.get(SESSION_TOKEN_HEADER)?.trim();
  if (headerToken) {
    return headerToken;
  }
  const { getToken } = await auth();
  return (await getToken()) ?? null;
}

async function resolveUpstreamLiveUrl(
  token: string,
  assistantId: string,
  profileId: string
): Promise<string> {
  const upstream = `${readApiBaseUrl()}/assistant/${encodeURIComponent(assistantId)}/browser-profiles/${encodeURIComponent(profileId)}/live-upstream`;
  const response = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`live-upstream ${response.status}`);
  }
  const payload = (await response.json()) as { upstreamLiveUrl?: unknown };
  if (typeof payload.upstreamLiveUrl !== "string" || payload.upstreamLiveUrl.trim().length === 0) {
    throw new Error("live-upstream missing url");
  }
  return payload.upstreamLiveUrl.trim();
}

async function proxyBrowserLoginLive(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const proxyPath = parseBrowserLoginLiveProxyPath(requestUrl.pathname);
  if (proxyPath === null) {
    return Response.json({ error: "Invalid browser login live proxy path." }, { status: 400 });
  }

  const token = await resolveAuthToken(request);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let upstreamLiveUrl: string;
  try {
    upstreamLiveUrl = await resolveUpstreamLiveUrl(
      token,
      proxyPath.assistantId,
      proxyPath.profileId
    );
  } catch {
    return Response.json({ error: "Browser login live session is unavailable." }, { status: 404 });
  }

  const upstreamOrigin = new URL(upstreamLiveUrl).origin;
  const targetUrl = buildUpstreamTargetUrl(
    upstreamLiveUrl,
    proxyPath.upstreamPath,
    requestUrl.search
  );
  const proxyPublicBase = buildProxyPublicBase(request, proxyPath);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === SESSION_TOKEN_HEADER
    ) {
      return;
    }
    headers.set(key, value);
  });
  headers.set("Host", new URL(upstreamOrigin).host);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store"
  };
  if (hasBody && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch {
    return Response.json({ error: "Browserless live upstream unreachable." }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type");
  const outHeaders = buildProxyResponseHeaders(upstream, upstreamOrigin, proxyPublicBase);

  if (!shouldRewriteBrowserLoginLiveBody(contentType) || upstream.body === null) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders
    });
  }

  const rawBody = await upstream.text();
  const rewritten = rewriteBrowserLoginLiveBody({
    body: rawBody,
    upstreamOrigin,
    proxyPublicBase
  });
  outHeaders.set("Content-Type", contentType ?? "text/html; charset=utf-8");
  return new Response(rewritten, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  });
}

export async function GET(request: Request): Promise<Response> {
  return proxyBrowserLoginLive(request);
}

export async function POST(request: Request): Promise<Response> {
  return proxyBrowserLoginLive(request);
}

export async function PUT(request: Request): Promise<Response> {
  return proxyBrowserLoginLive(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return proxyBrowserLoginLive(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return proxyBrowserLoginLive(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return proxyBrowserLoginLive(request);
}
