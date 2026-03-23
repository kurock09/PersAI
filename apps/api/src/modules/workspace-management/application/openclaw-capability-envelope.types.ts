export type OpenClawCapabilityEnvelopeState = {
  schema: "persai.openclawCapabilityEnvelope.v1";
  derivedFrom: {
    effectiveCapabilitiesSchema: string | null;
    effectiveToolAvailabilitySchema: string | null;
    planCode: string | null;
  };
  channelsAndSurfaces: {
    webChat: { allowed: boolean };
    telegram: { allowed: boolean };
    whatsapp: { allowed: boolean };
    max: { allowed: boolean };
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
  toolGroups: Array<{
    group: "knowledge" | "automation" | "communication" | "workspace_ops";
    allowedToolCodes: string[];
    deniedToolCodes: string[];
    anyAllowed: boolean;
  }>;
  catalog: {
    declaredToolCodes: string[];
  };
  tools: Array<{
    code: string;
    displayName: string;
    capabilityGroup: "knowledge" | "automation" | "communication" | "workspace_ops";
    toolClass: "cost_driving" | "utility";
    allowed: boolean;
    denyReason:
      | null
      | "catalog_inactive"
      | "plan_activation_inactive"
      | "class_not_allowed";
  }>;
  quotaRestrictions: {
    costDriving: {
      classAllowed: boolean;
      quotaGoverned: boolean;
      restrictedByQuota: boolean;
    };
    utility: {
      classAllowed: boolean;
      quotaGoverned: boolean;
      restrictedByQuota: boolean;
    };
    tasksAndRemindersExcludedFromCommercialQuotas: boolean;
  };
  suppression: {
    suppressUnavailableTools: true;
    deniedToolCodes: string[];
  };
  notes: string[];
};
