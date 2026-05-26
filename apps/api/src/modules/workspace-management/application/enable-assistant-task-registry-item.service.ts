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
import { ControlInternalScheduledActionService } from "./control-internal-scheduled-action.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

@Injectable()
export class EnableAssistantTaskRegistryItemService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_TASK_REGISTRY_REPOSITORY)
    private readonly taskRegistryRepository: AssistantTaskRegistryRepository,
    private readonly controlInternalScheduledActionService: ControlInternalScheduledActionService
  ) {}

  async execute(userId: string, itemId: string): Promise<{ enabled: true }> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId })).assistant;

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

    await this.controlInternalScheduledActionService.execute({
      assistantId: assistant.id,
      action: "resume",
      taskId: itemId
    });

    return { enabled: true };
  }
}
