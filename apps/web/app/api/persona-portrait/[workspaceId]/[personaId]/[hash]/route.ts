import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

const SAFE_ID = /^[a-z0-9_-]+$/i;
const SAFE_HASH = /^[a-f0-9]{8,64}(?:\.[a-z0-9]+)?$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<unknown> }
): Promise<Response> {
  const session = await auth();
  if (!session.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await session.getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const routeParams = (await params) as {
    workspaceId: string;
    personaId: string;
    hash: string;
  };
  if (
    !SAFE_ID.test(routeParams.workspaceId) ||
    !SAFE_ID.test(routeParams.personaId) ||
    !SAFE_HASH.test(routeParams.hash)
  ) {
    return Response.json({ error: "Invalid portrait identifier." }, { status: 400 });
  }

  const upstream = `${apiBase}/workspaces/${encodeURIComponent(
    routeParams.workspaceId
  )}/video-personas/${encodeURIComponent(routeParams.personaId)}/portrait`;
  const upstreamResponse = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (!upstreamResponse.ok) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json"
      }
    });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstreamResponse.headers.get("Content-Type") ?? "application/octet-stream"
  );
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("ETag", upstreamResponse.headers.get("ETag") ?? `"${routeParams.hash}"`);

  return new Response(upstreamResponse.body, { status: 200, headers });
}
