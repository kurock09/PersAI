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
};

export type CreateAssistantChatMessageInput = {
  chatId: string;
  assistantId: string;
  author: AssistantChatMessage["author"];
  content: string;
};

export interface AssistantChatRepository {
  createChat(input: CreateAssistantChatInput): Promise<AssistantChat>;
  findChatById(chatId: string): Promise<AssistantChat | null>;
  findChatBySurfaceThread(
    assistantId: string,
    surface: AssistantChatSurface,
    surfaceThreadKey: string
  ): Promise<AssistantChat | null>;
  listChatsByAssistantId(assistantId: string): Promise<AssistantChat[]>;
  createMessage(input: CreateAssistantChatMessageInput): Promise<AssistantChatMessage>;
  listMessagesByChatId(chatId: string): Promise<AssistantChatMessage[]>;
}

