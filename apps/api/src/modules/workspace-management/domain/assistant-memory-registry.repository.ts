import type { AssistantMemoryRegistryItem } from "./assistant-memory-registry-item.entity";

export const ASSISTANT_MEMORY_REGISTRY_REPOSITORY = Symbol("ASSISTANT_MEMORY_REGISTRY_REPOSITORY");

export type CreateAssistantMemoryRegistryItemInput = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: AssistantMemoryRegistryItem["sourceType"];
  sourceLabel: string | null;
};

export interface AssistantMemoryRegistryRepository {
  create(input: CreateAssistantMemoryRegistryItemInput): Promise<AssistantMemoryRegistryItem>;
  listActiveByAssistantId(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]>;
  findActiveByIdAndAssistantId(
    id: string,
    assistantId: string
  ): Promise<AssistantMemoryRegistryItem | null>;
  markForgottenById(id: string, assistantId: string): Promise<boolean>;
  markForgottenForMessages(
    assistantId: string,
    filters: { assistantMessageId: string; userMessageId: string | null }
  ): Promise<number>;
}
