import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

const RESPONSE_PASSTHROUGH_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Cache-Control",
  "Content-Disposition",
  "Last-Modified",
  "ETag"
] as const;
const SESSION_TOKEN_HEADER = "x-persai-session-token";

export async function GET(
  request: Request,
  { params }: { params: Promise<unknown> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = (await getToken()) ?? readSessionTokenHeader(request);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { docId } = (await params) as { docId: string };
  const requestUrl = new URL(request.url);
  const upstream = new URL(
    `${apiBase}/assistant/documents/${encodeURIComponent(docId)}/download-original`
  );
  const versionId = requestUrl.searchParams.get("versionId");
  if (typeof versionId === "string" && versionId.trim().length > 0) {
    upstream.searchParams.set("versionId", versionId.trim());
  }

  const res = await fetch(upstream.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const message = await readUpstreamErrorMessage(res);
    const isGone = res.status === 410;
    return new Response(buildErrorHtml(message, { isGone }), {
      status: res.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store"
      }
    });
  }

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
    passthroughHeaders.set("Cache-Control", "private, max-age=300");
  }

  return new Response(res.body, { status: res.status, headers: passthroughHeaders });
}

function readSessionTokenHeader(request: Request): string | null {
  const value = request.headers.get(SESSION_TOKEN_HEADER)?.trim();
  return value && value.length > 0 ? value : null;
}

async function readUpstreamErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      if (typeof body.message === "string" && body.message.trim().length > 0) {
        return body.message.trim();
      }
      if (typeof body.error === "string" && body.error.trim().length > 0) {
        return body.error.trim();
      }
    }
    const text = await response.text();
    return text.trim().length > 0
      ? text.trim()
      : "Original PPTX is not available right now. The PDF is still available in chat.";
  } catch {
    return "Original PPTX is not available right now. The PDF is still available in chat.";
  }
}

function buildErrorHtml(message: string, options: { isGone: boolean }): string {
  const title = options.isGone ? "Original PPTX expired" : "PPTX download unavailable";
  const escapedTitle = escapeHtml(title);
  const escapedMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b1020;
        color: #e5e7eb;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(520px, calc(100vw - 32px));
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.92);
        border-radius: 24px;
        padding: 28px 24px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      .eyebrow {
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #93c5fd;
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(96, 165, 250, 0.2);
      }
      h1 { margin: 16px 0 10px; font-size: 24px; line-height: 1.2; }
      p { margin: 0; color: #cbd5e1; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">PersAI</div>
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
