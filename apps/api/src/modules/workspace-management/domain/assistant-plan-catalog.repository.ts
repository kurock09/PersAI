import type { AssistantPlanCatalog } from "./assistant-plan-catalog.entity";

export const ASSISTANT_PLAN_CATALOG_REPOSITORY = Symbol("ASSISTANT_PLAN_CATALOG_REPOSITORY");

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
    limitsPermissions: unknown[];
  };
};

export interface AssistantPlanCatalogRepository {
  listAll(): Promise<AssistantPlanCatalog[]>;
  findByCode(code: string): Promise<AssistantPlanCatalog | null>;
  findDefaultRegistrationPlan(): Promise<AssistantPlanCatalog | null>;
  create(code: string, input: AssistantPlanCatalogWriteInput): Promise<AssistantPlanCatalog>;
  updateByCode(
    code: string,
    input: AssistantPlanCatalogWriteInput
  ): Promise<AssistantPlanCatalog | null>;
}
