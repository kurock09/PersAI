import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../domain/assistant-plan-catalog.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveAssistantPolicy } from "./assistant-policy";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

export type AssistantCreationLimitState = {
  plan: AssistantPlanCatalog | null;
  workspaceId: string;
  workspaceMemberId: string;
  usedAssistants: number;
  maxAssistants: number;
};

@Injectable()
export class EnforceAssistantCreationLimitService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<AssistantCreationLimitState> {
    const membership = await this.resolveActiveAssistantService.resolveMembership(userId);
    const workspaceSubscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId: membership.workspaceId },
      select: { planCode: true }
    });

    if (workspaceSubscription === null) {
      const initialized =
        await this.resolveEffectiveSubscriptionStateService.initializeLifecycleNow({
          workspaceId: membership.workspaceId,
          userId,
          source: "system"
        });
      const initializedPlanCode = initialized.planCode;
      const plan = initializedPlanCode
        ? await this.assistantPlanCatalogRepository.findByCode(initializedPlanCode)
        : await this.assistantPlanCatalogRepository.findDefaultRegistrationPlan();
      return this.assertWithinLimit(membership, plan);
    }

    const plan = workspaceSubscription.planCode
      ? await this.assistantPlanCatalogRepository.findByCode(workspaceSubscription.planCode)
      : await this.assistantPlanCatalogRepository.findDefaultRegistrationPlan();
    return this.assertWithinLimit(membership, plan);
  }

  private async assertWithinLimit(
    membership: {
      workspaceId: string;
      workspaceMemberId: string;
    },
    plan: AssistantPlanCatalog | null
  ): Promise<AssistantCreationLimitState> {
    const maxAssistants = resolveAssistantPolicy({
      billingProviderHints: plan?.billingProviderHints ?? null
    }).maxAssistants;
    const usedAssistants = await this.prisma.assistant.count({
      where: { workspaceId: membership.workspaceId }
    });

    if (usedAssistants >= maxAssistants) {
      throw new ConflictException("Assistant limit reached for the current workspace plan.");
    }

    return {
      plan,
      workspaceId: membership.workspaceId,
      workspaceMemberId: membership.workspaceMemberId,
      usedAssistants,
      maxAssistants
    };
  }
}
