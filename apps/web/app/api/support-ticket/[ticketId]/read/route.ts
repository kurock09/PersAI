import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

export async function POST(
  _request: Request,
  { params }: { params: Promise<unknown> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticketId } = (await params) as { ticketId: string };
  const upstream = `${apiBase}/support/tickets/${encodeURIComponent(ticketId)}/read`;
  const res = await fetch(upstream, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  const headers = new Headers();
  const contentType = res.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  return new Response(res.body, { status: res.status, headers });
}
