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
import { ControlInternalAssistantReminderTaskService } from "./control-internal-assistant-reminder-task.service";

@Injectable()
export class CancelAssistantTaskRegistryItemService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly taskRegistryRepository: AssistantTaskRegistryRepository,
    private readonly controlInternalAssistantReminderTaskService: ControlInternalAssistantReminderTaskService
  ) {}

  async execute(userId: string, itemId: string): Promise<{ cancelled: true }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const envelope = resolveEffectiveTasksControlFromGovernance(governance);
    const flags = getTasksUserControlFlags(envelope);
    if (!flags.userMayCancel) {
      throw new ConflictException("Cancelling tasks is not allowed by assistant policy.");
    }

    const item = await this.taskRegistryRepository.findByIdAndAssistantId(itemId, assistant.id);
    if (item === null) {
      throw new NotFoundException("Task was not found for this assistant.");
    }
    if (item.controlStatus === "cancelled") {
      return { cancelled: true };
    }

    await this.controlInternalAssistantReminderTaskService.execute({
      assistantId: assistant.id,
      action: "cancel",
      taskId: itemId
    });

    return { cancelled: true };
  }
}
