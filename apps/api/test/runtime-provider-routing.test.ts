import assert from "node:assert/strict";
import { ResolveRuntimeProviderRoutingService } from "../src/modules/workspace-management/application/resolve-runtime-provider-routing.service";

async function run(): Promise<void> {
  const service = new ResolveRuntimeProviderRoutingService();
  const resolved = service.execute({
    effectiveCapabilities: {
      schema: "persai.effectiveCapabilities.v1",
      derivedFrom: {
        planCode: "starter_trial",
        planStatus: "active",
        governanceSchema: null
      },
      subscription: {
        source: "workspace_subscription",
        status: "trialing",
        planCode: "starter_trial",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      },
      toolClasses: {
        costDriving: {
          allowed: false,
          quotaGoverned: true
        },
        utility: {
          allowed: true,
          quotaGoverned: true
        }
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      }
    },
    secretRefs: null,
    policyEnvelope: {
      runtimeProviderRouting: {
        schema: "persai.runtimeProviderRoutingPolicy.v1",
        primaryModelKey: "text_premium_primary",
        fallbackModelKey: "text_fast_alt",
        degradeModelKey: "text_safe_low_cost",
        disableFallback: false
      }
    }
  });

  assert.equal(resolved.schema, "persai.runtimeProviderRouting.v1");
  assert.equal(resolved.userFacingProviderPickerEnabled, false);
  assert.equal(resolved.primaryPath.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.normalReply.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.premiumReply.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.reasoning.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.systemTool.modelKey, "text_premium_primary");
  assert.equal(resolved.modelSlots.retrieval.modelKey, "text_premium_primary");
  assert.equal(resolved.primaryPath.active, true);
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "provider_failure_or_timeout")?.target
      .modelKey,
    "text_fast_alt"
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "runtime_degraded")?.target.modelKey,
    "text_safe_low_cost"
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "cost_driving_restricted")?.eligible,
    true
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "cost_driving_restricted")?.strategy,
    "degrade_to_safe_mode"
  );
  assert.equal(
    resolved.fallbackMatrix.find((item) => item.trigger === "cost_driving_restricted")?.target
      .modelKey,
    "text_safe_low_cost"
  );

  const adminManaged = service.execute({
    effectiveCapabilities: {
      schema: "persai.effectiveCapabilities.v1",
      derivedFrom: {
        planCode: "starter_trial",
        planStatus: "active",
        governanceSchema: null
      },
      subscription: {
        source: "workspace_subscription",
        status: "trialing",
        planCode: "starter_trial",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      },
      toolClasses: {
        costDriving: {
          allowed: true,
          quotaGoverned: false
        },
        utility: {
          allowed: true,
          quotaGoverned: false
        }
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: false,
        whatsapp: false,
        max: false
      }
    },
    secretRefs: {
      refs: {
        runtime_provider_credentials: {
          schema: "persai.runtimeProviderCredentialRefs.v1",
          providers: {
            openai: {
              secretRef: {
                source: "env",
                provider: "default",
                id: "OPENAI_API_KEY"
              }
            },
            anthropic: {
              secretRef: {
                source: "env",
                provider: "default",
                id: "ANTHROPIC_API_KEY"
              }
            }
          }
        }
      }
    },
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallback: {
          provider: "anthropic",
          model: "claude-sonnet-4-5"
        }
      }
    },
    planPremiumModelKey: "gpt-5.4",
    planReasoningModelKey: "gpt-5.4-mini",
    planSystemToolModelKey: "gpt-5.4-cheap",
    planRetrievalModelKey: "gpt-5.4-nano"
  });

  assert.equal(adminManaged.primaryPath.providerKey, "openai");
  assert.equal(adminManaged.primaryPath.modelKey, "gpt-5.4");
  assert.equal(adminManaged.modelSlots.normalReply.modelKey, "gpt-5.4");
  assert.equal(adminManaged.modelSlots.premiumReply.modelKey, "gpt-5.4");
  assert.equal(adminManaged.modelSlots.reasoning.modelKey, "gpt-5.4-mini");
  assert.equal(
    adminManaged.modelSlots.systemTool.modelKey,
    "gpt-5.4-cheap",
    "plan-level systemToolModelKey must override the provider profile primary model"
  );
  assert.equal(adminManaged.modelSlots.retrieval.modelKey, "gpt-5.4-nano");
  assert.equal(
    adminManaged.fallbackMatrix.find((item) => item.trigger === "provider_failure_or_timeout")
      ?.target.providerKey,
    "anthropic"
  );
  assert.equal(
    adminManaged.fallbackMatrix.find((item) => item.trigger === "runtime_degraded")?.target
      .modelKey,
    "claude-sonnet-4-5"
  );

  // ADR-122 D2 — slot capability enrichment
  runAdr122SlotEnrichmentTests(service);
  runAdr124MixedProviderTests(service);
}

import type { RuntimeProviderProfileState } from "../src/modules/workspace-management/application/runtime-provider-profile";

function makeAdminProfile(
  modelKey: string,
  maxOutputTokens: number | null,
  contextWindow: number | null,
  promptCacheRetention: "in_memory" | "24h" | null = null
): RuntimeProviderProfileState {
  return {
    schema: "persai.runtimeProviderProfile.v1" as const,
    mode: "admin_managed" as const,
    derivedFrom: {
      policyEnvelopeSchema: "persai.runtimeProviderProfile.v1" as const,
      secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1" as const
    },
    allowedProviders: ["anthropic"],
    availableModelsByProvider: { openai: [], anthropic: [modelKey], deepseek: [] },
    availableModelCatalogByProvider: {
      openai: { models: [] },
      anthropic: {
        models: [
          {
            model: modelKey,
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens,
            contextWindow,
            promptCacheRetention,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          }
        ]
      },
      deepseek: { models: [] },
      runway: { models: [] },
      kling: { models: [] },
      heygen: { models: [] }
    },
    primary: {
      provider: "anthropic",
      model: modelKey,
      credentialRef: {
        secretRef: { source: "persai", provider: "persai-runtime", id: "anthropic/api-key" }
      }
    },
    fallback: null,
    notes: []
  };
}

function makeMixedProviderProfile(): RuntimeProviderProfileState {
  return {
    schema: "persai.runtimeProviderProfile.v1" as const,
    mode: "admin_managed" as const,
    derivedFrom: {
      policyEnvelopeSchema: "persai.runtimeProviderProfile.v1" as const,
      secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1" as const
    },
    allowedProviders: ["openai", "anthropic", "deepseek", "runway"],
    availableModelsByProvider: {
      openai: ["gpt-5.4", "gpt-5.4-cheap", "shared-open-model"],
      anthropic: [
        "claude-sonnet",
        "claude-reasoning",
        "claude-retrieval",
        "shared-open-model",
        "shared-foreign-model"
      ],
      deepseek: ["deepseek-v4-pro"],
      runway: ["shared-foreign-model"]
    },
    availableModelCatalogByProvider: {
      openai: {
        models: [
          {
            model: "gpt-5.4",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 16_000,
            contextWindow: 128_000,
            promptCacheRetention: "24h",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          },
          {
            model: "gpt-5.4-cheap",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 4_000,
            contextWindow: 64_000,
            promptCacheRetention: null,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          },
          {
            model: "shared-open-model",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 6_000,
            contextWindow: 96_000,
            promptCacheRetention: null,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          }
        ]
      },
      anthropic: {
        models: [
          {
            model: "claude-sonnet",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 12_000,
            contextWindow: 200_000,
            promptCacheRetention: "in_memory",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          },
          {
            model: "claude-reasoning",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 32_000,
            contextWindow: 256_000,
            promptCacheRetention: "24h",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          },
          {
            model: "claude-retrieval",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 8_000,
            contextWindow: 180_000,
            promptCacheRetention: "in_memory",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          },
          {
            model: "shared-open-model",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 10_000,
            contextWindow: 140_000,
            promptCacheRetention: "in_memory",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          },
          {
            model: "shared-foreign-model",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 9_000,
            contextWindow: 150_000,
            promptCacheRetention: "24h",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          }
        ]
      },
      deepseek: {
        models: [
          {
            model: "deepseek-v4-pro",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 384_000,
            contextWindow: 1_000_000,
            promptCacheRetention: "in_memory",
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          }
        ]
      },
      runway: {
        models: [
          {
            model: "shared-foreign-model",
            capabilities: ["chat"],
            kind: "cinematic",
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            maxOutputTokens: 7_000,
            contextWindow: 110_000,
            promptCacheRetention: null,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0,
                outputPer1M: 0
              }
            }
          }
        ]
      },
      kling: { models: [] },
      heygen: { models: [] }
    },
    primary: {
      provider: "openai",
      model: "gpt-5.4",
      credentialRef: {
        secretRef: { source: "persai", provider: "persai-runtime", id: "openai/api-key" }
      }
    },
    fallback: {
      provider: "anthropic",
      model: "claude-sonnet",
      credentialRef: {
        secretRef: { source: "persai", provider: "persai-runtime", id: "anthropic/api-key" }
      }
    },
    notes: []
  };
}

function baseEffectiveCapabilities() {
  return {
    schema: "persai.effectiveCapabilities.v1" as const,
    derivedFrom: { planCode: "starter_trial", planStatus: "active", governanceSchema: null },
    subscription: {
      source: "workspace_subscription" as const,
      status: "active" as const,
      planCode: "starter_trial",
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false
    },
    toolClasses: {
      costDriving: { allowed: true, quotaGoverned: false },
      utility: { allowed: true, quotaGoverned: false }
    },
    channelsAndSurfaces: { webChat: true, telegram: false, whatsapp: false, max: false }
  };
}

function runAdr122SlotEnrichmentTests(service: ResolveRuntimeProviderRoutingService) {
  // Slot resolves to model with known capabilities → slot carries them
  const profileWithCapabilities = makeAdminProfile(
    "claude-opus-4-6",
    128_000,
    200_000,
    "in_memory"
  );
  const resolvedWithCapabilities = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: profileWithCapabilities
  });
  assert.equal(
    resolvedWithCapabilities.modelSlots.normalReply.maxOutputTokens,
    128_000,
    "normalReply slot carries maxOutputTokens from catalog"
  );
  assert.equal(
    resolvedWithCapabilities.modelSlots.normalReply.contextWindow,
    200_000,
    "normalReply slot carries contextWindow from catalog"
  );
  assert.equal(
    resolvedWithCapabilities.modelSlots.normalReply.promptCacheRetention,
    "in_memory",
    "normalReply slot carries promptCacheRetention from catalog"
  );
  assert.equal(
    resolvedWithCapabilities.modelSlots.premiumReply.maxOutputTokens,
    128_000,
    "premiumReply slot carries maxOutputTokens from catalog"
  );
  assert.equal(
    resolvedWithCapabilities.modelSlots.premiumReply.promptCacheRetention,
    "in_memory",
    "premiumReply slot carries promptCacheRetention from catalog"
  );

  // Slot resolves to model with null capabilities → slot carries null
  const profileWithNulls = makeAdminProfile("claude-opus-4-6", null, null, null);
  const resolvedWithNulls = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: profileWithNulls
  });
  assert.equal(
    resolvedWithNulls.modelSlots.normalReply.maxOutputTokens,
    null,
    "null maxOutputTokens round-trips through slot"
  );
  assert.equal(
    resolvedWithNulls.modelSlots.normalReply.contextWindow,
    null,
    "null contextWindow round-trips through slot"
  );
  assert.equal(
    resolvedWithNulls.modelSlots.normalReply.promptCacheRetention,
    null,
    "null promptCacheRetention round-trips through slot"
  );

  // Slot with unknown modelKey → null
  const resolvedUnknownModel = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    planPrimaryModelKey: "non-existent-model",
    runtimeProviderProfile: profileWithCapabilities
  });
  assert.equal(
    resolvedUnknownModel.modelSlots.normalReply.maxOutputTokens,
    null,
    "unknown model → null maxOutputTokens on slot"
  );
  assert.equal(
    resolvedUnknownModel.modelSlots.normalReply.contextWindow,
    null,
    "unknown model → null contextWindow on slot"
  );
  assert.equal(
    resolvedUnknownModel.modelSlots.normalReply.promptCacheRetention,
    null,
    "unknown model → null promptCacheRetention on slot"
  );
}

function runAdr124MixedProviderTests(service: ResolveRuntimeProviderRoutingService) {
  const resolved = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: makeMixedProviderProfile(),
    planPrimaryModelKey: "gpt-5.4",
    planPrimaryModelProviderKey: "openai",
    planPremiumModelKey: null,
    planPremiumModelProviderKey: null,
    planReasoningModelKey: "deepseek-v4-pro",
    planReasoningModelProviderKey: "deepseek",
    planSystemToolModelKey: "gpt-5.4-cheap",
    planSystemToolModelProviderKey: "openai",
    planRetrievalModelKey: "claude-retrieval",
    planRetrievalModelProviderKey: "anthropic"
  });

  assert.equal(resolved.primaryPath.providerKey, "openai");
  assert.equal(resolved.primaryPath.modelKey, "gpt-5.4");
  assert.equal(resolved.modelSlots.normalReply.providerKey, "openai");
  assert.equal(resolved.modelSlots.normalReply.maxOutputTokens, 16_000);
  assert.equal(resolved.modelSlots.normalReply.promptCacheRetention, "24h");
  assert.equal(
    resolved.modelSlots.premiumReply.providerKey,
    "openai",
    "unset premium should cascade from normal reply"
  );
  assert.equal(resolved.modelSlots.reasoning.providerKey, "deepseek");
  assert.equal(resolved.modelSlots.reasoning.modelKey, "deepseek-v4-pro");
  assert.equal(resolved.modelSlots.reasoning.contextWindow, 1_000_000);
  assert.equal(resolved.modelSlots.reasoning.maxOutputTokens, 384_000);
  assert.equal(resolved.modelSlots.reasoning.promptCacheRetention, "in_memory");
  assert.equal(resolved.modelSlots.systemTool.providerKey, "openai");
  assert.equal(resolved.modelSlots.systemTool.modelKey, "gpt-5.4-cheap");
  assert.equal(resolved.modelSlots.systemTool.maxOutputTokens, 4_000);
  assert.equal(resolved.modelSlots.retrieval.providerKey, "anthropic");
  assert.equal(resolved.modelSlots.retrieval.modelKey, "claude-retrieval");
  assert.equal(resolved.modelSlots.retrieval.contextWindow, 180_000);
  assert.equal(resolved.modelSlots.retrieval.promptCacheRetention, "in_memory");
  const providerFailureTarget = resolved.fallbackMatrix.find(
    (item) => item.trigger === "provider_failure_or_timeout"
  )?.target;
  assert.deepEqual(
    providerFailureTarget,
    { providerKey: "anthropic", modelKey: "claude-sonnet" },
    "provider_failure_or_timeout must remain a single global fallback target"
  );

  const ambiguousWithoutDisambiguation = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: makeMixedProviderProfile(),
    planPrimaryModelKey: "shared-foreign-model"
  });
  assert.equal(
    ambiguousWithoutDisambiguation.modelSlots.normalReply.modelKey,
    null,
    "ambiguous model-only normal slot must fail closed when no default provider owns it"
  );

  const ambiguousResolvedByInherited = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: makeMixedProviderProfile(),
    planPrimaryModelKey: "shared-open-model",
    planPrimaryModelProviderKey: "openai",
    planPremiumModelKey: "shared-open-model"
  });
  assert.equal(
    ambiguousResolvedByInherited.modelSlots.premiumReply.providerKey,
    "openai",
    "ambiguous model-only slot may resolve through a valid inherited provider"
  );
  assert.equal(ambiguousResolvedByInherited.modelSlots.premiumReply.modelKey, "shared-open-model");

  const explicitProviderMismatch = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: makeMixedProviderProfile(),
    planReasoningModelKey: "gpt-5.4-cheap",
    planReasoningModelProviderKey: "anthropic"
  });
  assert.equal(
    explicitProviderMismatch.modelSlots.reasoning.modelKey,
    null,
    "explicit provider/model mismatch must fail closed instead of falling back to another provider"
  );

  const explicitProviderStaleModel = service.execute({
    effectiveCapabilities: baseEffectiveCapabilities(),
    policyEnvelope: null,
    runtimeProviderProfile: makeMixedProviderProfile(),
    planSystemToolModelKey: "non-existent-model",
    planSystemToolModelProviderKey: "openai"
  });
  assert.equal(
    explicitProviderStaleModel.modelSlots.systemTool.modelKey,
    null,
    "explicit provider + stale nonexistent model must resolve as unset"
  );
}

void run();
