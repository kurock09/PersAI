import type {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";

const DEFAULT_AUDIO_PREVIEW_TIMEOUT_MS = 15_000;

const PASSTHROUGH_HEADERS = [
  "Accept-Ranges",
  "Cache-Control",
  "Content-Disposition",
  "Content-Length",
  "Content-Range",
  "Content-Type",
  "ETag",
  "Last-Modified"
] as const;

function normalizeAudioContentType(sourceUrl: string, rawContentType: string | null): string {
  const normalized = rawContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    normalized.startsWith("audio/") &&
    normalized !== "audio/octet-stream" &&
    normalized !== "audio/*"
  ) {
    return normalized;
  }
  const pathname = new URL(sourceUrl).pathname.toLowerCase();
  if (pathname.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (pathname.endsWith(".wav")) {
    return "audio/wav";
  }
  return "application/octet-stream";
}

export async function streamRemoteAudioPreview(input: {
  request: RequestWithPlatformContext;
  response: ResponseWithPlatformContext;
  sourceUrl: string;
}): Promise<void> {
  const headers = new Headers({ Accept: "audio/*,*/*;q=0.8" });
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = input.request.headers[name];
    if (typeof value === "string" && value.trim().length > 0) {
      headers.set(name, value);
    }
  }

  const upstream = await fetch(input.sourceUrl, {
    headers,
    signal: AbortSignal.timeout(DEFAULT_AUDIO_PREVIEW_TIMEOUT_MS)
  });

  input.response.statusCode = upstream.status;
  for (const name of PASSTHROUGH_HEADERS) {
    const value =
      name === "Content-Type"
        ? normalizeAudioContentType(input.sourceUrl, upstream.headers.get(name))
        : upstream.headers.get(name);
    if (value !== null && value.length > 0) {
      input.response.setHeader(name, value);
    }
  }
  if (input.response.getHeader("Cache-Control") === undefined) {
    input.response.setHeader("Cache-Control", "private, max-age=3600");
  }
  if (
    input.response.getHeader("Accept-Ranges") === undefined &&
    (upstream.status === 200 || upstream.status === 206)
  ) {
    input.response.setHeader("Accept-Ranges", "bytes");
  }
  if (upstream.status === 304) {
    input.response.end();
    return;
  }

  input.response.end(Buffer.from(await upstream.arrayBuffer()));
}
