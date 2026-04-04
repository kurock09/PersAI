export type ToolCatalogToolClass = "cost_driving" | "utility";

export type ToolCatalogCapabilityGroup =
  | "knowledge"
  | "automation"
  | "communication"
  | "workspace_ops";

export type ToolActivationStatus = "active" | "inactive";
export type ToolPolicyClass = "plan_managed" | "platform_managed" | "hidden_internal";

export type ToolCatalogActivationView = {
  toolCode: string;
  displayName: string;
  description: string | null;
  toolClass: ToolCatalogToolClass;
  capabilityGroup: ToolCatalogCapabilityGroup;
  policyClass: ToolPolicyClass;
  catalogStatus: "active" | "inactive";
  planActivationStatus: ToolActivationStatus;
};
