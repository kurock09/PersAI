import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

@Injectable()
export class ManageAdminAssistantPlanOverrideService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async setOverride(
    callerUserId: string,
    targetUserId: string,
    planCode: string,
    stepUpToken: string | null,
    assistantId?: string | null
  ): Promise<{ ok: true }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const trimmedUserId = targetUserId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("userId is required.");
    }
    const trimmedPlanCode = planCode.trim();
    if (trimmedPlanCode.length === 0) {
      throw new BadRequestException("planCode is required.");
    }

    const assistant = await this.resolveTargetAssistant(trimmedUserId, assistantId);

    const plan = await this.assistantPlanCatalogRepository.findByCode(trimmedPlanCode);
    if (plan === null || plan.status !== "active") {
      throw new BadRequestException(`Plan "${trimmedPlanCode}" does not exist or is not active.`);
    }

    await this.assistantGovernanceRepository.setAssistantPlanOverride(
      assistant.id,
      trimmedPlanCode
    );
    await this.markAssistantConfigDirty(assistant.id);
    return { ok: true };
  }

  async resetOverride(
    callerUserId: string,
    targetUserId: string,
    stepUpToken: string | null,
    assistantId?: string | null
  ): Promise<{ ok: true }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const trimmedUserId = targetUserId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("userId is required.");
    }

    const assistant = await this.resolveTargetAssistant(trimmedUserId, assistantId);

    await this.assistantGovernanceRepository.setAssistantPlanOverride(assistant.id, null);
    await this.markAssistantConfigDirty(assistant.id);
    return { ok: true };
  }

  private async resolveTargetAssistant(
    userId: string,
    assistantId?: string | null
  ): Promise<{ id: string }> {
    const trimmedAssistantId = assistantId?.trim() || null;
    return (
      await this.resolveActiveAssistantService.execute({
        userId,
        assistantId: trimmedAssistantId
      })
    ).assistant;
  }

  private async markAssistantConfigDirty(assistantId: string): Promise<void> {
    await this.prisma.assistant.update({
      where: { id: assistantId },
      data: { configDirtyAt: new Date() }
    });
  }
}
