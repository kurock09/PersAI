export type RuntimeProviderRoutingState = {
  schema: "persai.runtimeProviderRouting.v1";
  derivedFrom: {
    effectiveCapabilitiesSchema: string | null;
    policyEnvelopeSchema: string | null;
    planCode: string | null;
  };
  userFacingProviderPickerEnabled: false;
  modelSlots: {
    normalReply: {
      providerKey: string;
      modelKey: string | null;
    };
    premiumReply: {
      providerKey: string;
      modelKey: string | null;
    };
    reasoning: {
      providerKey: string;
      modelKey: string | null;
    };
    systemTool: {
      providerKey: string;
      modelKey: string | null;
    };
    retrieval: {
      providerKey: string;
      modelKey: string | null;
    };
  };
  primaryPath: {
    providerKey: string;
    modelKey: string | null;
    active: boolean;
    inactiveReason: null | "no_interactive_surface_allowed";
  };
  fallbackMatrix: Array<{
    trigger: "provider_failure_or_timeout" | "runtime_degraded" | "cost_driving_restricted";
    strategy: "fallback_model" | "degrade_to_safe_mode";
    target: {
      providerKey: string;
      modelKey: string | null;
    };
    eligible: boolean;
    blockedBy: Array<"fallback_disabled_by_policy" | "no_interactive_surface_allowed">;
  }>;
  governanceAlignment: {
    channelsEvaluated: {
      webChat: boolean;
      telegram: boolean;
      whatsapp: boolean;
      max: boolean;
    };
    costDrivingAllowed: boolean;
    costDrivingQuotaGoverned: boolean;
  };
  notes: string[];
};
