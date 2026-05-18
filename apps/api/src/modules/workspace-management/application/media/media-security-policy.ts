import path from "node:path";
import { BadRequestException } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";

export const MAX_MEDIA_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOOL_OUTPUT_PRESENTATION_FILE_BYTES = 100 * 1024 * 1024;

type MediaValidationSurface =
  | "chat_upload"
  | "knowledge_upload"
  | "voice_transcription"
  | "channel_inbound"
  | "tool_output_persist";

const GENERIC_BINARY_MIMES = new Set(["application/octet-stream"]);

const DANGEROUS_FILE_EXTENSIONS = new Set([
  ".app",
  ".appimage",
  ".apk",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".csh",
  ".dll",
  ".dmg",
  ".exe",
  ".hta",
  ".iso",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".mjs",
  ".msi",
  ".msix",
  ".msixbundle",
  ".pkg",
  ".ps1",
  ".ps1xml",
  ".ps2",
  ".psc1",
  ".psc2",
  ".psd1",
  ".psm1",
  ".py",
  ".rb",
  ".reg",
  ".rpm",
  ".scr",
  ".sh",
  ".svg",
  ".vb",
  ".vbe",
  ".vbs",
  ".ws",
  ".wsf"
]);

const SAFE_MIME_BY_EXTENSION: Record<string, string> = {
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const ALLOWED_MEDIA_MIMES = new Set([
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-opus+ogg",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo"
]);

const OFFICE_DOCUMENT_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const GENERIC_OFFICE_CONTAINER_MIMES = new Set(["application/zip", "application/x-cfb"]);

function normalizeMime(mime: string | null | undefined): string | null {
  if (typeof mime !== "string") {
    return null;
  }
  const normalized = (mime.split(";")[0] ?? mime).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeExtension(filename: string | null | undefined): string | null {
  if (typeof filename !== "string" || filename.trim().length === 0) {
    return null;
  }
  const ext = path.extname(filename.trim()).toLowerCase();
  return ext.length > 0 ? ext : null;
}

function containsUnicodeControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function normalizeOriginalFilename(filename: string | null | undefined): string | null {
  if (typeof filename !== "string") {
    return null;
  }
  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const looksLikeUtf8Mojibake = containsUnicodeControlCharacters(trimmed) || /[ÃÐÑ]/.test(trimmed);
  if (!looksLikeUtf8Mojibake) {
    return trimmed;
  }

  const repaired = Buffer.from(trimmed, "latin1").toString("utf8").trim();
  if (
    repaired.length === 0 ||
    repaired.includes("\uFFFD") ||
    containsUnicodeControlCharacters(repaired)
  ) {
    return trimmed;
  }

  return repaired;
}

function isAllowedMime(mime: string | null): mime is string {
  return mime !== null && ALLOWED_MEDIA_MIMES.has(mime);
}

function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
}

function resolveMaxAllowedBytes(input: {
  surface: MediaValidationSurface;
  headerMime: string | null;
  extensionMime: string | null;
}): number {
  const looksLikePresentation =
    input.headerMime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    input.extensionMime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (input.surface === "tool_output_persist" && looksLikePresentation) {
    return MAX_TOOL_OUTPUT_PRESENTATION_FILE_BYTES;
  }
  return MAX_MEDIA_FILE_BYTES;
}

export type ValidatedMediaFile = {
  effectiveMimeType: string;
  normalizedExtension: string | null;
  originalFilename: string | null;
  sniffedMimeType: string | null;
};

export async function validatePersaiMediaFile(params: {
  buffer: Buffer;
  mimeType: string | null | undefined;
  originalFilename?: string | null;
  surface: MediaValidationSurface;
}): Promise<ValidatedMediaFile> {
  const normalizedOriginalFilename = normalizeOriginalFilename(params.originalFilename);
  const normalizedExtension = normalizeExtension(normalizedOriginalFilename);
  const headerMime = normalizeMime(params.mimeType);
  const extensionMime = normalizedExtension
    ? (SAFE_MIME_BY_EXTENSION[normalizedExtension] ?? null)
    : null;
  const maxAllowedBytes = resolveMaxAllowedBytes({
    surface: params.surface,
    headerMime,
    extensionMime
  });
  if (params.buffer.length > maxAllowedBytes) {
    throw new BadRequestException(
      `File exceeds maximum size of ${String(maxAllowedBytes / (1024 * 1024))}MB.`
    );
  }
  if (normalizedExtension && DANGEROUS_FILE_EXTENSIONS.has(normalizedExtension)) {
    throw new BadRequestException(
      `Files with ${normalizedExtension} extension are blocked by security policy.`
    );
  }

  const sniffedMime = normalizeMime((await fileTypeFromBuffer(params.buffer))?.mime ?? null);
  const declaredOfficeMime =
    headerMime !== null && OFFICE_DOCUMENT_MIMES.has(headerMime)
      ? headerMime
      : extensionMime !== null && OFFICE_DOCUMENT_MIMES.has(extensionMime)
        ? extensionMime
        : null;

  if (
    sniffedMime !== null &&
    !isAllowedMime(sniffedMime) &&
    !(declaredOfficeMime !== null && GENERIC_OFFICE_CONTAINER_MIMES.has(sniffedMime))
  ) {
    throw new BadRequestException(`Detected file type "${sniffedMime}" is not allowed.`);
  }

  const headerMimeAllowed =
    headerMime !== null && !GENERIC_BINARY_MIMES.has(headerMime) && isAllowedMime(headerMime)
      ? headerMime
      : null;

  // WebM containers with audio-only content (e.g. opus voice recordings) are
  // sniffed as video/webm by file-type. When the client declares audio/webm,
  // prefer the header to keep downstream attachmentType = "audio".
  const preferHeaderOverSniff =
    sniffedMime === "video/webm" && headerMimeAllowed !== null && isAudioMime(headerMimeAllowed);
  const preferDeclaredOfficeMime =
    declaredOfficeMime !== null &&
    sniffedMime !== null &&
    GENERIC_OFFICE_CONTAINER_MIMES.has(sniffedMime);

  const effectiveMimeType = preferHeaderOverSniff
    ? headerMimeAllowed
    : preferDeclaredOfficeMime
      ? declaredOfficeMime
      : (sniffedMime ?? headerMimeAllowed ?? extensionMime);

  if (!isAllowedMime(effectiveMimeType ?? null)) {
    if (headerMime !== null && GENERIC_BINARY_MIMES.has(headerMime)) {
      throw new BadRequestException(
        "Generic binary uploads are blocked unless a safe file type can be verified."
      );
    }
    throw new BadRequestException("Unsupported or unsafe file type.");
  }
  if (effectiveMimeType === null) {
    throw new BadRequestException("Unsupported or unsafe file type.");
  }

  const safeMimeType: string = effectiveMimeType;

  if (params.surface === "voice_transcription" && !isAudioMime(safeMimeType)) {
    throw new BadRequestException("Only safe audio files can be transcribed.");
  }

  return {
    effectiveMimeType: safeMimeType,
    normalizedExtension,
    originalFilename: normalizedOriginalFilename,
    sniffedMimeType: sniffedMime
  };
}
