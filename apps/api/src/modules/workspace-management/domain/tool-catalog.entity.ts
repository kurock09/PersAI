export type ToolCatalogToolClass = "cost_driving" | "utility";

export type ToolCatalogCapabilityGroup =
  | "knowledge"
  | "automation"
  | "communication"
  | "workspace_ops";

export type ToolActivationStatus = "active" | "inactive";

export type ToolCatalogActivationView = {
  toolCode: string;
  displayName: string;
  description: string | null;
  toolClass: ToolCatalogToolClass;
  capabilityGroup: ToolCatalogCapabilityGroup;
  catalogStatus: "active" | "inactive";
  planActivationStatus: ToolActivationStatus;
};
