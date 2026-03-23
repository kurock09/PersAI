export type BusinessCockpitPressureLevel = "low" | "elevated" | "high";

export type BusinessCockpitChannel = "web_chat" | "telegram" | "whatsapp" | "max";

export type AdminBusinessCockpitState = {
  activeAssistants: {
    totalAssistants: number;
    activeAssistants: number;
    publishedAssistants: number;
  };
  activeChats: {
    activeWebChats: number;
    totalWebChats: number;
  };
  channelSplit: {
    channels: Array<{
      channel: BusinessCockpitChannel;
      value: number;
      percent: number;
    }>;
  };
  publishApplySuccess: {
    window: "last_7_days";
    publishedVersionEvents: number;
    applySucceeded: number;
    applyDegraded: number;
    applyFailed: number;
    applySuccessPercent: number;
  };
  quotaPressure: {
    tokenBudgetPercent: number;
    costDrivingToolsPercent: number;
    activeWebChatsPercent: number;
    pressureLevel: BusinessCockpitPressureLevel;
  };
  planUsageSnapshot: {
    effectivePlanCode: string | null;
    effectivePlanDisplayName: string | null;
    effectivePlanStatus: "active" | "inactive" | null;
    defaultRegistrationPlanCode: string | null;
    totalPlans: number;
    activePlans: number;
    inactivePlans: number;
  };
  updatedAt: string;
};
