export type AssistantMemoryRegistrySourceTypeState = "web_chat";

export interface AssistantMemoryRegistryItemState {
  id: string;
  summary: string;
  sourceType: AssistantMemoryRegistrySourceTypeState;
  sourceLabel: string | null;
  createdAt: string;
  chatId: string | null;
}
