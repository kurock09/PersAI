import path from "node:path";
import { BadRequestException } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";

export const MAX_MEDIA_FILE_BYTES = 25 * 1024 * 1024;

type MediaValidationSurface =
  | "chat_upload"
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
  ".png": "image/png",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp"
};

const ALLOWED_MEDIA_MIMES = new Set([
  "application/json",
  "application/pdf",
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

function isAllowedMime(mime: string | null): mime is string {
  return mime !== null && ALLOWED_MEDIA_MIMES.has(mime);
}

function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
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
  if (params.buffer.length > MAX_MEDIA_FILE_BYTES) {
    throw new BadRequestException(
      `File exceeds maximum size of ${String(MAX_MEDIA_FILE_BYTES / (1024 * 1024))}MB.`
    );
  }

  const normalizedExtension = normalizeExtension(params.originalFilename);
  if (normalizedExtension && DANGEROUS_FILE_EXTENSIONS.has(normalizedExtension)) {
    throw new BadRequestException(
      `Files with ${normalizedExtension} extension are blocked by security policy.`
    );
  }

  const headerMime = normalizeMime(params.mimeType);
  const sniffedMime = normalizeMime((await fileTypeFromBuffer(params.buffer))?.mime ?? null);
  const extensionMime = normalizedExtension
    ? (SAFE_MIME_BY_EXTENSION[normalizedExtension] ?? null)
    : null;

  if (sniffedMime !== null && !isAllowedMime(sniffedMime)) {
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

  const effectiveMimeType = preferHeaderOverSniff
    ? headerMimeAllowed
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
    originalFilename:
      typeof params.originalFilename === "string" && params.originalFilename.trim().length > 0
        ? params.originalFilename
        : null,
    sniffedMimeType: sniffedMime
  };
}
