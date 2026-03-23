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
  createdAt: string;
  updatedAt: string;
};
