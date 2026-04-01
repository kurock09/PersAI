import { auth } from "@clerk/nextjs/server";

const apiProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const upstream = `${apiProxyTarget.replace(/\/$/, "")}/api/v1/assistant/attachment/${encodeURIComponent(id)}`;

  const res = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  }

  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", res.headers.get("Cache-Control") ?? "private, max-age=3600");
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) {
    headers.set("Content-Disposition", disposition);
  }

  return new Response(res.body, { status: 200, headers });
}
