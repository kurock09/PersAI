import type {
  AssistantChatMessageAttachment,
  AttachmentType
} from "../../domain/assistant-chat-message-attachment.entity";
import type { RuntimeAttachmentRef, RuntimeBillingFacts } from "@persai/runtime-contract";
import type { AssistantWebChatMessageAttachmentState } from "../web-chat.types";
import type { RuntimeMediaArtifact } from "../assistant-runtime.facade";
import { readPersistedDocumentLinkMetadata } from "../read-attachment-document-link";

export type MediaChannel = "web" | "telegram" | "whatsapp" | "vk";

export interface PreprocessedMedia {
  normalizedBuffer: Buffer;
  normalizedMime: string;
  normalizedExtension: string;
  transcription: string | null;
  billingFacts: RuntimeBillingFacts | null;
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
}

export type MediaArtifact = RuntimeMediaArtifact;

export interface DeliveredMedia {
  attachments: AssistantWebChatMessageAttachmentState[];
  externalDeliveries?: Array<{
    type: MediaArtifact["type"];
    url: string;
    filename: string | null;
    reason: "file_too_large_for_inline_delivery";
  }>;
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
  runtimeSessionId: string;
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
  runtimeSessionId?: string | null;
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
    "id" | "attachmentType" | "storagePath" | "mimeType" | "originalFilename" | "sizeBytes"
  >
): RuntimeAttachmentRef {
  return {
    attachmentId: attachment.id,
    kind: toRuntimeAttachmentKind(attachment.attachmentType),
    storagePath: attachment.storagePath ?? "",
    mimeType: attachment.mimeType,
    displayName: attachment.originalFilename,
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
    opus: "audio/ogg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: type === "audio" ? "audio/webm" : "video/webm",
    pdf: "application/pdf"
  };
  return extMap[ext] ?? (type === "image" ? "image/png" : "application/octet-stream");
}

const ATTACHMENT_CONTENT_PREVIEW_MAX_CHARS = 1_000;
export const ATTACHMENT_SEMANTIC_SUMMARY_MAX_CHARS = 140;

export const ATTACHMENT_SEMANTIC_SUMMARY_SOURCES = [
  "text_extract",
  "transcription",
  "upload_micro_description",
  "generation_request"
] as const;

export type AttachmentSemanticSummarySource = (typeof ATTACHMENT_SEMANTIC_SUMMARY_SOURCES)[number];

export const EXTERNAL_DOWNLOAD_STORAGE_PATH_PREFIX = "external-download/" as const;

export function readExternalDownloadUrl(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const value = metadata?.externalDownloadUrl;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function toAssistantWebChatMessageAttachmentState(input: {
  id: string;
  storagePath: string | null;
  thumbnailStoragePath?: string | null;
  posterStoragePath?: string | null;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint | number;
  processingStatus: string;
  metadata: Record<string, unknown> | null | undefined;
  createdAt: Date | string;
  documentLink?: AssistantWebChatMessageAttachmentState["documentLink"];
}): AssistantWebChatMessageAttachmentState {
  const metadata =
    input.metadata !== null && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : null;
  const externalDownloadUrl = readExternalDownloadUrl(metadata);
  const documentLink =
    input.documentLink === undefined
      ? readPersistedDocumentLinkMetadata(metadata)
      : input.documentLink;
  const unavailable =
    input.processingStatus === "unavailable" ||
    input.storagePath === null ||
    input.storagePath.trim().length === 0;
  return {
    id: input.id,
    path: input.storagePath,
    thumbnailStoragePath: input.thumbnailStoragePath ?? null,
    posterStoragePath: input.posterStoragePath ?? null,
    attachmentType: input.attachmentType,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: Number(input.sizeBytes),
    processingStatus: input.processingStatus,
    ...(unavailable ? { unavailable: true } : {}),
    ...(externalDownloadUrl !== null ? { externalDownloadUrl } : {}),
    ...(documentLink === null ? {} : { documentLink }),
    createdAt: typeof input.createdAt === "string" ? input.createdAt : input.createdAt.toISOString()
  };
}

export function buildStoredAttachmentMetadata(input: {
  source?: string;
  textExtract?: string | null;
  transcription?: string | null;
  originalUrl?: string;
  deliveryMode?: "external_download";
  externalDownloadUrl?: string;
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

  if (input.deliveryMode === "external_download") {
    metadata.deliveryMode = input.deliveryMode;
  }

  if (
    typeof input.externalDownloadUrl === "string" &&
    input.externalDownloadUrl.trim().length > 0
  ) {
    metadata.externalDownloadUrl = input.externalDownloadUrl.trim();
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function deriveStoredAttachmentSemanticSummary(input: {
  textExtract?: string | null;
  transcription?: string | null;
}): {
  semanticSummary: string | null;
  semanticSummarySource: AttachmentSemanticSummarySource | null;
} {
  const fromTranscription = toStoredAttachmentSemanticSummary(input.transcription ?? null);
  if (fromTranscription !== null) {
    return { semanticSummary: fromTranscription, semanticSummarySource: "transcription" };
  }
  const fromTextExtract = toStoredAttachmentSemanticSummary(input.textExtract ?? null);
  if (fromTextExtract !== null) {
    return { semanticSummary: fromTextExtract, semanticSummarySource: "text_extract" };
  }
  return { semanticSummary: null, semanticSummarySource: null };
}

export function normalizeStoredAttachmentSemanticSummary(text: string | null): string | null {
  return toStoredAttachmentSemanticSummary(text);
}

function toStoredAttachmentSemanticSummary(text: string | null): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const normalized = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ATTACHMENT_SEMANTIC_SUMMARY_MAX_CHARS);
  return normalized.length > 0 ? normalized : null;
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
