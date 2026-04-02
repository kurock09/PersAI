import { NextRequest } from "next/server";

const CLERK_FRONTEND_API = (() => {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const prefix = pk.startsWith("pk_test_")
    ? "pk_test_"
    : pk.startsWith("pk_live_")
      ? "pk_live_"
      : null;
  if (!prefix) return "";
  return Buffer.from(pk.replace(prefix, ""), "base64")
    .toString("utf-8")
    .replace(/\$$/, "");
})();

async function proxy(req: NextRequest) {
  const url = new URL(req.url);
  const upstream = url.pathname.replace(/^\/clerk-proxy/, "") + url.search;
  const target = `https://${CLERK_FRONTEND_API}${upstream}`;

  const headers = new Headers(req.headers);
  headers.set("Host", CLERK_FRONTEND_API);
  headers.delete("connection");

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    redirect: "manual"
  });

  const responseHeaders = new Headers(res.headers);
  responseHeaders.delete("transfer-encoding");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
