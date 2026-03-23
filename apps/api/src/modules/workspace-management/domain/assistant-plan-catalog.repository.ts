import type { AssistantPlanCatalog } from "./assistant-plan-catalog.entity";

export const ASSISTANT_PLAN_CATALOG_REPOSITORY = Symbol("ASSISTANT_PLAN_CATALOG_REPOSITORY");

export interface AssistantPlanCatalogRepository {
  findByCode(code: string): Promise<AssistantPlanCatalog | null>;
  findDefaultRegistrationPlan(): Promise<AssistantPlanCatalog | null>;
}
