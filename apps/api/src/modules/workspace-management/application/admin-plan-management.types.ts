export type AdminPlanStatus = "active" | "inactive";

export type AdminPlanEntitlementControls = {
  capabilities: {
    assistantLifecycle: boolean;
    memoryCenter: boolean;
    tasksCenter: boolean;
  };
  toolClasses: {
    costDrivingTools: boolean;
    utilityTools: boolean;
    costDrivingQuotaGoverned: boolean;
    utilityQuotaGoverned: boolean;
  };
  channelsAndSurfaces: {
    webChat: boolean;
    telegram: boolean;
    whatsapp: boolean;
    max: boolean;
  };
  limitsPermissions: {
    viewLimitPercentages: boolean;
    tasksExcludedFromCommercialQuotas: boolean;
  };
};

export type AdminPlanToolActivation = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  active: boolean;
  dailyCallLimit: number | null;
};

export type AdminPlanToolActivationInput = {
  toolCode: string;
  active: boolean;
  dailyCallLimit: number | null;
};

export type AdminPlanInput = {
  displayName: string;
  description: string | null;
  status: AdminPlanStatus;
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadata: {
    commercialTag: string | null;
    notes: string | null;
  };
  entitlements: AdminPlanEntitlementControls;
  toolActivations?: AdminPlanToolActivationInput[];
};

export type AdminCreatePlanInput = AdminPlanInput & {
  code: string;
};

export type AdminPlanState = {
  code: string;
  displayName: string;
  description: string | null;
  status: AdminPlanStatus;
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadata: {
    commercialTag: string | null;
    notes: string | null;
  };
  entitlements: AdminPlanEntitlementControls;
  toolActivations: AdminPlanToolActivation[];
  createdAt: string;
  updatedAt: string;
};
