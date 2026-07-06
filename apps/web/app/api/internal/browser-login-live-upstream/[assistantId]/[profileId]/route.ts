import { auth } from "@clerk/nextjs/server";
import { readApiBaseUrl } from "@/app/lib/browser-login-live-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveAuthToken(): Promise<string | null> {
  const { getToken } = await auth();
  return (await getToken()) ?? null;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ assistantId: string; profileId: string }> }
): Promise<Response> {
  const { assistantId, profileId } = await ctx.params;
  const token = await resolveAuthToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const upstream = `${readApiBaseUrl()}/assistant/${encodeURIComponent(assistantId)}/browser-profiles/${encodeURIComponent(profileId)}/live-upstream`;
  const response = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) {
    return Response.json({ error: "Browser login live session is unavailable." }, { status: 404 });
  }
  const payload = (await response.json()) as { upstreamLiveUrl?: unknown };
  if (typeof payload.upstreamLiveUrl !== "string" || payload.upstreamLiveUrl.trim().length === 0) {
    return Response.json({ error: "Browser login live session is unavailable." }, { status: 404 });
  }
  return Response.json({ upstreamLiveUrl: payload.upstreamLiveUrl.trim() });
}
