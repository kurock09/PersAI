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
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  codeDefaultModelDescription?: string | null;
  codeDefaultModelUsageGuidance?: string | null;
  modelDescriptionOverridden?: boolean;
  modelUsageGuidanceOverridden?: boolean;
  toolClass: ToolCatalogToolClass;
  capabilityGroup: ToolCatalogCapabilityGroup;
  policyClass: ToolPolicyClass;
  catalogStatus: "active" | "inactive";
  planActivationStatus: ToolActivationStatus;
};

export type ToolCatalogPromptMetadataView = {
  toolCode: string;
  displayName: string;
  description: string | null;
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  codeDefaultModelDescription?: string | null;
  codeDefaultModelUsageGuidance?: string | null;
  modelDescriptionOverridden?: boolean;
  modelUsageGuidanceOverridden?: boolean;
  toolClass: ToolCatalogToolClass;
  capabilityGroup: ToolCatalogCapabilityGroup;
  policyClass: ToolPolicyClass;
  catalogStatus: "active" | "inactive";
};
