export type AdminPlanStatus = "active" | "inactive";
export type AdminPlanRuntimeTier =
  | "free_shared_restricted"
  | "paid_shared_restricted"
  | "paid_isolated";

export type AdminPlanEntitlementControls = {
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
  mediaClasses: {
    image: boolean;
    audio: boolean;
    video: boolean;
    file: boolean;
  };
};

export type AdminPlanToolActivation = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  active: boolean;
  dailyCallLimit: number | null;
  visibleInPlanEditor: boolean;
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
  quotaLimits: {
    tokenBudgetLimit: number | null;
    mediaStorageBytesLimit: number | null;
    workspaceStorageBytesLimit: number | null;
  };
  primaryModelKey: string | null;
  runtimeTierDefault: AdminPlanRuntimeTier | null;
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
  quotaLimits: {
    tokenBudgetLimit: number | null;
    mediaStorageBytesLimit: number | null;
    workspaceStorageBytesLimit: number | null;
  };
  primaryModelKey: string | null;
  runtimeTierDefault: AdminPlanRuntimeTier | null;
  toolActivations: AdminPlanToolActivation[];
  createdAt: string;
  updatedAt: string;
};
