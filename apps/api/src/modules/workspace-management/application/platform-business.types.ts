import type { AdminModelCostLedgerWindowState } from "./model-cost-ledger-read-model";
import type { AdminPlatformPaymentRevenueAllTime } from "./admin-ops-period-economics";

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

export type RuntimeTurnAverages = {
  window: "last_7_days";
  completedTurns: number;
  turnsWithUsageAccounting: number;
  cachedInputHitTurns: number;
  avgInputTokens: number;
  avgCachedInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgUsageStepsPerTurn: number;
  cachedInputSharePercent: number;
  cachedInputHitTurnPercent: number;
};

export type AdminBusinessPlatformState = {
  totalUsers: number;
  totalAssistants: number;
  activeAssistants: number;
  totalConversations: number;
  totalMessages: number;
  activeWebChats: number;
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
  ledgerBackedModelCost: AdminModelCostLedgerWindowState;
  platformPaymentRevenueAllTime: AdminPlatformPaymentRevenueAllTime;
  runtimeTurnAverages: RuntimeTurnAverages;
  updatedAt: string;
};
