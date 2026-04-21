export type AssistantMemoryRegistrySourceTypeState = "web_chat" | "memory_write";
export type AssistantMemoryRegistryClassState = "core" | "contextual";
export type AssistantMemoryRegistryKindState = "fact" | "preference" | "open_loop";

export interface AssistantMemoryRegistryItemState {
  id: string;
  summary: string;
  sourceType: AssistantMemoryRegistrySourceTypeState;
  sourceLabel: string | null;
  memoryClass: AssistantMemoryRegistryClassState;
  kind: AssistantMemoryRegistryKindState | null;
  createdAt: string;
  chatId: string | null;
}
