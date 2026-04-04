export type EffectiveToolAvailabilityState = {
  schema: "persai.effectiveToolAvailability.v2";
  derivedFrom: {
    effectiveCapabilitiesSchema: string | null;
    planCode: string | null;
  };
  toolClasses: {
    utility: {
      allowed: boolean;
      quotaGoverned: boolean;
      activation: "active" | "inactive";
    };
    costDriving: {
      allowed: boolean;
      quotaGoverned: boolean;
      activation: "active" | "inactive";
    };
  };
  tools: Array<{
    code: string;
    displayName: string;
    description: string | null;
    capabilityGroup: "knowledge" | "automation" | "communication" | "workspace_ops";
    toolClass: "cost_driving" | "utility";
    policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
    catalogStatus: "active" | "inactive";
    planActivationStatus: "active" | "inactive";
    effectiveActivation: "active" | "inactive";
    visibleInPlanEditor: boolean;
  }>;
  notes: string[];
};
