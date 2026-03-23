import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_TASK_REGISTRY_REPOSITORY,
  type AssistantTaskRegistryRepository
} from "../domain/assistant-task-registry.repository";
import { getTasksUserControlFlags } from "../domain/tasks-user-controls";
import { resolveEffectiveTasksControlFromGovernance } from "../domain/tasks-control-resolve";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";

@Injectable()
export class EnableAssistantTaskRegistryItemService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly taskRegistryRepository: AssistantTaskRegistryRepository
  ) {}

  async execute(userId: string, itemId: string): Promise<{ enabled: true }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const envelope = resolveEffectiveTasksControlFromGovernance(governance);
    const flags = getTasksUserControlFlags(envelope);
    if (!flags.userMayEnable) {
      throw new ConflictException("Re-enabling tasks is not allowed by assistant policy.");
    }

    const item = await this.taskRegistryRepository.findByIdAndAssistantId(itemId, assistant.id);
    if (item === null) {
      throw new NotFoundException("Task was not found for this assistant.");
    }
    if (item.controlStatus !== "disabled") {
      throw new ConflictException("Only paused tasks can be turned back on.");
    }

    const ok = await this.taskRegistryRepository.updateControlStatus(itemId, assistant.id, {
      controlStatus: "active",
      disabledAt: null,
      cancelledAt: null
    });
    if (!ok) {
      throw new NotFoundException("Task was not found for this assistant.");
    }

    return { enabled: true };
  }
}
