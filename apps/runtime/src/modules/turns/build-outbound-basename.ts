const MIME_EXTENSION_MAP: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"
};

export function extensionFromFilenameOrMime(
  filenameHint: string | null | undefined,
  mimeType: string
): string {
  const trimmedHint = filenameHint?.trim() ?? "";
  if (trimmedHint.length > 0) {
    const dotIndex = trimmedHint.lastIndexOf(".");
    if (dotIndex > 0 && dotIndex < trimmedHint.length - 1) {
      const extension = trimmedHint
        .slice(dotIndex + 1)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      if (extension.length > 0) {
        return extension;
      }
    }
  }

  const normalizedMime = mimeType.trim().toLowerCase();
  return MIME_EXTENSION_MAP[normalizedMime] ?? "bin";
}

export function buildOutboundBasename(input: {
  slugSourceText: string;
  extension: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const isoSecond = now.toISOString().slice(0, 19) + "Z";
  const slug = slugifyOutboundBasename(input.slugSourceText) || "artefact";
  const extension = input.extension.trim().replace(/^\.+/, "").toLowerCase() || "bin";
  return `${isoSecond}-${slug}.${extension}`;
}

function slugifyOutboundBasename(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
