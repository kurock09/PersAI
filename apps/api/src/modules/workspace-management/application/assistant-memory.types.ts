export type AssistantMemoryRegistrySourceTypeState = "web_chat" | "memory_write";

export interface AssistantMemoryRegistryItemState {
  id: string;
  summary: string;
  sourceType: AssistantMemoryRegistrySourceTypeState;
  sourceLabel: string | null;
  createdAt: string;
  chatId: string | null;
}
