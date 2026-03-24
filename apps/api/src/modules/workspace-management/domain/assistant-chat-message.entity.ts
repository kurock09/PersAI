export type AssistantChatMessageAuthor = "user" | "assistant" | "system";

export type AssistantChatMessage = {
  id: string;
  chatId: string;
  assistantId: string;
  author: AssistantChatMessageAuthor;
  content: string;
  createdAt: Date;
};
