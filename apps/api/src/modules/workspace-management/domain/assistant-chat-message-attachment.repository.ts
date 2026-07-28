import type { AssistantChatMessageAttachment } from "./assistant-chat-message-attachment.entity";

export const ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY = Symbol(
  "ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY"
);

/**
 * ADR-167 — assistant chat attachment rows are created only through
 * `DeliverChatAttachmentOnceService`. This repository is read/projection/
 * delete only; there is no create bypass.
 */
export interface AssistantChatMessageAttachmentRepository {
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
  findByChatIdAndDerivativeStoragePath(input: {
    chatId: string;
    storagePath: string;
  }): Promise<AssistantChatMessageAttachment | null>;
  refreshWorkspacePathProjection(input: {
    workspaceId: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: bigint;
  }): Promise<number>;
  sumSizeBytesByAssistantId(assistantId: string): Promise<bigint>;
  deleteByAssistantId(assistantId: string): Promise<number>;
  deleteByChatId(chatId: string): Promise<number>;
  sumSizeBytesByWorkspaceId(workspaceId: string): Promise<bigint>;
}
