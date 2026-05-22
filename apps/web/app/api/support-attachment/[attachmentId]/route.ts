import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

export async function GET(
  _request: Request,
  { params }: { params: Promise<unknown> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { attachmentId } = (await params) as { attachmentId: string };
  const upstream = `${apiBase}/support/attachments/${encodeURIComponent(attachmentId)}`;
  const res = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const headers = new Headers();
  const contentType = res.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const cacheControl = res.headers.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  return new Response(res.body, { status: res.status, headers });
}
