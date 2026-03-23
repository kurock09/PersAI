import type { AssistantTaskRegistryItem } from "./assistant-task-registry-item.entity";

export interface AssistantTaskRegistryRepository {
  listByAssistantId(assistantId: string, limit: number): Promise<AssistantTaskRegistryItem[]>;
  findByIdAndAssistantId(
    id: string,
    assistantId: string
  ): Promise<AssistantTaskRegistryItem | null>;
  updateControlStatus(
    id: string,
    assistantId: string,
    patch: {
      controlStatus: AssistantTaskRegistryItem["controlStatus"];
      disabledAt: Date | null;
      cancelledAt: Date | null;
    }
  ): Promise<boolean>;
}

export const ASSISTANT_TASK_REGISTRY_REPOSITORY = Symbol("ASSISTANT_TASK_REGISTRY_REPOSITORY");
