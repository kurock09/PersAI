import type {
  AssistantChatMessageAttachment,
  AttachmentType
} from "../../domain/assistant-chat-message-attachment.entity";
import type { AssistantWebChatMessageAttachmentState } from "../web-chat.types";

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
}

export interface MediaArtifact {
  url: string;
  type: "image" | "audio" | "video" | "document";
  audioAsVoice?: boolean | undefined;
  caption?: string | undefined;
}

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
