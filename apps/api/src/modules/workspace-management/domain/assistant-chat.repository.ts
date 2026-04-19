import type { AssistantChatMessage } from "./assistant-chat-message.entity";
import type { AssistantChat, AssistantChatSurface } from "./assistant-chat.entity";

export const ASSISTANT_CHAT_REPOSITORY = Symbol("ASSISTANT_CHAT_REPOSITORY");

export type CreateAssistantChatInput = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AssistantChatSurface;
  surfaceThreadKey: string;
  title: string | null;
  deepModeEnabled?: boolean;
};

export type GetOrCreateWebChatUnderCapInput = CreateAssistantChatInput & {
  activeWebChatsLimit: number;
};

export type GetOrCreateWebChatUnderCapResult =
  | { outcome: "existing"; chat: AssistantChat }
  | { outcome: "created"; chat: AssistantChat }
  | { outcome: "cap_reached"; activeCount: number; limit: number };

export type CreateAssistantChatMessageInput = {
  chatId: string;
  assistantId: string;
  author: AssistantChatMessage["author"];
  content: string;
};

export type AssistantChatListMetadata = {
  messageCount: number;
  lastMessagePreview: string | null;
};

export type UpdateAssistantChatInput = {
  title?: string | null;
  deepModeEnabled?: boolean;
};

export interface AssistantChatRepository {
  createChat(input: CreateAssistantChatInput): Promise<AssistantChat>;
  findOrCreateChatBySurfaceThread(input: CreateAssistantChatInput): Promise<AssistantChat>;
  getOrCreateWebChatBySurfaceThreadUnderCap(
    input: GetOrCreateWebChatUnderCapInput
  ): Promise<GetOrCreateWebChatUnderCapResult>;
  findChatById(chatId: string): Promise<AssistantChat | null>;
  findChatBySurfaceThread(
    assistantId: string,
    surface: AssistantChatSurface,
    surfaceThreadKey: string
  ): Promise<AssistantChat | null>;
  countActiveChatsByAssistantIdAndSurface(
    assistantId: string,
    surface: AssistantChatSurface
  ): Promise<number>;
  listChatsByAssistantId(assistantId: string): Promise<AssistantChat[]>;
  getChatListMetadata(chatId: string): Promise<AssistantChatListMetadata>;
  updateChat(chatId: string, input: UpdateAssistantChatInput): Promise<AssistantChat | null>;
  archiveChat(chatId: string): Promise<AssistantChat | null>;
  hardDeleteChat(chatId: string, assistantId: string): Promise<boolean>;
  createMessage(input: CreateAssistantChatMessageInput): Promise<AssistantChatMessage>;
  updateMessageContent(
    messageId: string,
    assistantId: string,
    content: string
  ): Promise<AssistantChatMessage | null>;
  deleteMessage(messageId: string, assistantId: string): Promise<boolean>;
  listMessagesByChatId(chatId: string): Promise<AssistantChatMessage[]>;
  findMessageByIdForAssistant(
    messageId: string,
    assistantId: string
  ): Promise<AssistantChatMessage | null>;
}
