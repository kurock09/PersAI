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
    catalogStatus: "active" | "inactive";
    planActivationStatus: "active" | "inactive";
    effectiveActivation: "active" | "inactive";
  }>;
  notes: string[];
};
