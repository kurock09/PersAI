export const BILLING_LIFECYCLE_SETTINGS_ID = "global";
export const BILLING_LIFECYCLE_SETTINGS_SCHEMA = "persai.billingLifecycleSettings.v2";

export type BillingLifecycleSettingsState = {
  schema: typeof BILLING_LIFECYCLE_SETTINGS_SCHEMA;
  gracePeriodDays: number;
  globalFallbackPlanCode: string | null;
  updatedAt: string;
};

export type BillingLifecycleSettingsInput = {
  gracePeriodDays: number;
  globalFallbackPlanCode: string | null;
};
