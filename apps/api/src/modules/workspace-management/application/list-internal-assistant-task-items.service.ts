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
  audience: "user" | "assistant";
  actionType: string | null;
  sourceLabel: string | null;
  scheduleKind: "one_time" | "recurring" | "unknown";
  controlStatus: "active" | "disabled";
  nextRunAt: string | null;
  externalRef: string | null;
};

function resolveScheduleKind(sourceLabel: string | null): "one_time" | "recurring" | "unknown" {
  const normalized = sourceLabel?.toLowerCase() ?? "";
  if (normalized.includes("one-time")) {
    return "one_time";
  }
  if (normalized.includes("recurring")) {
    return "recurring";
  }
  return "unknown";
}

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
      audience: item.audience,
      actionType: item.actionType,
      sourceLabel: item.sourceLabel,
      scheduleKind: resolveScheduleKind(item.sourceLabel),
      controlStatus: item.controlStatus,
      nextRunAt: item.nextRunAt?.toISOString() ?? null,
      externalRef: item.externalRef
    }));
  }
}
