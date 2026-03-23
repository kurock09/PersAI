import { Injectable } from "@nestjs/common";
import type { EffectiveCapabilityState } from "./effective-capability.types";
import type { RuntimeProviderRoutingState } from "./runtime-provider-routing.types";

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

type RoutingPolicyOverride = {
  schema: string | null;
  primaryModelKey: string | null;
  fallbackModelKey: string | null;
  degradeModelKey: string | null;
  disableFallback: boolean;
};

function parseRoutingPolicyOverride(policyEnvelope: unknown): RoutingPolicyOverride {
  const envelope = asObject(policyEnvelope);
  const routing = asObject(envelope?.runtimeProviderRouting ?? null);
  return {
    schema:
      typeof routing?.schema === "string" && routing.schema.trim().length > 0
        ? routing.schema.trim()
        : null,
    primaryModelKey:
      typeof routing?.primaryModelKey === "string" && routing.primaryModelKey.trim().length > 0
        ? routing.primaryModelKey.trim()
        : null,
    fallbackModelKey:
      typeof routing?.fallbackModelKey === "string" && routing.fallbackModelKey.trim().length > 0
        ? routing.fallbackModelKey.trim()
        : null,
    degradeModelKey:
      typeof routing?.degradeModelKey === "string" && routing.degradeModelKey.trim().length > 0
        ? routing.degradeModelKey.trim()
        : null,
    disableFallback: routing?.disableFallback === true
  };
}

@Injectable()
export class ResolveRuntimeProviderRoutingService {
  execute(params: {
    effectiveCapabilities: EffectiveCapabilityState;
    policyEnvelope: unknown | null;
  }): RuntimeProviderRoutingState {
    const { effectiveCapabilities, policyEnvelope } = params;
    const override = parseRoutingPolicyOverride(policyEnvelope);

    const channels = effectiveCapabilities.channelsAndSurfaces;
    const hasInteractiveSurface =
      channels.webChat || channels.telegram || channels.whatsapp || channels.max;
    const textMediaAllowed = effectiveCapabilities.mediaClasses.text;
    const primaryActive = hasInteractiveSurface && textMediaAllowed;
    const inactiveReason = !hasInteractiveSurface
      ? "no_interactive_surface_allowed"
      : !textMediaAllowed
        ? "text_media_not_allowed"
        : null;

    const primaryModelKey = override.primaryModelKey ?? "text_standard_v1";
    const fallbackModelKey = override.fallbackModelKey ?? "text_fast_fallback_v1";
    const degradeModelKey = override.degradeModelKey ?? "text_safe_minimal_v1";
    const blockedByCommon: Array<
      "fallback_disabled_by_policy" | "no_interactive_surface_allowed" | "text_media_not_allowed"
    > = [];
    if (override.disableFallback) {
      blockedByCommon.push("fallback_disabled_by_policy");
    }
    if (!hasInteractiveSurface) {
      blockedByCommon.push("no_interactive_surface_allowed");
    }
    if (!textMediaAllowed) {
      blockedByCommon.push("text_media_not_allowed");
    }

    return {
      schema: "persai.runtimeProviderRouting.v1",
      derivedFrom: {
        effectiveCapabilitiesSchema: effectiveCapabilities.schema ?? null,
        policyEnvelopeSchema: override.schema,
        planCode: effectiveCapabilities.derivedFrom.planCode
      },
      userFacingProviderPickerEnabled: false,
      primaryPath: {
        providerKey: "openclaw_managed_default",
        modelKey: primaryModelKey,
        active: primaryActive,
        inactiveReason
      },
      fallbackMatrix: [
        {
          trigger: "provider_failure_or_timeout",
          strategy: "fallback_model",
          target: {
            providerKey: "openclaw_managed_default",
            modelKey: fallbackModelKey
          },
          eligible: primaryActive && !override.disableFallback,
          blockedBy: blockedByCommon
        },
        {
          trigger: "runtime_degraded",
          strategy: "degrade_to_safe_mode",
          target: {
            providerKey: "openclaw_managed_default",
            modelKey: degradeModelKey
          },
          eligible: primaryActive,
          blockedBy: blockedByCommon.filter((item) => item !== "fallback_disabled_by_policy")
        },
        {
          trigger: "cost_driving_restricted",
          strategy: "constrain_tools",
          target: {
            providerKey: "openclaw_managed_default",
            modelKey: primaryModelKey
          },
          eligible:
            !effectiveCapabilities.toolClasses.costDriving.allowed ||
            effectiveCapabilities.toolClasses.costDriving.quotaGoverned,
          blockedBy: []
        }
      ],
      governanceAlignment: {
        channelsEvaluated: {
          webChat: channels.webChat,
          telegram: channels.telegram,
          whatsapp: channels.whatsapp,
          max: channels.max
        },
        textMediaAllowed,
        costDrivingAllowed: effectiveCapabilities.toolClasses.costDriving.allowed,
        costDrivingQuotaGoverned: effectiveCapabilities.toolClasses.costDriving.quotaGoverned
      },
      notes: [
        "E6 baseline keeps provider routing runtime-managed with no user-facing picker.",
        "Fallback path is explicit and constrained by effective capabilities and policy envelope overrides.",
        "No provider marketplace logic is introduced in this slice."
      ]
    };
  }
}
