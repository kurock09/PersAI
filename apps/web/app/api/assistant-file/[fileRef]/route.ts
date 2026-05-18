import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

// HTTP headers we want to mirror back from the upstream API to the WebView /
// browser. Range support is critical for `<video>` playback in Android
// Capacitor WebView: without `Accept-Ranges` + a real `206 Partial Content`
// answer to the initial `Range: bytes=0-` probe the WebView shows a grey
// poster and never plays. Forwarding `Content-Length` / `Content-Range` /
// `Last-Modified` / `ETag` keeps the player able to seek and resume.
const RESPONSE_PASSTHROUGH_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Content-Range",
  "Accept-Ranges",
  "Cache-Control",
  "Content-Disposition",
  "Last-Modified",
  "ETag"
] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<unknown> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileRef } = (await params) as { fileRef: string };
  const requestUrl = new URL(request.url);
  const upstream = new URL(`${apiBase}/assistant/files/${encodeURIComponent(fileRef)}/download`);
  const download = requestUrl.searchParams.get("download");
  if (download === "1") {
    upstream.searchParams.set("download", "1");
  }

  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  const range = request.headers.get("range");
  if (range) {
    upstreamHeaders.Range = range;
  }
  const ifRange = request.headers.get("if-range");
  if (ifRange) {
    upstreamHeaders["If-Range"] = ifRange;
  }
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) {
    upstreamHeaders["If-None-Match"] = ifNoneMatch;
  }
  const ifModifiedSince = request.headers.get("if-modified-since");
  if (ifModifiedSince) {
    upstreamHeaders["If-Modified-Since"] = ifModifiedSince;
  }

  const res = await fetch(upstream.toString(), { headers: upstreamHeaders });

  const passthroughHeaders = new Headers();
  for (const name of RESPONSE_PASSTHROUGH_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) {
      passthroughHeaders.set(name, value);
    }
  }
  if (!passthroughHeaders.has("Content-Type")) {
    passthroughHeaders.set("Content-Type", "application/octet-stream");
  }
  if (!passthroughHeaders.has("Cache-Control")) {
    passthroughHeaders.set("Cache-Control", "private, max-age=3600");
  }
  if (!passthroughHeaders.has("Accept-Ranges") && (res.ok || res.status === 206)) {
    // Hint to the WebView that ranged requests are supported even if upstream
    // forgot the header — without this the player can decide not to seek.
    passthroughHeaders.set("Accept-Ranges", "bytes");
  }

  // Preserve real upstream status (200 OK, 206 Partial Content, 304 Not
  // Modified, 404, etc.). Hard-coding 200 broke ranged playback on Android.
  return new Response(res.body, { status: res.status, headers: passthroughHeaders });
}
