export type AssistantMemoryRegistrySourceType = "web_chat" | "memory_write";

export type AssistantMemoryRegistryItem = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: AssistantMemoryRegistrySourceType;
  sourceLabel: string | null;
  forgottenAt: Date | null;
  createdAt: Date;
};
