import { auth } from "@clerk/nextjs/server";

/**
 * ADR-076 Slice 4 — content-addressed avatar BFF.
 *
 * The browser requests `/api/avatar/<hash>.<ext>` which is the URL emitted
 * into `assistant.draft.avatarUrl` / `assistant.published.avatarUrl`. This
 * route handler authenticates the Clerk cookie session, fetches the bytes
 * from the `apps/api` bearer-protected endpoint
 * `GET /api/v1/assistant/avatar/:hash`, and forwards them with
 * `Cache-Control: private, max-age=31536000, immutable` plus an `ETag`
 * derived from the hash. Mismatched hashes (stale CDN, prior session) get
 * `404` from `apps/api` and we propagate that so the UI falls back to the
 * emoji avatar.
 */

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

const HASH_FROM_PARAM = /^([a-f0-9]{8,64})(?:\.[a-z0-9]+)?$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hash: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await session.getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { hash: rawHash } = await params;
  const match = HASH_FROM_PARAM.exec(rawHash);
  if (!match) {
    return Response.json({ error: "Invalid avatar identifier." }, { status: 400 });
  }
  const hash = match[1] as string;

  const upstream = `${apiBase}/assistant/avatar/${encodeURIComponent(hash)}`;
  const upstreamResponse = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (upstreamResponse.status === 404) {
    return Response.json({ error: "Avatar not found." }, { status: 404 });
  }

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
  headers.set("ETag", `"${hash}"`);

  return new Response(upstreamResponse.body, { status: 200, headers });
}
