export type UserPlanVisibilityState = {
  effectivePlan: {
    code: string | null;
    displayName: string | null;
    status: "active" | "inactive" | null;
    source:
      | "workspace_subscription"
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
  limits: {
    tokenBudgetPercent: number;
    costDrivingToolsPercent: number;
    activeWebChatsPercent: number;
    tasksExcludedFromCommercialQuotas: boolean;
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
    costDrivingToolsPercent: number;
    activeWebChatsPercent: number;
    pressureLevel: "low" | "elevated" | "high";
  };
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
    governedFeatures: {
      memoryCenter: boolean;
      tasksCenter: boolean;
      viewLimitPercentages: boolean;
      tasksExcludedFromCommercialQuotas: boolean;
    };
  } | null;
  updatedAt: string;
};
