export type AttachmentType = "image" | "audio" | "voice" | "video" | "document" | "tool_output";

export type AttachmentProcessingStatus = "pending" | "ready" | "failed";

export type AssistantChatMessageAttachment = {
  id: string;
  messageId: string;
  chatId: string;
  assistantId: string;
  workspaceId: string;
  assistantFileId: string | null;
  attachmentType: AttachmentType;
  storagePath: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  processingStatus: AttachmentProcessingStatus;
  transcription: string | null;
  metadata: Record<string, unknown> | null;
  clientTurnId: string | null;
  clientAttachmentId: string | null;
  createdAt: Date;
};
