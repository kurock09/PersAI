import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { getTasksUserControlFlags } from "../domain/tasks-user-controls";
import { resolveEffectiveTasksControlFromGovernance } from "../domain/tasks-control-resolve";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ControlInternalBackgroundTaskService } from "./control-internal-background-task.service";

@Injectable()
export class ControlAssistantBackgroundTaskService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly controlInternalBackgroundTaskService: ControlInternalBackgroundTaskService
  ) {}

  async execute(
    userId: string,
    itemId: string,
    action: "pause" | "resume" | "cancel"
  ): Promise<{ ok: true }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const flags = getTasksUserControlFlags(resolveEffectiveTasksControlFromGovernance(governance));
    if (action === "pause" && !flags.userMayDisable) {
      throw new ConflictException("Disabling tasks is not allowed by assistant policy.");
    }
    if (action === "resume" && !flags.userMayEnable) {
      throw new ConflictException("Re-enabling tasks is not allowed by assistant policy.");
    }
    if (action === "cancel" && !flags.userMayCancel) {
      throw new ConflictException("Cancelling tasks is not allowed by assistant policy.");
    }

    const task = await this.prisma.assistantBackgroundTask.findFirst({
      where: { id: itemId, assistantId: assistant.id },
      select: { id: true, status: true }
    });
    if (task === null) {
      throw new NotFoundException("Background task was not found for this assistant.");
    }
    if (action === "pause" && task.status !== "active") {
      throw new ConflictException("Only active background tasks can be paused.");
    }
    if (action === "resume" && task.status !== "disabled") {
      throw new ConflictException("Only paused background tasks can be resumed.");
    }
    if (action === "cancel" && task.status === "cancelled") {
      return { ok: true };
    }

    await this.controlInternalBackgroundTaskService.execute({
      assistantId: assistant.id,
      action,
      taskId: itemId
    });
    return { ok: true };
  }
}
