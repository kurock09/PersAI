import type { AssistantPlanCatalog } from "./assistant-plan-catalog.entity";

export const ASSISTANT_PLAN_CATALOG_REPOSITORY = Symbol("ASSISTANT_PLAN_CATALOG_REPOSITORY");

export type AssistantPlanCatalogToolActivationOverride = {
  toolCode: string;
  active: boolean;
  dailyCallLimit: number | null;
  /**
   * ADR-074 Slice L1 — see `AssistantPlanCatalogToolActivation.perTurnCap`.
   * NULL = no per-plan override (use runtime code default).
   */
  perTurnCap: number | null;
};

export type AssistantPlanCatalogDeleteImpact = {
  isDefaultRegistrationPlan: boolean;
  workspaceSubscriptionCount: number;
  assistantOverrideCount: number;
  assistantFallbackCount: number;
};

export type AssistantPlanCatalogWriteInput = {
  displayName: string;
  description: string | null;
  status: "active" | "inactive";
  isDefaultFirstRegistrationPlan: boolean;
  isTrialPlan: boolean;
  trialDurationDays: number | null;
  billingProviderHints: Record<string, unknown> | null;
  entitlementModel: {
    schemaVersion: number;
    capabilities: unknown[];
    toolClasses: unknown[];
    channelsAndSurfaces: unknown[];
    mediaClasses: unknown[];
    limitsPermissions: unknown[];
  };
  toolActivationOverrides?: AssistantPlanCatalogToolActivationOverride[];
};

export interface AssistantPlanCatalogRepository {
  listAll(): Promise<AssistantPlanCatalog[]>;
  findByCode(code: string): Promise<AssistantPlanCatalog | null>;
  findDefaultRegistrationPlan(): Promise<AssistantPlanCatalog | null>;
  getDeleteImpactByCode(code: string): Promise<AssistantPlanCatalogDeleteImpact | null>;
  create(code: string, input: AssistantPlanCatalogWriteInput): Promise<AssistantPlanCatalog>;
  updateByCode(
    code: string,
    input: AssistantPlanCatalogWriteInput
  ): Promise<AssistantPlanCatalog | null>;
  deleteByCode(code: string): Promise<boolean>;
  backfillToolActivationsForPlans(planIds: string[]): Promise<void>;
}
