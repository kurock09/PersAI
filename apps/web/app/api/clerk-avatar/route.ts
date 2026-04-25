import { auth, currentUser } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session.userId) {
    return jsonError("Unauthorized", 401);
  }

  const user = await currentUser();
  const imageUrl = user?.imageUrl?.trim() ?? "";
  if (!imageUrl) {
    return jsonError("Clerk avatar is not available.", 404);
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return jsonError("Clerk avatar URL is invalid.", 502);
  }
  if (parsed.protocol !== "https:") {
    return jsonError("Clerk avatar URL must use https.", 502);
  }

  const upstream = await fetch(parsed, {
    cache: "no-store",
    headers: { Accept: "image/*" }
  });
  const contentType = upstream.headers.get("Content-Type") ?? "application/octet-stream";
  if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
    return jsonError("Unable to load Clerk avatar.", upstream.ok ? 502 : upstream.status);
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "private, max-age=3600, stale-while-revalidate=86400");
  return new Response(upstream.body, { status: 200, headers });
}
