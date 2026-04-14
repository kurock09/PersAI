type FileLike = {
  type?: string | null | undefined;
  name?: string | null | undefined;
};

const CHAT_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/json"
] as const;

const CHAT_ATTACHMENT_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp3",
  ".ogg",
  ".wav",
  ".webm",
  ".mp4",
  ".pdf",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".csv",
  ".xls",
  ".xlsx",
  ".json"
] as const;

const KNOWLEDGE_ELIGIBLE_MIME_TYPES = new Set<string>([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/json"
]);

const KNOWLEDGE_ELIGIBLE_EXTENSIONS = new Set<string>([
  ".pdf",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".csv",
  ".xls",
  ".xlsx",
  ".json"
]);

const CHAT_ATTACHMENT_ACCEPT_ITEMS = [...CHAT_ATTACHMENT_MIME_TYPES, ...CHAT_ATTACHMENT_EXTENSIONS];

const ACCEPTED_CHAT_ATTACHMENT_MIME_TYPES = new Set<string>(CHAT_ATTACHMENT_MIME_TYPES);
const ACCEPTED_CHAT_ATTACHMENT_EXTENSIONS = new Set<string>(CHAT_ATTACHMENT_EXTENSIONS);

export const CHAT_ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_ACCEPT_ITEMS.join(",");

function normalizeMime(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = (value.split(";")[0] ?? value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeExtension(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(dotIndex);
}

export function isAcceptedChatFile(file: FileLike): boolean {
  const mime = normalizeMime(file.type);
  if (mime !== null && ACCEPTED_CHAT_ATTACHMENT_MIME_TYPES.has(mime)) {
    return true;
  }
  const extension = normalizeExtension(file.name);
  return extension !== null && ACCEPTED_CHAT_ATTACHMENT_EXTENSIONS.has(extension);
}

export function isKnowledgeEligibleFile(file: FileLike): boolean {
  const mime = normalizeMime(file.type);
  if (mime !== null && KNOWLEDGE_ELIGIBLE_MIME_TYPES.has(mime)) {
    return true;
  }
  const extension = normalizeExtension(file.name);
  return extension !== null && KNOWLEDGE_ELIGIBLE_EXTENSIONS.has(extension);
}
