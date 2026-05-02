import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileRef: string }> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileRef } = await params;
  const requestUrl = new URL(request.url);
  const upstream = new URL(`${apiBase}/assistant/files/${encodeURIComponent(fileRef)}/download`);
  const download = requestUrl.searchParams.get("download");
  if (download === "1") {
    upstream.searchParams.set("download", "1");
  }

  const res = await fetch(upstream.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" }
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
