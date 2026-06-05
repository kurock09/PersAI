import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../domain/workspace-vcoin-balance.repository";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import {
  QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
  TrackWorkspaceQuotaUsageService
} from "./track-workspace-quota-usage.service";
import type {
  AdminPlanVisibilityState,
  QuotaVisibilityBucketState,
  UserPlanVisibilityState
} from "./plan-visibility.types";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { ManageAdminPlansService } from "./manage-admin-plans.service";
import { resolveStoredPlanLifecyclePolicy } from "./plan-lifecycle-policy";
import { buildQuotaOfferState } from "./quota-offers";
import { ManageMediaPackageCatalogService } from "./manage-media-package-catalog.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { parseVideoVcoinMonthlyGrant } from "./vcoin/parse-video-vcoin-monthly-grant";

function indexQuotaBuckets(
  buckets: QuotaVisibilityBucketState[]
): Partial<Record<QuotaVisibilityBucketState["bucketCode"], QuotaVisibilityBucketState>> {
  return Object.fromEntries(buckets.map((bucket) => [bucket.bucketCode, bucket])) as Partial<
    Record<QuotaVisibilityBucketState["bucketCode"], QuotaVisibilityBucketState>
  >;
}

const MONTHLY_TOOL_QUOTA_TOOL_CODES = new Set([
  "image_generate",
  "image_edit",
  "video_generate",
  "document"
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolvePlanPresentationPrice(
  plan: {
    billingProviderHints: unknown;
  } | null
): UserPlanVisibilityState["effectivePlan"]["price"] {
  const billingProviderHints = asObject(plan?.billingProviderHints ?? null);
  const presentation = asObject(billingProviderHints?.presentation);
  const price = asObject(presentation?.price);
  return {
    amount:
      typeof price?.amount === "number" && Number.isFinite(price.amount) ? price.amount : null,
    currency:
      typeof price?.currency === "string" && price.currency.trim().length > 0
        ? price.currency
        : null,
    billingPeriod:
      price?.billingPeriod === "month" || price?.billingPeriod === "year"
        ? price.billingPeriod
        : null
  };
}

function resolvePlanPresentationAmountMinor(
  plan: { billingProviderHints: unknown } | null
): number | null {
  const price = resolvePlanPresentationPrice(plan);
  return typeof price.amount === "number" && Number.isFinite(price.amount)
    ? Math.round(price.amount * 100)
    : null;
}

function resolveHighestVisiblePaidPlan(
  input: Array<{
    code: string;
    presentation: {
      price: {
        amount: number | null;
      };
    };
  }>
): { code: string; amountMinor: number } | null {
  let highest: { code: string; amountMinor: number } | null = null;
  for (const plan of input) {
    if (
      typeof plan.presentation.price.amount !== "number" ||
      !Number.isFinite(plan.presentation.price.amount)
    ) {
      continue;
    }
    const amountMinor = Math.round(plan.presentation.price.amount * 100);
    if (amountMinor <= 0) {
      continue;
    }
    if (highest === null || amountMinor > highest.amountMinor) {
      highest = {
        code: plan.code,
        amountMinor
      };
    }
  }
  return highest;
}

function buildPlanQuotaAdvisories(input: {
  currentPlanAmountMinor: number | null;
  visiblePlans: Array<{
    code: string;
    presentation: {
      price: {
        amount: number | null;
      };
    };
  }>;
  tokenBudget: Awaited<
    ReturnType<TrackWorkspaceQuotaUsageService["resolveAssistantTokenBudgetQuotaSnapshot"]>
  >;
  tokenBucket: QuotaVisibilityBucketState | null;
}): UserPlanVisibilityState["advisories"] {
  const highestVisiblePaidPlan = resolveHighestVisiblePaidPlan(input.visiblePlans);
  const isFreePlan = input.currentPlanAmountMinor === 0;
  const higherPaidPlanAvailable =
    highestVisiblePaidPlan !== null &&
    (input.currentPlanAmountMinor === null ||
      input.currentPlanAmountMinor < highestVisiblePaidPlan.amountMinor);
  const paidLightModeEligible =
    !isFreePlan &&
    input.tokenBudget.limitCredits !== null &&
    input.tokenBudget.limitCredits > BigInt(0);
  const paidLightModeActive =
    paidLightModeEligible && input.tokenBucket?.status === "limit_reached";
  return {
    warningThresholdPercent: QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
    isFreePlan,
    higherPaidPlanAvailable,
    highestVisiblePaidPlanCode: highestVisiblePaidPlan?.code ?? null,
    tokenBudget: {
      periodStartedAt: input.tokenBudget.periodStartedAt,
      periodEndsAt: input.tokenBudget.periodEndsAt,
      periodSource: input.tokenBudget.periodSource,
      paidLightModeEligible,
      paidLightModeActive,
      paidLightModeReason: paidLightModeActive ? "token_budget_limit_reached" : null
    }
  };
}

@Injectable()
export class ResolvePlanVisibilityService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly workspaceVcoinBalanceRepository: WorkspaceVcoinBalanceRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly manageAdminPlansService: ManageAdminPlansService,
    private readonly manageMediaPackageCatalogService: ManageMediaPackageCatalogService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
  ) {}

  async getUserVisibility(userId: string): Promise<UserPlanVisibilityState> {
    const { assistant } = await this.resolveActiveAssistantService.execute({ userId });
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
    const tokenBudgetSnapshot =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantTokenBudgetQuotaSnapshot(
        assistant
      );
    const monthlyToolQuotas =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantMonthlyToolQuotaSnapshot(
        assistant
      );
    const [publicPricingPlans, publicPackages, platformSettings, walletBalance] = await Promise.all(
      [
        this.manageAdminPlansService.listPublicPricingPlans(),
        this.manageMediaPackageCatalogService.listPublic(),
        this.resolvePlatformRuntimeProviderSettingsService.execute(),
        this.workspaceVcoinBalanceRepository.getOrCreate(assistant.workspaceId)
      ]
    );
    const lifecyclePolicy = resolveStoredPlanLifecyclePolicy(plan?.billingProviderHints ?? null);
    const bucketsByCode = indexQuotaBuckets(quotaSnapshot.buckets);
    return {
      effectivePlan: {
        code: plan?.code ?? subscription.planCode,
        displayName: plan?.displayName ?? null,
        status: plan?.status ?? null,
        source: subscription.source,
        subscriptionStatus: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        graceStartedAt: subscription.graceStartedAt ?? null,
        graceEndsAt: subscription.graceEndsAt ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
        isTrialPlan: plan?.isTrialPlan ?? false,
        trialFallbackPlanCode: lifecyclePolicy.trialFallbackPlanCode,
        paidFallbackPlanCode: lifecyclePolicy.paidFallbackPlanCode,
        price: resolvePlanPresentationPrice(plan)
      },
      entitlements: {
        channelsAndSurfaces: {
          webChat: effectiveCapabilities.channelsAndSurfaces.webChat,
          telegram: effectiveCapabilities.channelsAndSurfaces.telegram,
          whatsapp: effectiveCapabilities.channelsAndSurfaces.whatsapp,
          max: effectiveCapabilities.channelsAndSurfaces.max
        },
        talkingVideoEnabled:
          asObject(plan?.billingProviderHints ?? null)?.talkingVideoEnabled === true
      },
      advisories: buildPlanQuotaAdvisories({
        currentPlanAmountMinor: resolvePlanPresentationAmountMinor(plan),
        visiblePlans: publicPricingPlans,
        tokenBudget: tokenBudgetSnapshot,
        tokenBucket: bucketsByCode.token_budget ?? null
      }),
      limits: {
        quotaBuckets: quotaSnapshot.buckets,
        monthlyToolQuotas,
        toolDailyLimits: await this.resolveToolDailyLimitsWithUsage(
          assistant.workspaceId,
          plan?.toolActivations ?? []
        )
      },
      packageOffers: buildQuotaOfferState({
        currentPlanCode: plan?.code ?? subscription.planCode,
        visiblePlans: publicPricingPlans.map((visiblePlan) => ({
          code: visiblePlan.code,
          displayName: visiblePlan.displayName,
          enabledToolCodes: visiblePlan.enabledToolCodes,
          amountMinor:
            typeof visiblePlan.presentation.price.amount === "number"
              ? Math.round(visiblePlan.presentation.price.amount * 100)
              : null,
          limits: {
            imageGenerateMonthlyUnitsLimit: visiblePlan.quotaLimits.imageGenerateMonthlyUnitsLimit,
            imageEditMonthlyUnitsLimit: visiblePlan.quotaLimits.imageEditMonthlyUnitsLimit,
            documentMonthlyUnitsLimit: visiblePlan.quotaLimits.documentMonthlyUnitsLimit
          },
          videoVcoinMonthlyGrant: visiblePlan.videoVcoinMonthlyGrant
        })),
        currentActiveToolCodes: new Set(
          (plan?.toolActivations ?? [])
            .filter((tool) => tool.activationStatus === "active")
            .map((tool) => tool.toolCode)
        ),
        publicPackages
      }),
      workspaceVcoinBalance: {
        balanceVc: walletBalance.balanceVc,
        videoVcoinMonthlyGrant: parseVideoVcoinMonthlyGrant(
          (plan?.billingProviderHints as Record<string, unknown> | null)?.videoVcoinMonthlyGrant
        ),
        vcoinExchangeRate: platformSettings.vcoinExchangeRate
      },
      updatedAt: new Date().toISOString()
    };
  }

  async getAdminVisibility(userId: string): Promise<AdminPlanVisibilityState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);

    const { assistant } = await this.resolveActiveAssistantService.execute({ userId });
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
    const monthlyToolQuotas =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantMonthlyToolQuotaSnapshot(
        assistant
      );
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
      monthlyToolQuotas,
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
      percent: number | null;
      finiteLimit: boolean;
      warningThresholdPercent: number | null;
      warningThresholdReached: boolean;
      periodStartedAt: string | null;
      periodEndsAt: string | null;
      periodSource: "utc_day" | null;
      active: boolean;
    }>
  > {
    const visiblePlanManagedTools = toolActivations.filter((t) => t.policyClass === "plan_managed");
    return Promise.all(
      visiblePlanManagedTools.map(async (tool) => {
        const isActive = tool.activationStatus === "active";
        const shouldResolveDailyUsage =
          isActive && !MONTHLY_TOOL_QUOTA_TOOL_CODES.has(tool.toolCode);
        const check = shouldResolveDailyUsage
          ? await this.trackWorkspaceQuotaUsageService.checkToolDailyLimit({
              workspaceId,
              toolCode: tool.toolCode,
              dailyCallLimit: tool.dailyCallLimit
            })
          : {
              currentCount: 0,
              periodStartedAt: null,
              periodEndsAt: null,
              periodSource: null
            };
        const finiteLimit =
          typeof tool.dailyCallLimit === "number" && Number.isInteger(tool.dailyCallLimit)
            ? tool.dailyCallLimit > 0
            : false;
        const percent =
          finiteLimit && tool.dailyCallLimit !== null
            ? Math.max(
                0,
                Math.min(100, Math.round((check.currentCount / tool.dailyCallLimit) * 100))
              )
            : null;
        return {
          toolCode: tool.toolCode,
          displayName: tool.displayName,
          dailyCallLimit: tool.dailyCallLimit,
          dailyCallsUsed: check.currentCount,
          percent,
          finiteLimit,
          warningThresholdPercent: finiteLimit ? QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT : null,
          warningThresholdReached:
            finiteLimit && percent !== null && percent >= QUOTA_ADVISORY_WARNING_THRESHOLD_PERCENT,
          periodStartedAt: check.periodStartedAt,
          periodEndsAt: check.periodEndsAt,
          periodSource: check.periodSource,
          active: isActive
        };
      })
    );
  }
}
