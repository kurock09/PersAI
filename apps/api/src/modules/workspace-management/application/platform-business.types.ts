export type PlanDistributionEntry = {
  planCode: string;
  planDisplayName: string | null;
  userCount: number;
  percent: number;
};

export type QuotaPressureDistribution = {
  low: number;
  elevated: number;
  high: number;
};

export type AdminBusinessPlatformState = {
  totalUsers: number;
  planDistribution: PlanDistributionEntry[];
  quotaPressureDistribution: QuotaPressureDistribution;
  channelAdoption: {
    webChat: number;
    telegram: number;
    whatsapp: number;
    max: number;
    total: number;
  };
  publishApplyHealth: {
    window: "last_7_days";
    applySucceeded: number;
    applyDegraded: number;
    applyFailed: number;
    applySuccessPercent: number;
  };
  planCatalog: {
    totalPlans: number;
    activePlans: number;
    inactivePlans: number;
    defaultRegistrationPlanCode: string | null;
  };
  updatedAt: string;
};
