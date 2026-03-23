import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type WorkspaceQuotaAccountingRepository
} from "../domain/workspace-quota-accounting.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import type { AdminPlanVisibilityState, UserPlanVisibilityState } from "./plan-visibility.types";

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readLimitFromEntitlements(limitsPermissions: unknown[] | undefined, key: string): number | null {
  if (!Array.isArray(limitsPermissions)) {
    return null;
  }
  for (const item of limitsPermissions) {
    const row = asObject(item);
    if (row?.key === key) {
      return asPositiveInt(row.limit);
    }
  }
  return null;
}

function toPercent(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  const raw = Math.round((used / limit) * 100);
  return Math.max(0, Math.min(100, raw));
}

@Injectable()
export class ResolvePlanVisibilityService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async getUserVisibility(userId: string): Promise<UserPlanVisibilityState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }

    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const plan =
      subscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(subscription.planCode);
    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      assistant.workspaceId
    );
    const limits = this.resolveLimits(plan);
    const tokenLimit = Number(quotaState?.tokenBudgetLimit ?? BigInt(limits.tokenBudgetLimit));
    const tokenUsed = Number(quotaState?.tokenBudgetUsed ?? BigInt(0));
    const costLimit =
      quotaState?.costOrTokenDrivingToolClassUnitsLimit ?? limits.costOrTokenDrivingToolClassUnitsLimit;
    const costUsed = quotaState?.costOrTokenDrivingToolClassUnitsUsed ?? 0;
    const chatsLimit = quotaState?.activeWebChatsLimit ?? limits.activeWebChatsLimit;
    const chatsUsed = quotaState?.activeWebChatsCurrent ?? 0;
    const tasksExcludedFromCommercialQuotas = this.readTasksExclusionFlag(
      plan?.entitlementModel?.limitsPermissions
    );

    return {
      effectivePlan: {
        code: plan?.code ?? subscription.planCode,
        displayName: plan?.displayName ?? null,
        status: plan?.status ?? null,
        source: subscription.source,
        subscriptionStatus: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
        isTrialPlan: plan?.isTrialPlan ?? false
      },
      limits: {
        tokenBudgetPercent: toPercent(tokenUsed, tokenLimit),
        costDrivingToolsPercent: toPercent(costUsed, costLimit),
        activeWebChatsPercent: toPercent(chatsUsed, chatsLimit),
        tasksExcludedFromCommercialQuotas
      },
      updatedAt: new Date().toISOString()
    };
  }

  async getAdminVisibility(userId: string): Promise<AdminPlanVisibilityState> {
    const ownerMembership = await this.prisma.workspaceMember.findFirst({
      where: { userId, role: WorkspaceRole.owner }
    });
    if (ownerMembership === null) {
      throw new ForbiddenException("Admin plan visibility requires workspace owner role.");
    }

    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }

    const plans = await this.assistantPlanCatalogRepository.listAll();
    const defaultRegistrationPlan = plans.find((plan) => plan.isDefaultFirstRegistrationPlan) ?? null;
    const activePlans = plans.filter((plan) => plan.status === "active").length;
    const inactivePlans = plans.length - activePlans;

    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const effectivePlan =
      subscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(subscription.planCode);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant,
      governance
    });
    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      assistant.workspaceId
    );
    const limits = this.resolveLimits(effectivePlan);

    const tokenLimit = Number(quotaState?.tokenBudgetLimit ?? BigInt(limits.tokenBudgetLimit));
    const tokenUsed = Number(quotaState?.tokenBudgetUsed ?? BigInt(0));
    const costLimit =
      quotaState?.costOrTokenDrivingToolClassUnitsLimit ?? limits.costOrTokenDrivingToolClassUnitsLimit;
    const costUsed = quotaState?.costOrTokenDrivingToolClassUnitsUsed ?? 0;
    const chatsLimit = quotaState?.activeWebChatsLimit ?? limits.activeWebChatsLimit;
    const chatsUsed = quotaState?.activeWebChatsCurrent ?? 0;

    const tokenPercent = toPercent(tokenUsed, tokenLimit);
    const costPercent = toPercent(costUsed, costLimit);
    const chatsPercent = toPercent(chatsUsed, chatsLimit);
    const maxPercent = Math.max(tokenPercent, costPercent, chatsPercent);
    const pressureLevel: "low" | "elevated" | "high" =
      maxPercent >= 90 ? "high" : maxPercent >= 65 ? "elevated" : "low";

    return {
      planState: {
        effectivePlanCode: effectivePlan?.code ?? subscription.planCode,
        effectivePlanDisplayName: effectivePlan?.displayName ?? null,
        effectivePlanStatus: effectivePlan?.status ?? null,
        defaultRegistrationPlanCode: defaultRegistrationPlan?.code ?? null,
        totalPlans: plans.length,
        activePlans,
        inactivePlans
      },
      usagePressure: {
        tokenBudgetPercent: tokenPercent,
        costDrivingToolsPercent: costPercent,
        activeWebChatsPercent: chatsPercent,
        pressureLevel
      },
      effectiveEntitlements: {
        toolClasses: {
          costDrivingAllowed: effectiveCapabilities.toolClasses.costDriving.allowed,
          utilityAllowed: effectiveCapabilities.toolClasses.utility.allowed
        },
        channelsAndSurfaces: {
          webChat: effectiveCapabilities.channelsAndSurfaces.webChat,
          telegram: effectiveCapabilities.channelsAndSurfaces.telegram,
          whatsapp: effectiveCapabilities.channelsAndSurfaces.whatsapp,
          max: effectiveCapabilities.channelsAndSurfaces.max
        },
        governedFeatures: {
          memoryCenter: effectiveCapabilities.governedFeatures.memoryCenter,
          tasksCenter: effectiveCapabilities.governedFeatures.tasksCenter,
          viewLimitPercentages: effectiveCapabilities.governedFeatures.viewLimitPercentages,
          tasksExcludedFromCommercialQuotas:
            effectiveCapabilities.governedFeatures.tasksExcludedFromCommercialQuotas
        }
      },
      updatedAt: new Date().toISOString()
    };
  }

  private resolveLimits(plan: Awaited<ReturnType<AssistantPlanCatalogRepository["findByCode"]>>): {
    tokenBudgetLimit: number;
    costOrTokenDrivingToolClassUnitsLimit: number;
    activeWebChatsLimit: number;
  } {
    const config = loadApiConfig(process.env);
    const hints = asObject(plan?.billingProviderHints ?? null);
    const quotaHints = asObject(hints?.quotaAccounting ?? null);
    const tokenBudgetLimit =
      asPositiveInt(quotaHints?.tokenBudgetLimit) ??
      readLimitFromEntitlements(plan?.entitlementModel?.limitsPermissions, "token_budget_limit") ??
      config.QUOTA_TOKEN_BUDGET_DEFAULT;
    const costOrTokenDrivingToolClassUnitsLimit =
      asPositiveInt(quotaHints?.costOrTokenDrivingToolClassUnitsLimit) ??
      readLimitFromEntitlements(
        plan?.entitlementModel?.limitsPermissions,
        "cost_or_token_driving_tool_class_units_limit"
      ) ??
      config.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT;

    return {
      tokenBudgetLimit,
      costOrTokenDrivingToolClassUnitsLimit,
      activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP
    };
  }

  private readTasksExclusionFlag(limitsPermissions: unknown[] | undefined): boolean {
    if (!Array.isArray(limitsPermissions)) {
      return false;
    }
    for (const item of limitsPermissions) {
      const row = asObject(item);
      if (row?.key === "tasks_excluded_from_commercial_quotas" && row.value === true) {
        return true;
      }
    }
    return false;
  }
}
