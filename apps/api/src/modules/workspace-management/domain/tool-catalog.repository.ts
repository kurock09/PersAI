import type {
  ToolCatalogActivationView,
  ToolCatalogPromptMetadataView
} from "./tool-catalog.entity";

export const TOOL_CATALOG_REPOSITORY = Symbol("TOOL_CATALOG_REPOSITORY");

export interface ToolCatalogRepository {
  listToolsForPlanActivationView(planCode: string | null): Promise<ToolCatalogActivationView[]>;
  listToolsForPromptMetadata(): Promise<ToolCatalogPromptMetadataView[]>;
  updateToolPromptMetadata(
    toolCode: string,
    patch: {
      modelDescription?: string | null;
      modelUsageGuidance?: string | null;
    }
  ): Promise<ToolCatalogPromptMetadataView>;
}
