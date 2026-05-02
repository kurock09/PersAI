import type {
  AssistantChatMessageAttachment,
  AttachmentType
} from "../../domain/assistant-chat-message-attachment.entity";
import type { RuntimeAttachmentRef } from "@persai/runtime-contract";
import type { AssistantWebChatMessageAttachmentState } from "../web-chat.types";
import type { RuntimeMediaArtifact } from "../assistant-runtime.facade";

export type MediaChannel = "web" | "telegram" | "whatsapp" | "vk";

export interface PreprocessedMedia {
  normalizedBuffer: Buffer;
  normalizedMime: string;
  normalizedExtension: string;
  transcription: string | null;
  textExtract: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export interface RawInboundAttachment {
  buffer: Buffer;
  mime: string;
  originalFilename: string;
  source: "web_staged_upload" | "telegram_download" | "whatsapp_download" | "vk_download";
}

export interface ResolvedInboundMedia {
  attachments: AssistantChatMessageAttachment[];
  enrichedMessage: string;
  /** Guaranteed user-facing notices (not LLM instructions) for failed attachments. */
  systemNotices: string[];
}

export type MediaArtifact = RuntimeMediaArtifact;

export interface DeliveredMedia {
  attachments: AssistantWebChatMessageAttachmentState[];
}

export interface ChannelTarget {
  channel: MediaChannel;
  chatId: string | number;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export interface InboundMediaResolveParams {
  channel: MediaChannel;
  assistantId: string;
  userId: string;
  chatId: string;
  messageId: string;
  workspaceId: string;
  userMessage: string;
  rawAttachments: RawInboundAttachment[];
}

export interface OutboundMediaDeliverParams {
  artifacts: MediaArtifact[];
  channel: MediaChannel;
  assistantId: string;
  chatId: string;
  messageId: string;
  workspaceId: string;
  channelTarget?: ChannelTarget;
}

export function inferAttachmentTypeFromMime(mime: string): AttachmentType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export function toRuntimeAttachmentRef(
  attachment: Pick<
    AssistantChatMessageAttachment,
    | "id"
    | "assistantFileId"
    | "attachmentType"
    | "storagePath"
    | "mimeType"
    | "originalFilename"
    | "sizeBytes"
  >
): RuntimeAttachmentRef {
  return {
    attachmentId: attachment.id,
    fileRef: attachment.assistantFileId,
    kind: toRuntimeAttachmentKind(attachment.attachmentType),
    objectKey: attachment.storagePath,
    mimeType: attachment.mimeType,
    filename: attachment.originalFilename,
    sizeBytes: Number(attachment.sizeBytes)
  };
}

function toRuntimeAttachmentKind(attachmentType: AttachmentType): RuntimeAttachmentRef["kind"] {
  switch (attachmentType) {
    case "image":
      return "image";
    case "audio":
    case "voice":
      return "audio";
    case "video":
      return "video";
    case "document":
    case "tool_output":
      return "file";
  }
}

export function inferMimeFromUrlAndType(url: string, type: MediaArtifact["type"]): string {
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    opus: "audio/opus",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: type === "audio" ? "audio/webm" : "video/webm",
    pdf: "application/pdf"
  };
  return extMap[ext] ?? (type === "image" ? "image/png" : "application/octet-stream");
}

const ATTACHMENT_CONTENT_PREVIEW_MAX_CHARS = 1_000;

export function buildStoredAttachmentMetadata(input: {
  source?: string;
  textExtract?: string | null;
  originalUrl?: string;
}): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  if (typeof input.source === "string" && input.source.trim().length > 0) {
    metadata.source = input.source;
  }

  const contentPreview = toStoredAttachmentContentPreview(input.textExtract ?? null);
  if (contentPreview !== null) {
    metadata.contentPreview = contentPreview;
  }

  if (typeof input.originalUrl === "string" && input.originalUrl.trim().length > 0) {
    metadata.originalUrl = input.originalUrl;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function readStoredAttachmentContentPreview(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const preview = metadata?.contentPreview;
  return typeof preview === "string" && preview.trim().length > 0 ? preview : null;
}

function toStoredAttachmentContentPreview(textExtract: string | null): string | null {
  if (typeof textExtract !== "string") {
    return null;
  }

  const normalized = textExtract
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ATTACHMENT_CONTENT_PREVIEW_MAX_CHARS);
  return normalized.length > 0 ? normalized : null;
}
