import type { RuntimeBillingFacts } from "@persai/runtime-contract";

export type AttachmentType = "image" | "audio" | "voice" | "video" | "document" | "tool_output";

export type AttachmentProcessingStatus = "pending" | "ready" | "failed" | "unavailable";

export type AssistantChatMessageAttachment = {
  id: string;
  messageId: string;
  chatId: string;
  assistantId: string;
  workspaceId: string;
  attachmentType: AttachmentType;
  storagePath: string | null;
  thumbnailStoragePath: string | null;
  posterStoragePath: string | null;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  processingStatus: AttachmentProcessingStatus;
  transcription: string | null;
  billingFacts: RuntimeBillingFacts | null;
  metadata: Record<string, unknown> | null;
  clientTurnId: string | null;
  clientAttachmentId: string | null;
  createdAt: Date;
};
