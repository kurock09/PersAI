import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type {
  AdminPlanVisibilityState,
  QuotaVisibilityBucketState,
  UserPlanVisibilityState
} from "./plan-visibility.types";
import { AdminAuthorizationService } from "./admin-authorization.service";

function indexQuotaBuckets(
  buckets: QuotaVisibilityBucketState[]
): Partial<Record<QuotaVisibilityBucketState["bucketCode"], QuotaVisibilityBucketState>> {
  return Object.fromEntries(buckets.map((bucket) => [bucket.bucketCode, bucket])) as Partial<
    Record<QuotaVisibilityBucketState["bucketCode"], QuotaVisibilityBucketState>
  >;
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
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly adminAuthorizationService: AdminAuthorizationService
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
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const plan =
      subscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(subscription.planCode);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant,
      governance
    });
    const quotaSnapshot =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantQuotaSnapshot(assistant);
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
      entitlements: {
        channelsAndSurfaces: {
          webChat: effectiveCapabilities.channelsAndSurfaces.webChat,
          telegram: effectiveCapabilities.channelsAndSurfaces.telegram,
          whatsapp: effectiveCapabilities.channelsAndSurfaces.whatsapp,
          max: effectiveCapabilities.channelsAndSurfaces.max
        }
      },
      limits: {
        quotaBuckets: quotaSnapshot.buckets,
        toolDailyLimits: await this.resolveToolDailyLimitsWithUsage(
          assistant.workspaceId,
          plan?.toolActivations ?? []
        )
      },
      updatedAt: new Date().toISOString()
    };
  }

  async getAdminVisibility(userId: string): Promise<AdminPlanVisibilityState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);

    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }

    const plans = await this.assistantPlanCatalogRepository.listAll();
    const defaultRegistrationPlan =
      plans.find((plan) => plan.isDefaultFirstRegistrationPlan) ?? null;
    const activePlans = plans.filter((plan) => plan.status === "active").length;
    const inactivePlans = plans.length - activePlans;

    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
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
    const quotaSnapshot =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantQuotaSnapshot(assistant);
    const bucketsByCode = indexQuotaBuckets(quotaSnapshot.buckets);
    const tokenPercent = bucketsByCode.token_budget?.percent ?? 0;
    const chatsPercent = bucketsByCode.active_web_chats?.percent ?? 0;
    const mediaPercent = bucketsByCode.media_storage_bytes?.percent ?? 0;
    const knowledgePercent = bucketsByCode.knowledge_storage_bytes?.percent ?? 0;
    const maxPercent = Math.max(tokenPercent, chatsPercent, mediaPercent, knowledgePercent);
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
        activeWebChatsPercent: chatsPercent,
        mediaStorageBytesPercent: mediaPercent,
        knowledgeStorageBytesPercent: knowledgePercent,
        pressureLevel
      },
      quotaBuckets: quotaSnapshot.buckets,
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
        }
      },
      updatedAt: new Date().toISOString()
    };
  }

  private async resolveToolDailyLimitsWithUsage(
    workspaceId: string,
    toolActivations: Array<{
      toolCode: string;
      displayName: string;
      dailyCallLimit: number | null;
      policyClass: string;
      activationStatus: string;
    }>
  ): Promise<
    Array<{
      toolCode: string;
      displayName: string;
      dailyCallLimit: number | null;
      dailyCallsUsed: number;
      active: boolean;
    }>
  > {
    const active = toolActivations.filter(
      (t) => t.policyClass === "plan_managed" && t.activationStatus === "active"
    );
    return Promise.all(
      active.map(async (tool) => {
        const check = await this.trackWorkspaceQuotaUsageService.checkToolDailyLimit({
          workspaceId,
          toolCode: tool.toolCode,
          dailyCallLimit: tool.dailyCallLimit
        });
        return {
          toolCode: tool.toolCode,
          displayName: tool.displayName,
          dailyCallLimit: tool.dailyCallLimit,
          dailyCallsUsed: check.currentCount,
          active: true
        };
      })
    );
  }
}
