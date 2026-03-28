import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_TASK_REGISTRY_REPOSITORY,
  type AssistantTaskRegistryRepository
} from "../domain/assistant-task-registry.repository";
import type { AssistantTaskRegistryItem } from "../domain/assistant-task-registry-item.entity";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { sortTaskRegistryItemsForDisplay, TASK_LIST_LIMIT } from "./assistant-task.types";

export type InternalAssistantTaskItemState = {
  id: string;
  title: string;
  controlStatus: "active" | "disabled";
  nextRunAt: string | null;
  externalRef: string | null;
};

@Injectable()
export class ListInternalAssistantTaskItemsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly taskRegistryRepository: AssistantTaskRegistryRepository
  ) {}

  async execute(assistantId: string): Promise<InternalAssistantTaskItemState[]> {
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    const raw = await this.taskRegistryRepository.listByAssistantId(assistant.id, TASK_LIST_LIMIT);
    const currentItems = sortTaskRegistryItemsForDisplay(raw).filter(
      (
        item
      ): item is AssistantTaskRegistryItem & {
        controlStatus: "active" | "disabled";
      } => item.controlStatus === "active" || item.controlStatus === "disabled"
    );

    return currentItems.map((item) => ({
      id: item.id,
      title: item.title,
      controlStatus: item.controlStatus,
      nextRunAt: item.nextRunAt?.toISOString() ?? null,
      externalRef: item.externalRef
    }));
  }
}
