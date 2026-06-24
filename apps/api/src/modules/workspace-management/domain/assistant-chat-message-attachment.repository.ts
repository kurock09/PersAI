import type { RuntimeBillingFacts } from "@persai/runtime-contract";
import type {
  AssistantChatMessageAttachment,
  AttachmentProcessingStatus,
  AttachmentType
} from "./assistant-chat-message-attachment.entity";

export const ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY = Symbol(
  "ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY"
);

export type CreateAttachmentInput = {
  messageId: string;
  chatId: string;
  assistantId: string;
  workspaceId: string;
  attachmentType: AttachmentType;
  storagePath: string | null;
  thumbnailStoragePath?: string | null;
  posterStoragePath?: string | null;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  processingStatus: AttachmentProcessingStatus;
  transcription: string | null;
  billingFacts?: RuntimeBillingFacts | null;
  metadata: Record<string, unknown> | null;
  clientTurnId?: string | null;
  clientAttachmentId?: string | null;
};

export interface AssistantChatMessageAttachmentRepository {
  create(input: CreateAttachmentInput): Promise<AssistantChatMessageAttachment>;
  findById(id: string): Promise<AssistantChatMessageAttachment | null>;
  findStagedByClientAttachment(input: {
    assistantId: string;
    chatId: string;
    clientAttachmentId: string;
  }): Promise<AssistantChatMessageAttachment | null>;
  listByMessageId(messageId: string): Promise<AssistantChatMessageAttachment[]>;
  listByMessageIds(messageIds: string[]): Promise<AssistantChatMessageAttachment[]>;
  listByChatId(chatId: string): Promise<AssistantChatMessageAttachment[]>;
  findByChatIdAndStoragePath(input: {
    chatId: string;
    storagePath: string;
  }): Promise<AssistantChatMessageAttachment | null>;
  sumSizeBytesByAssistantId(assistantId: string): Promise<bigint>;
  deleteByAssistantId(assistantId: string): Promise<number>;
  deleteByChatId(chatId: string): Promise<number>;
  sumSizeBytesByWorkspaceId(workspaceId: string): Promise<bigint>;
}
