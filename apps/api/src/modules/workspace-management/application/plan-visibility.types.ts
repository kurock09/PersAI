import type { AssistantQuotaBucketSnapshot } from "./track-workspace-quota-usage.service";

export type QuotaVisibilityBucketState = AssistantQuotaBucketSnapshot;

export type UserPlanVisibilityState = {
  effectivePlan: {
    code: string | null;
    displayName: string | null;
    status: "active" | "inactive" | null;
    source:
      | "workspace_subscription"
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
      | "unconfigured";
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    isTrialPlan: boolean;
  };
  entitlements: {
    channelsAndSurfaces: {
      webChat: boolean;
      telegram: boolean;
      whatsapp: boolean;
      max: boolean;
    };
  };
  limits: {
    quotaBuckets: QuotaVisibilityBucketState[];
    toolDailyLimits: Array<{
      toolCode: string;
      displayName: string;
      dailyCallLimit: number | null;
      dailyCallsUsed: number;
      active: boolean;
    }>;
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
