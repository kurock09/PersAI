export type AssistantPlanCatalogToolActivation = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  activationStatus: "active" | "inactive";
  dailyCallLimit: number | null;
};

export type AssistantPlanCatalog = {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  status: "active" | "inactive";
  /** Provider-agnostic metadata for future billing adapters. */
  billingProviderHints: unknown | null;
  /** Canonical grouped entitlement model for Step 7 P1. */
  entitlementModel: {
    schemaVersion: number;
    capabilities: unknown[];
    toolClasses: unknown[];
    channelsAndSurfaces: unknown[];
    limitsPermissions: unknown[];
  } | null;
  toolActivations: AssistantPlanCatalogToolActivation[];
  isDefaultFirstRegistrationPlan: boolean;
  isTrialPlan: boolean;
  trialDurationDays: number | null;
  createdAt: Date;
  updatedAt: Date;
};
