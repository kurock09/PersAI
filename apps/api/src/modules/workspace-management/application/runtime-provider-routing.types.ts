import type { RuntimeProviderPromptCachePolicy } from "./runtime-provider-profile";

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
      /** ADR-122 D2 — resolved from model catalog at routing time; null when unset. */
      maxOutputTokens?: number | null;
      /** ADR-122 D2 — resolved from model catalog at routing time; null when unset. */
      contextWindow?: number | null;
      /** ADR-161 S3 — resolved from model catalog at routing time; null means explicit uncached mode. */
      promptCachePolicy?: RuntimeProviderPromptCachePolicy | null;
    };
    premiumReply: {
      providerKey: string;
      modelKey: string | null;
      maxOutputTokens?: number | null;
      contextWindow?: number | null;
      promptCachePolicy?: RuntimeProviderPromptCachePolicy | null;
    };
    reasoning: {
      providerKey: string;
      modelKey: string | null;
      maxOutputTokens?: number | null;
      contextWindow?: number | null;
      promptCachePolicy?: RuntimeProviderPromptCachePolicy | null;
    };
    systemTool: {
      providerKey: string;
      modelKey: string | null;
      maxOutputTokens?: number | null;
      contextWindow?: number | null;
      promptCachePolicy?: RuntimeProviderPromptCachePolicy | null;
    };
    retrieval: {
      providerKey: string;
      modelKey: string | null;
      maxOutputTokens?: number | null;
      contextWindow?: number | null;
      promptCachePolicy?: RuntimeProviderPromptCachePolicy | null;
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
