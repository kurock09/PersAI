import type {
  AssistantChatMessageAttachment,
  AttachmentType
} from "../../domain/assistant-chat-message-attachment.entity";
import type { RuntimeAttachmentRef, RuntimeBillingFacts } from "@persai/runtime-contract";
import type { AssistantWebChatMessageAttachmentState } from "../web-chat.types";
import type { RuntimeMediaArtifact } from "../assistant-runtime.facade";

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
export const ATTACHMENT_SEMANTIC_SUMMARY_MAX_CHARS = 140;

export const ATTACHMENT_SEMANTIC_SUMMARY_SOURCES = [
  "text_extract",
  "transcription",
  "upload_micro_description",
  "generation_request"
] as const;

export type AttachmentSemanticSummarySource = (typeof ATTACHMENT_SEMANTIC_SUMMARY_SOURCES)[number];

export const ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA = "persai.mediaDerivatives.v1";

export type AssistantFileMediaDerivativeKind = "thumbnail" | "poster";
export type AssistantFileMediaDerivativesStatus = "pending" | "ready" | "failed";

export type AssistantFileMediaDerivativeDescriptor = {
  fileRef: string;
  objectKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
};

export type AssistantFileMediaDerivativesMetadata = {
  schemaVersion: typeof ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA;
  status: AssistantFileMediaDerivativesStatus;
  thumbnail: AssistantFileMediaDerivativeDescriptor | null;
  poster: AssistantFileMediaDerivativeDescriptor | null;
  lastError: string | null;
  updatedAt: string | null;
};

function asMetadataObject(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  return metadata !== null &&
    metadata !== undefined &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
    ? metadata
    : null;
}

function readDerivativeDescriptor(value: unknown): AssistantFileMediaDerivativeDescriptor | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.fileRef !== "string" ||
    typeof row.objectKey !== "string" ||
    typeof row.mimeType !== "string" ||
    typeof row.sizeBytes !== "number"
  ) {
    return null;
  }
  return {
    fileRef: row.fileRef,
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    sizeBytes: row.sizeBytes
  };
}

export function readAssistantFileMediaDerivatives(
  metadata: Record<string, unknown> | null | undefined
): AssistantFileMediaDerivativesMetadata | null {
  const base = asMetadataObject(metadata);
  const raw = base?.mediaDerivatives;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    row.schemaVersion !== ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA ||
    (row.status !== "pending" && row.status !== "ready" && row.status !== "failed")
  ) {
    return null;
  }
  return {
    schemaVersion: ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA,
    status: row.status,
    thumbnail: row.thumbnail === undefined ? null : readDerivativeDescriptor(row.thumbnail),
    poster: row.poster === undefined ? null : readDerivativeDescriptor(row.poster),
    lastError: typeof row.lastError === "string" ? row.lastError : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null
  };
}

export function withAssistantFileMediaDerivatives(input: {
  metadata: Record<string, unknown> | null | undefined;
  derivatives: AssistantFileMediaDerivativesMetadata | null;
}): Record<string, unknown> | null {
  const base = asMetadataObject(input.metadata) ?? {};
  if (input.derivatives === null) {
    const { mediaDerivatives: _removed, ...rest } = base;
    return Object.keys(rest).length > 0 ? rest : null;
  }
  return {
    ...base,
    mediaDerivatives: input.derivatives
  };
}

export function getAttachmentDerivativeRefs(metadata: Record<string, unknown> | null | undefined): {
  thumbnailFileRef: string | null;
  posterFileRef: string | null;
  derivativesStatus: AssistantFileMediaDerivativesStatus | null;
} {
  const derivatives = readAssistantFileMediaDerivatives(metadata);
  const flatThumbnailFileRef =
    typeof metadata?.thumbnailFileRef === "string" && metadata.thumbnailFileRef.trim().length > 0
      ? metadata.thumbnailFileRef.trim()
      : null;
  const flatPosterFileRef =
    typeof metadata?.posterFileRef === "string" && metadata.posterFileRef.trim().length > 0
      ? metadata.posterFileRef.trim()
      : null;
  const flatStatus =
    metadata?.derivativesStatus === "pending" ||
    metadata?.derivativesStatus === "ready" ||
    metadata?.derivativesStatus === "failed"
      ? metadata.derivativesStatus
      : null;
  return {
    thumbnailFileRef: derivatives?.thumbnail?.fileRef ?? flatThumbnailFileRef,
    posterFileRef: derivatives?.poster?.fileRef ?? flatPosterFileRef,
    derivativesStatus: derivatives?.status ?? flatStatus
  };
}

export function buildStoredAttachmentMetadata(input: {
  source?: string;
  textExtract?: string | null;
  transcription?: string | null;
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

  const semantic = deriveStoredAttachmentSemanticSummary({
    textExtract: input.textExtract ?? null,
    transcription: input.transcription ?? null
  });
  if (semantic.semanticSummary !== null) {
    metadata.semanticSummary = semantic.semanticSummary;
    metadata.semanticSummarySource = semantic.semanticSummarySource;
  }

  if (typeof input.originalUrl === "string" && input.originalUrl.trim().length > 0) {
    metadata.originalUrl = input.originalUrl;
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

export function readStoredAttachmentSemanticSummary(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const summary = metadata?.semanticSummary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary : null;
}

export function readStoredAttachmentSemanticSummarySource(
  metadata: Record<string, unknown> | null | undefined
): AttachmentSemanticSummarySource | null {
  const source = metadata?.semanticSummarySource;
  return source === "text_extract" ||
    source === "transcription" ||
    source === "upload_micro_description" ||
    source === "generation_request"
    ? source
    : null;
}

export function withStoredAttachmentSemanticSummary(input: {
  metadata: Record<string, unknown> | null | undefined;
  semanticSummary: string | null | undefined;
  semanticSummarySource: AttachmentSemanticSummarySource | null | undefined;
}): Record<string, unknown> | null {
  const base =
    input.metadata !== null &&
    input.metadata !== undefined &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {};
  const semanticSummary = toStoredAttachmentSemanticSummary(input.semanticSummary ?? null);
  const semanticSummarySource = input.semanticSummarySource ?? null;
  if (semanticSummary === null || semanticSummarySource === null) {
    delete base.semanticSummary;
    delete base.semanticSummarySource;
    return Object.keys(base).length > 0 ? base : null;
  }
  return {
    ...base,
    semanticSummary,
    semanticSummarySource
  };
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
