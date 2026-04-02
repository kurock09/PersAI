import type { NextRequest } from "next/server";

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

async function proxy(req: NextRequest, pathSegments: string[] | undefined): Promise<Response> {
  const base = apiUpstreamBase();
  if (!base) {
    return Response.json(
      { error: "PERSAI_WEB_API_PROXY_TARGET is not configured" },
      { status: 503 }
    );
  }

  const segments = pathSegments ?? [];
  const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
  const url = new URL(req.url);
  const target = `${base}/api/v1${suffix}${url.search}`;

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

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return Response.json({ error: "Upstream API unreachable", detail: message }, { status: 502 });
  }

  const out = new Headers(upstream.headers);
  out.delete("transfer-encoding");
  out.delete("content-encoding");
  out.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out
  });
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
