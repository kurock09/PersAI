const DEFAULT_RUNTIME_MEDIA_FETCH_TIMEOUT_MS = 20_000;

export async function downloadRuntimeMediaUrl(
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const trimmedUrl = url.trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    return null;
  }

  const response = await fetch(trimmedUrl, {
    signal: AbortSignal.timeout(DEFAULT_RUNTIME_MEDIA_FETCH_TIMEOUT_MS)
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType:
      response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream"
  };
}
