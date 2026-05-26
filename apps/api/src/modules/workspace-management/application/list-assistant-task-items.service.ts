import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_TASK_REGISTRY_REPOSITORY,
  type AssistantTaskRegistryRepository
} from "../domain/assistant-task-registry.repository";
import {
  type AssistantTaskRegistryItemState,
  sortTaskRegistryItemsForDisplay,
  TASK_LIST_LIMIT
} from "./assistant-task.types";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

@Injectable()
export class ListAssistantTaskItemsService {
  constructor(
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly taskRegistryRepository: AssistantTaskRegistryRepository,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async execute(userId: string): Promise<AssistantTaskRegistryItemState[]> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId })).assistant;

    const raw = await this.taskRegistryRepository.listByAssistantId(assistant.id, TASK_LIST_LIMIT);
    const sorted = sortTaskRegistryItemsForDisplay(raw);

    return sorted.map((item) => ({
      id: item.id,
      title: item.title,
      sourceSurface: item.sourceSurface,
      sourceLabel: item.sourceLabel,
      audience: item.audience,
      actionType: item.actionType,
      controlStatus: item.controlStatus,
      nextRunAt: item.nextRunAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }));
  }
}
