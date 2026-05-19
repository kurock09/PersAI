import { auth } from "@clerk/nextjs/server";

const rawProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET ?? "http://localhost:3001";
const apiBase = rawProxyTarget.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

const SESSION_TOKEN_HEADER = "x-persai-session-token";

export async function POST(
  request: Request,
  { params }: { params: Promise<unknown> }
): Promise<Response> {
  const { getToken } = await auth();
  const token = readSessionTokenHeader(request) ?? (await getToken());
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { docId } = (await params) as { docId: string };
  const requestUrl = new URL(request.url);
  const versionId = requestUrl.searchParams.get("versionId");
  const upstream = new URL(
    `${apiBase}/assistant/documents/${encodeURIComponent(docId)}/prepare-pptx`
  );

  const res = await fetch(upstream.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      versionId:
        typeof versionId === "string" && versionId.trim().length > 0 ? versionId.trim() : null
    })
  });

  const body = await readResponseBody(res);
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json; charset=utf-8",
      "Cache-Control": "private, no-store"
    }
  });
}

function readSessionTokenHeader(request: Request): string | null {
  const value = request.headers.get(SESSION_TOKEN_HEADER)?.trim();
  return value && value.length > 0 ? value : null;
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().length > 0 ? text : "{}";
  } catch {
    return JSON.stringify({ error: "PPTX preparation response could not be read." });
  }
}
