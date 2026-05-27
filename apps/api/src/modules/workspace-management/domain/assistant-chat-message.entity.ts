export type AssistantChatMessageAuthor = "user" | "assistant" | "system";

export type AssistantChatMessage = {
  id: string;
  chatId: string;
  assistantId: string;
  author: AssistantChatMessageAuthor;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};
