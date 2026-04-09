export type RuntimeProviderRoutingState = {
  schema: "persai.runtimeProviderRouting.v1";
  derivedFrom: {
    effectiveCapabilitiesSchema: string | null;
    policyEnvelopeSchema: string | null;
    planCode: string | null;
  };
  userFacingProviderPickerEnabled: false;
  primaryPath: {
    providerKey: string;
    modelKey: string | null;
    active: boolean;
    inactiveReason: null | "no_interactive_surface_allowed" | "text_media_not_allowed";
  };
  fallbackMatrix: Array<{
    trigger: "provider_failure_or_timeout" | "runtime_degraded" | "cost_driving_restricted";
    strategy: "fallback_model" | "degrade_to_safe_mode";
    target: {
      providerKey: string;
      modelKey: string | null;
    };
    eligible: boolean;
    blockedBy: Array<
      "fallback_disabled_by_policy" | "no_interactive_surface_allowed" | "text_media_not_allowed"
    >;
  }>;
  governanceAlignment: {
    channelsEvaluated: {
      webChat: boolean;
      telegram: boolean;
      whatsapp: boolean;
      max: boolean;
    };
    textMediaAllowed: boolean;
    costDrivingAllowed: boolean;
    costDrivingQuotaGoverned: boolean;
  };
  notes: string[];
};
