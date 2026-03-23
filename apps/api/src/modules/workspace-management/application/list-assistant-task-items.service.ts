import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_TASK_REGISTRY_REPOSITORY,
  type AssistantTaskRegistryRepository
} from "../domain/assistant-task-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  type AssistantTaskRegistryItemState,
  sortTaskRegistryItemsForDisplay,
  TASK_LIST_LIMIT
} from "./assistant-task.types";

@Injectable()
export class ListAssistantTaskItemsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly taskRegistryRepository: AssistantTaskRegistryRepository
  ) {}

  async execute(userId: string): Promise<AssistantTaskRegistryItemState[]> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const raw = await this.taskRegistryRepository.listByAssistantId(assistant.id, TASK_LIST_LIMIT);
    const sorted = sortTaskRegistryItemsForDisplay(raw);

    return sorted.map((item) => ({
      id: item.id,
      title: item.title,
      sourceSurface: item.sourceSurface,
      sourceLabel: item.sourceLabel,
      controlStatus: item.controlStatus,
      nextRunAt: item.nextRunAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }));
  }
}
