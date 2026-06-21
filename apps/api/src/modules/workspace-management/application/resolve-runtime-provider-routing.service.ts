import { Injectable } from "@nestjs/common";
import type { EffectiveCapabilityState } from "./effective-capability.types";
import {
  resolveRuntimeProviderProfileState,
  type RuntimeProviderModelCatalogByProvider,
  type RuntimeProviderProfileState
} from "./runtime-provider-profile";
import type { RuntimeProviderRoutingState } from "./runtime-provider-routing.types";
import { normalizeModelKey, toNormalizedNonEmptyModelKey } from "./model-key-normalization";

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNormalizedNonEmptyProviderKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * ADR-122 D2 — look up maxOutputTokens / contextWindow for a resolved
 * (providerKey, modelKey) pair from the admin catalog. Returns null for both
 * when the model is not found or the provider is not a managed catalog provider.
 */
function lookupModelCapabilities(
  catalog: RuntimeProviderModelCatalogByProvider,
  providerKey: string,
  modelKey: string | null
): {
  maxOutputTokens: number | null;
  contextWindow: number | null;
  promptCacheRetention: "in_memory" | "24h" | null;
} {
  if (modelKey === null) {
    return { maxOutputTokens: null, contextWindow: null, promptCacheRetention: null };
  }
  const providerCatalog = catalog[providerKey as keyof RuntimeProviderModelCatalogByProvider];
  if (!providerCatalog) {
    return { maxOutputTokens: null, contextWindow: null, promptCacheRetention: null };
  }
  const profile = providerCatalog.models.find((m) => m.active && m.model === modelKey);
  if (!profile) {
    return { maxOutputTokens: null, contextWindow: null, promptCacheRetention: null };
  }
  return {
    maxOutputTokens: profile.maxOutputTokens,
    contextWindow: profile.contextWindow,
    promptCacheRetention: profile.promptCacheRetention
  };
}

function hasActiveChatModel(
  catalog: RuntimeProviderModelCatalogByProvider,
  providerKey: string | null,
  modelKey: string | null
): boolean {
  if (providerKey === null || modelKey === null) {
    return false;
  }
  const providerCatalog = catalog[providerKey as keyof RuntimeProviderModelCatalogByProvider];
  return (
    providerCatalog?.models.some(
      (profile) =>
        profile.active && profile.model === modelKey && profile.capabilities.includes("chat")
    ) ?? false
  );
}

function providersWithActiveChatModel(
  catalog: RuntimeProviderModelCatalogByProvider,
  modelKey: string | null
): string[] {
  if (modelKey === null) {
    return [];
  }
  return Object.entries(catalog)
    .filter(([, providerCatalog]) =>
      providerCatalog.models.some(
        (profile) =>
          profile.active && profile.model === modelKey && profile.capabilities.includes("chat")
      )
    )
    .map(([providerKey]) => providerKey);
}

function resolveProviderForModel(
  catalog: RuntimeProviderModelCatalogByProvider,
  modelKey: string | null,
  preferredProviders: Array<string | null | undefined>
): string | null {
  const candidates = providersWithActiveChatModel(catalog, modelKey);
  if (candidates.length === 0) {
    return null;
  }
  for (const preferredProvider of preferredProviders) {
    if (
      preferredProvider !== null &&
      preferredProvider !== undefined &&
      candidates.includes(preferredProvider)
    ) {
      return preferredProvider;
    }
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

type ResolvedSlotSelection = {
  providerKey: string;
  modelKey: string | null;
};

function resolveSlotSelection(params: {
  catalog: RuntimeProviderModelCatalogByProvider;
  explicitModelKey: string | null;
  explicitProviderKey: string | null;
  inheritedSelection?: ResolvedSlotSelection | null;
  defaultSelection?: ResolvedSlotSelection | null;
  unresolvedProviderFallback: string;
}): ResolvedSlotSelection {
  const inheritedSelection = params.inheritedSelection ?? null;
  const defaultSelection = params.defaultSelection ?? null;
  const modelKey =
    params.explicitModelKey ?? inheritedSelection?.modelKey ?? defaultSelection?.modelKey ?? null;
  if (modelKey === null) {
    return {
      providerKey:
        params.explicitProviderKey ??
        inheritedSelection?.providerKey ??
        defaultSelection?.providerKey ??
        params.unresolvedProviderFallback,
      modelKey: null
    };
  }
  if (params.explicitModelKey !== null) {
    const candidateProviders = providersWithActiveChatModel(params.catalog, modelKey);
    if (params.explicitProviderKey !== null) {
      return hasActiveChatModel(params.catalog, params.explicitProviderKey, modelKey)
        ? {
            providerKey: params.explicitProviderKey,
            modelKey
          }
        : {
            providerKey: params.explicitProviderKey,
            modelKey: null
          };
    }
    const resolvedProvider = resolveProviderForModel(params.catalog, modelKey, [
      inheritedSelection?.providerKey,
      defaultSelection?.providerKey
    ]);
    return {
      providerKey:
        resolvedProvider ??
        inheritedSelection?.providerKey ??
        defaultSelection?.providerKey ??
        params.unresolvedProviderFallback,
      modelKey: resolvedProvider !== null || candidateProviders.length === 0 ? modelKey : null
    };
  }
  if (inheritedSelection?.modelKey === modelKey) {
    return inheritedSelection;
  }
  if (defaultSelection?.modelKey === modelKey) {
    return defaultSelection;
  }
  const resolvedProvider = resolveProviderForModel(params.catalog, modelKey, [
    defaultSelection?.providerKey
  ]);
  return {
    providerKey:
      resolvedProvider ?? defaultSelection?.providerKey ?? params.unresolvedProviderFallback,
    modelKey: resolvedProvider === null ? null : modelKey
  };
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
    primaryModelKey: toNormalizedNonEmptyModelKey(routing?.primaryModelKey),
    fallbackModelKey: toNormalizedNonEmptyModelKey(routing?.fallbackModelKey),
    degradeModelKey: toNormalizedNonEmptyModelKey(routing?.degradeModelKey),
    disableFallback: routing?.disableFallback === true
  };
}

@Injectable()
export class ResolveRuntimeProviderRoutingService {
  execute(params: {
    effectiveCapabilities: EffectiveCapabilityState;
    policyEnvelope: unknown | null;
    runtimeProviderProfile?: RuntimeProviderProfileState;
    secretRefs?: unknown | null;
    planPrimaryModelKey?: string | null;
    planPrimaryModelProviderKey?: string | null;
    planPremiumModelKey?: string | null;
    planPremiumModelProviderKey?: string | null;
    planReasoningModelKey?: string | null;
    planReasoningModelProviderKey?: string | null;
    planSystemToolModelKey?: string | null;
    planSystemToolModelProviderKey?: string | null;
    planRetrievalModelKey?: string | null;
    planRetrievalModelProviderKey?: string | null;
  }): RuntimeProviderRoutingState {
    const { effectiveCapabilities, policyEnvelope } = params;
    const runtimeProviderProfile =
      params.runtimeProviderProfile ??
      resolveRuntimeProviderProfileState({
        policyEnvelope,
        secretRefs: params.secretRefs ?? null
      });
    const override = parseRoutingPolicyOverride(policyEnvelope);

    const channels = effectiveCapabilities.channelsAndSurfaces;
    const hasInteractiveSurface =
      channels.webChat || channels.telegram || channels.whatsapp || channels.max;
    const primaryActive = hasInteractiveSurface;
    const inactiveReason = !hasInteractiveSurface ? "no_interactive_surface_allowed" : null;

    const managedPrimary =
      runtimeProviderProfile.mode === "admin_managed" ? runtimeProviderProfile.primary : null;
    const managedFallback =
      runtimeProviderProfile.mode === "admin_managed" ? runtimeProviderProfile.fallback : null;
    const primaryProviderKey = managedPrimary?.provider ?? "platform_managed_default";
    const planModelKey = toNormalizedNonEmptyModelKey(params.planPrimaryModelKey);
    const planModelProviderKey = toNormalizedNonEmptyProviderKey(
      params.planPrimaryModelProviderKey
    );
    const planPremiumModelKey = toNormalizedNonEmptyModelKey(params.planPremiumModelKey);
    const planPremiumModelProviderKey = toNormalizedNonEmptyProviderKey(
      params.planPremiumModelProviderKey
    );
    const planReasoningModelKey = toNormalizedNonEmptyModelKey(params.planReasoningModelKey);
    const planReasoningModelProviderKey = toNormalizedNonEmptyProviderKey(
      params.planReasoningModelProviderKey
    );
    const planSystemToolModelKey = toNormalizedNonEmptyModelKey(params.planSystemToolModelKey);
    const planSystemToolModelProviderKey = toNormalizedNonEmptyProviderKey(
      params.planSystemToolModelProviderKey
    );
    const planRetrievalModelKey = toNormalizedNonEmptyModelKey(params.planRetrievalModelKey);
    const planRetrievalModelProviderKey = toNormalizedNonEmptyProviderKey(
      params.planRetrievalModelProviderKey
    );
    const managedPrimarySelection =
      managedPrimary === null
        ? null
        : {
            providerKey: managedPrimary.provider,
            modelKey: normalizeModelKey(managedPrimary.model)
          };
    const overridePrimarySelection =
      override.primaryModelKey === null
        ? null
        : runtimeProviderProfile.mode !== "admin_managed"
          ? {
              providerKey: primaryProviderKey,
              modelKey: override.primaryModelKey
            }
          : (() => {
              const providerKey = resolveProviderForModel(
                runtimeProviderProfile.availableModelCatalogByProvider,
                override.primaryModelKey,
                [managedPrimarySelection?.providerKey]
              );
              return providerKey === null
                ? null
                : {
                    providerKey,
                    modelKey: override.primaryModelKey
                  };
            })();
    const normalReplySelection = resolveSlotSelection({
      catalog: runtimeProviderProfile.availableModelCatalogByProvider,
      explicitModelKey: planModelKey,
      explicitProviderKey: planModelProviderKey,
      inheritedSelection: null,
      defaultSelection: managedPrimarySelection ?? overridePrimarySelection,
      unresolvedProviderFallback: primaryProviderKey
    });
    const premiumReplySelection = resolveSlotSelection({
      catalog: runtimeProviderProfile.availableModelCatalogByProvider,
      explicitModelKey: planPremiumModelKey,
      explicitProviderKey: planPremiumModelProviderKey,
      inheritedSelection: normalReplySelection,
      defaultSelection: null,
      unresolvedProviderFallback: normalReplySelection.providerKey
    });
    const reasoningSelection = resolveSlotSelection({
      catalog: runtimeProviderProfile.availableModelCatalogByProvider,
      explicitModelKey: planReasoningModelKey,
      explicitProviderKey: planReasoningModelProviderKey,
      inheritedSelection: premiumReplySelection,
      defaultSelection: normalReplySelection,
      unresolvedProviderFallback: premiumReplySelection.providerKey
    });
    const systemToolSelection = resolveSlotSelection({
      catalog: runtimeProviderProfile.availableModelCatalogByProvider,
      explicitModelKey: planSystemToolModelKey,
      explicitProviderKey: planSystemToolModelProviderKey,
      inheritedSelection: normalReplySelection,
      defaultSelection: managedPrimarySelection,
      unresolvedProviderFallback: primaryProviderKey
    });
    const retrievalSelection = resolveSlotSelection({
      catalog: runtimeProviderProfile.availableModelCatalogByProvider,
      explicitModelKey: planRetrievalModelKey,
      explicitProviderKey: planRetrievalModelProviderKey,
      inheritedSelection: systemToolSelection,
      defaultSelection: normalReplySelection,
      unresolvedProviderFallback: systemToolSelection.providerKey
    });
    const fallbackProviderKey = managedFallback?.provider ?? primaryProviderKey;
    const fallbackModelKey =
      (managedFallback?.model ? normalizeModelKey(managedFallback.model) : null) ??
      override.fallbackModelKey ??
      (managedPrimary?.model ? normalizeModelKey(managedPrimary.model) : null) ??
      null;
    const degradeProviderKey = managedFallback?.provider ?? primaryProviderKey;
    const degradeModelKey =
      (managedFallback?.model ? normalizeModelKey(managedFallback.model) : null) ??
      override.degradeModelKey ??
      normalReplySelection.modelKey ??
      (managedPrimary?.model ? normalizeModelKey(managedPrimary.model) : null) ??
      null;
    const blockedByCommon: Array<"fallback_disabled_by_policy" | "no_interactive_surface_allowed"> =
      [];
    const fallbackDisabled =
      managedPrimary !== null ? managedFallback === null : override.disableFallback;
    if (fallbackDisabled) {
      blockedByCommon.push("fallback_disabled_by_policy");
    }
    if (!hasInteractiveSurface) {
      blockedByCommon.push("no_interactive_surface_allowed");
    }

    return {
      schema: "persai.runtimeProviderRouting.v1",
      derivedFrom: {
        effectiveCapabilitiesSchema: effectiveCapabilities.schema ?? null,
        policyEnvelopeSchema:
          runtimeProviderProfile.mode === "admin_managed"
            ? runtimeProviderProfile.derivedFrom.policyEnvelopeSchema
            : override.schema,
        planCode: effectiveCapabilities.derivedFrom.planCode
      },
      userFacingProviderPickerEnabled: false,
      modelSlots: {
        normalReply: {
          providerKey: normalReplySelection.providerKey,
          modelKey: normalReplySelection.modelKey,
          ...lookupModelCapabilities(
            runtimeProviderProfile.availableModelCatalogByProvider,
            normalReplySelection.providerKey,
            normalReplySelection.modelKey
          )
        },
        premiumReply: {
          providerKey: premiumReplySelection.providerKey,
          modelKey: premiumReplySelection.modelKey,
          ...lookupModelCapabilities(
            runtimeProviderProfile.availableModelCatalogByProvider,
            premiumReplySelection.providerKey,
            premiumReplySelection.modelKey
          )
        },
        reasoning: {
          providerKey: reasoningSelection.providerKey,
          modelKey: reasoningSelection.modelKey,
          ...lookupModelCapabilities(
            runtimeProviderProfile.availableModelCatalogByProvider,
            reasoningSelection.providerKey,
            reasoningSelection.modelKey
          )
        },
        systemTool: {
          providerKey: systemToolSelection.providerKey,
          modelKey: systemToolSelection.modelKey,
          ...lookupModelCapabilities(
            runtimeProviderProfile.availableModelCatalogByProvider,
            systemToolSelection.providerKey,
            systemToolSelection.modelKey
          )
        },
        retrieval: {
          providerKey: retrievalSelection.providerKey,
          modelKey: retrievalSelection.modelKey,
          ...lookupModelCapabilities(
            runtimeProviderProfile.availableModelCatalogByProvider,
            retrievalSelection.providerKey,
            retrievalSelection.modelKey
          )
        }
      },
      primaryPath: {
        providerKey: normalReplySelection.providerKey,
        modelKey: normalReplySelection.modelKey,
        active: primaryActive,
        inactiveReason
      },
      fallbackMatrix: [
        {
          trigger: "provider_failure_or_timeout",
          strategy: "fallback_model",
          target: {
            providerKey: fallbackProviderKey,
            modelKey: fallbackModelKey
          },
          eligible: primaryActive && !fallbackDisabled,
          blockedBy: blockedByCommon
        },
        {
          trigger: "runtime_degraded",
          strategy: "degrade_to_safe_mode",
          target: {
            providerKey: degradeProviderKey,
            modelKey: degradeModelKey
          },
          eligible: primaryActive && !fallbackDisabled,
          blockedBy: blockedByCommon.filter((item) => item !== "fallback_disabled_by_policy")
        },
        {
          trigger: "cost_driving_restricted",
          strategy: "degrade_to_safe_mode",
          target: {
            providerKey: degradeProviderKey,
            modelKey: degradeModelKey
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
        costDrivingAllowed: effectiveCapabilities.toolClasses.costDriving.allowed,
        costDrivingQuotaGoverned: effectiveCapabilities.toolClasses.costDriving.quotaGoverned
      },
      notes:
        runtimeProviderProfile.mode === "admin_managed"
          ? [
              "H1 baseline derives runtime routing from PersAI admin-managed provider profile.",
              "PersAI-native runtime executes the applied path through provider-gateway and platform-managed runtime secret wiring.",
              "No user-facing provider picker or provider marketplace logic is introduced in this slice."
            ]
          : [
              "E6 baseline keeps provider routing runtime-managed with no user-facing picker.",
              "Fallback path is explicit and constrained by effective capabilities and policy envelope overrides.",
              "No provider marketplace logic is introduced in this slice."
            ]
    };
  }
}
