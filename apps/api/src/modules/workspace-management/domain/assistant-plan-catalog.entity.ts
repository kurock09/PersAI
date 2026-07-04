export type AssistantPlanCatalogToolActivation = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  activationStatus: "active" | "inactive";
  dailyCallLimit: number | null;
  /**
   * ADR-074 Slice L1 — per-plan override of the per-turn hard cap on this
   * tool's executions inside a single runtime turn. NULL means "fall back
   * to the runtime code default" (TOOL_HARD_CAP_PER_TURN in
   * apps/runtime/src/modules/turns/tool-budget-policy.ts).
   */
  perTurnCap: number | null;
  /** ADR-116 — max bytes for one visual file preview on the `files` tool. */
  maxFilePreviewBytes: number | null;
  /** ADR-116 — max image edge (px) for preview resize on the `files` tool. */
  maxFilePreviewEdgePx: number | null;
  /** ADR-135 — ☑ full JSON on wire; materialized as RuntimeToolPolicy.modelExposure. */
  fullProjection: boolean;
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
