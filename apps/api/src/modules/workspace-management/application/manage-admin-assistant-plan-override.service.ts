import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";

@Injectable()
export class ManageAdminAssistantPlanOverrideService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  async setOverride(
    callerUserId: string,
    targetUserId: string,
    planCode: string
  ): Promise<{ ok: true }> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const trimmedUserId = targetUserId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("userId is required.");
    }
    const trimmedPlanCode = planCode.trim();
    if (trimmedPlanCode.length === 0) {
      throw new BadRequestException("planCode is required.");
    }

    const assistant = await this.assistantRepository.findByUserId(trimmedUserId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found for target user.");
    }

    const plan = await this.assistantPlanCatalogRepository.findByCode(trimmedPlanCode);
    if (plan === null || plan.status !== "active") {
      throw new BadRequestException(`Plan "${trimmedPlanCode}" does not exist or is not active.`);
    }

    await this.assistantGovernanceRepository.setAssistantPlanOverride(
      assistant.id,
      trimmedPlanCode
    );
    return { ok: true };
  }

  async resetOverride(callerUserId: string, targetUserId: string): Promise<{ ok: true }> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const trimmedUserId = targetUserId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("userId is required.");
    }

    const assistant = await this.assistantRepository.findByUserId(trimmedUserId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found for target user.");
    }

    await this.assistantGovernanceRepository.setAssistantPlanOverride(assistant.id, null);
    return { ok: true };
  }
}
