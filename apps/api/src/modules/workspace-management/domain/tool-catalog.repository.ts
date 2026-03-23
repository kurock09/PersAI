import type { ToolCatalogActivationView } from "./tool-catalog.entity";

export const TOOL_CATALOG_REPOSITORY = Symbol("TOOL_CATALOG_REPOSITORY");

export interface ToolCatalogRepository {
  listToolsForPlanActivationView(planCode: string | null): Promise<ToolCatalogActivationView[]>;
}
