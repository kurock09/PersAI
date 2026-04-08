import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OVERVIEW_STICKY_COOKIE = "persai-admin-overview-pod-ip";
const OVERVIEW_PINNED_COOKIE = "persai-admin-overview-pinned-pod-ip";
const OVERVIEW_ROUTE_HEADER = "x-persai-admin-overview-route";
const OVERVIEW_PINNED_POD_IP_HEADER = "x-persai-admin-overview-pod-ip";

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

function apiUpstreamBase(): string | null {
  const raw = process.env.PERSAI_WEB_API_PROXY_TARGET?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/$/, "");
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/$/, "");
}

function isAdminOverviewPath(pathSegments: string[] | undefined): boolean {
  return (
    Array.isArray(pathSegments) &&
    pathSegments.length >= 2 &&
    pathSegments[0] === "admin" &&
    pathSegments[1] === "overview"
  );
}

function buildUpstreamCandidates(req: NextRequest, pathSegments: string[] | undefined): string[] {
  const base = apiUpstreamBase();
  if (!base) {
    return [];
  }

  const normalizedBase = normalizeOrigin(base);
  if (!isAdminOverviewPath(pathSegments)) {
    return [normalizedBase];
  }

  const routeMode = req.headers.get(OVERVIEW_ROUTE_HEADER)?.trim().toLowerCase();
  const requestedPinnedPodIp = req.headers.get(OVERVIEW_PINNED_POD_IP_HEADER)?.trim();
  const pinnedPodIp =
    routeMode === "pinned"
      ? requestedPinnedPodIp || req.cookies.get(OVERVIEW_PINNED_COOKIE)?.value?.trim() || null
      : null;
  const stickyPodIp =
    routeMode === "probe" ? null : req.cookies.get(OVERVIEW_STICKY_COOKIE)?.value?.trim() || null;
  const preferredPodIp = pinnedPodIp ?? stickyPodIp;
  if (!preferredPodIp) {
    return [normalizedBase];
  }

  const podDirectBase = normalizedBase.replace(/\/\/api(?::3001)?$/i, `//${preferredPodIp}:3001`);
  if (podDirectBase === normalizedBase) {
    return [normalizedBase];
  }

  if (routeMode === "pinned") {
    return [podDirectBase, normalizedBase];
  }

  return [podDirectBase, normalizedBase];
}

function isEventStream(headers: Headers): boolean {
  const contentType = headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("text/event-stream");
}

async function proxy(req: NextRequest, pathSegments: string[] | undefined): Promise<Response> {
  const upstreamCandidates = buildUpstreamCandidates(req, pathSegments);
  if (upstreamCandidates.length === 0) {
    return Response.json(
      { error: "PERSAI_WEB_API_PROXY_TARGET is not configured" },
      { status: 503 }
    );
  }

  const segments = pathSegments ?? [];
  const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual"
  };
  if (hasBody && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response | null = null;
  let lastError: string | null = null;
  for (const base of upstreamCandidates) {
    const target = `${base}/api/v1${suffix}${url.search}`;
    try {
      upstream = await fetch(target, init);
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "fetch failed";
    }
  }

  if (upstream === null) {
    return Response.json(
      { error: "Upstream API unreachable", detail: lastError ?? "fetch failed" },
      { status: 502 }
    );
  }

  const out = new Headers(upstream.headers);
  out.delete("transfer-encoding");
  out.delete("content-encoding");
  out.delete("content-length");
  if (isEventStream(upstream.headers)) {
    out.set("Cache-Control", "no-cache, no-transform");
    out.set("X-Accel-Buffering", "no");
  }

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out
  });

  if (isAdminOverviewPath(pathSegments)) {
    const routeMode = req.headers.get(OVERVIEW_ROUTE_HEADER)?.trim().toLowerCase();
    const requestedPinnedPodIp = req.headers.get(OVERVIEW_PINNED_POD_IP_HEADER)?.trim();
    const stickyPodIp = upstream.headers.get("X-Persai-Api-Pod-Ip")?.trim();
    if (stickyPodIp) {
      response.cookies.set(OVERVIEW_STICKY_COOKIE, stickyPodIp, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 30
      });
    } else {
      response.cookies.delete(OVERVIEW_STICKY_COOKIE);
    }

    if (routeMode === "pinned" && requestedPinnedPodIp) {
      response.cookies.set(OVERVIEW_PINNED_COOKIE, requestedPinnedPodIp, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 30
      });
    } else if (routeMode === "auto" || routeMode === "probe" || !requestedPinnedPodIp) {
      response.cookies.delete(OVERVIEW_PINNED_COOKIE);
    }
  }

  return response;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
