import type {
  AssistantMonthlyToolQuotaSnapshot,
  AssistantQuotaBucketSnapshot
} from "./track-workspace-quota-usage.service";
import type { QuotaOfferState } from "./quota-offers";

export type QuotaVisibilityBucketState = AssistantQuotaBucketSnapshot;

export type PlanQuotaAdvisoryState = {
  warningThresholdPercent: number;
  isFreePlan: boolean;
  higherPaidPlanAvailable: boolean;
  highestVisiblePaidPlanCode: string | null;
  tokenBudget: {
    periodStartedAt: string | null;
    periodEndsAt: string | null;
    periodSource: "subscription_period" | "calendar_month_fallback" | null;
    paidLightModeEligible: boolean;
    paidLightModeActive: boolean;
    paidLightModeReason: "token_budget_limit_reached" | null;
  };
};

export type UserPlanVisibilityState = {
  effectivePlan: {
    code: string | null;
    displayName: string | null;
    status: "active" | "inactive" | null;
    source:
      | "workspace_subscription"
      | "subscription_trial_fallback"
      | "subscription_paid_fallback"
      | "assistant_plan_override"
      | "assistant_plan_fallback"
      | "catalog_default_fallback"
      | "none";
    subscriptionStatus:
      | "trialing"
      | "active"
      | "grace_period"
      | "past_due"
      | "paused"
      | "canceled"
      | "expired"
      | "expired_fallback"
      | "unconfigured";
    trialEndsAt: string | null;
    graceStartedAt: string | null;
    graceEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    isTrialPlan: boolean;
    trialFallbackPlanCode: string | null;
    paidFallbackPlanCode: string | null;
    price: {
      amount: number | null;
      currency: string | null;
      billingPeriod: "month" | "year" | null;
    };
  };
  entitlements: {
    channelsAndSurfaces: {
      webChat: boolean;
      telegram: boolean;
      whatsapp: boolean;
      max: boolean;
    };
  };
  advisories: PlanQuotaAdvisoryState;
  limits: {
    quotaBuckets: QuotaVisibilityBucketState[];
    monthlyToolQuotas: AssistantMonthlyToolQuotaSnapshot;
    toolDailyLimits: Array<{
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
    }>;
  };
  packageOffers: QuotaOfferState;
  /**
   * ADR-108 Slice 6a addition: the workspace's live VC wallet balance and plan's
   * monthly VC grant, exposed for the user-facing settings UI rendering.
   */
  workspaceVcoinBalance: {
    balanceVc: number;
    videoVcoinMonthlyGrant: number;
    vcoinExchangeRate: number;
  };
  updatedAt: string;
};

export type AdminPlanVisibilityState = {
  planState: {
    effectivePlanCode: string | null;
    effectivePlanDisplayName: string | null;
    effectivePlanStatus: "active" | "inactive" | null;
    defaultRegistrationPlanCode: string | null;
    totalPlans: number;
    activePlans: number;
    inactivePlans: number;
  };
  usagePressure: {
    tokenBudgetPercent: number;
    activeWebChatsPercent: number;
    mediaStorageBytesPercent: number;
    knowledgeStorageBytesPercent: number;
    pressureLevel: "low" | "elevated" | "high";
  };
  quotaBuckets: QuotaVisibilityBucketState[];
  monthlyToolQuotas: AssistantMonthlyToolQuotaSnapshot;
  effectiveEntitlements: {
    toolClasses: {
      costDrivingAllowed: boolean;
      utilityAllowed: boolean;
    };
    channelsAndSurfaces: {
      webChat: boolean;
      telegram: boolean;
      whatsapp: boolean;
      max: boolean;
    };
  } | null;
  updatedAt: string;
};
