import assert from "node:assert/strict";
import {
  assertRequiredProviderKeysAvailable,
  buildPlatformRuntimeProviderProfileState,
  buildPlatformRuntimeProviderSettingsState,
  createEmptyPlatformRuntimeProviderKeyMetadata,
  parseUpdatePlatformRuntimeProviderSettingsInput
} from "../src/modules/workspace-management/application/platform-runtime-provider-settings";

function tokenMeteredDefaults() {
  return {
    active: true,
    billingMode: "token_metered" as const,
    effectiveFrom: null,
    effectiveTo: null,
    providerPriceMetadata: {
      currency: "USD",
      tokenPricing: {
        inputPer1M: 0,
        cachedInputPer1M: 0,
        outputPer1M: 0
      }
    }
  };
}

function fixedOperationDefaults() {
  return {
    active: true,
    billingMode: "fixed_operation" as const,
    effectiveFrom: null,
    effectiveTo: null,
    providerPriceMetadata: {
      currency: "USD",
      fixedOperationPricing: {
        unitLabel: null,
        pricePerOperation: 0
      }
    }
  };
}

function timeMeteredDefaults() {
  return {
    active: true,
    billingMode: "time_metered" as const,
    effectiveFrom: null,
    effectiveTo: null,
    providerPriceMetadata: {
      currency: "USD",
      timePricing: {
        unit: "second" as const,
        pricePerUnit: 0
      }
    }
  };
}

function textCharsMeteredDefaults() {
  return {
    active: true,
    billingMode: "text_chars_metered" as const,
    effectiveFrom: null,
    effectiveTo: null,
    providerPriceMetadata: {
      currency: "USD",
      textCharsPricing: {
        pricePer1MChars: 18
      }
    }
  };
}

async function run(): Promise<void> {
  const parsed = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: {
      provider: "openai",
      model: "gpt‑5.4"
    },
    fallback: {
      provider: "anthropic",
      model: "claude-sonnet-4-5"
    },
    availableModelsByProvider: {
      openai: ["gpt‑5.4", "gpt‑5.4-mini"],
      anthropic: ["claude-sonnet-4-5"]
    },
    availableModelCatalogByProvider: {
      openai: {
        models: [
          {
            model: "gpt‑5.4",
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 4,
                cachedInputPer1M: 1,
                outputPer1M: 16
              }
            },
            inputTokenWeight: 1,
            cachedInputTokenWeight: 0.25,
            outputTokenWeight: 4,
            displayLabel: "GPT 5.4",
            notes: null
          },
          {
            model: "gpt‑5.4-mini",
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 2,
                cachedInputPer1M: 0.4,
                outputPer1M: 4
              }
            },
            inputTokenWeight: 0.5,
            cachedInputTokenWeight: 0.1,
            outputTokenWeight: 2,
            displayLabel: null,
            notes: null
          },
          {
            model: "gpt-image-1",
            capabilities: ["image"],
            ...tokenMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null
          },
          {
            model: "gpt-image-1.5",
            capabilities: ["image"],
            ...tokenMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null
          },
          {
            model: "sora-2",
            capabilities: ["video"],
            ...timeMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null
          },
          {
            model: "sora-2-pro",
            capabilities: ["video"],
            ...timeMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null
          },
          {
            model: "gpt-4o-mini-tts",
            capabilities: ["text_to_speech"],
            ...textCharsMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: "GPT 4o mini TTS",
            notes: null
          }
        ]
      },
      anthropic: {
        models: [
          {
            model: "claude-sonnet-4-5",
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            inputTokenWeight: 1.25,
            cachedInputTokenWeight: 0.2,
            outputTokenWeight: 5,
            displayLabel: null,
            notes: null
          }
        ]
      }
    },
    routingFastModelKey: "gpt‑5.4-mini",
    routerPolicy: {
      enabled: true,
      mode: "shadow",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      analyzeUploadsOnB2cUpload: true,
      precheckRuleOverrides: {
        continueTerms: ["ok", "continue"],
        retrievalTerms: ["find in docs"],
        reasoningTerms: ["architecture"],
        premiumTerms: ["rewrite"],
        toolTerms: ["browse"]
      }
    },
    skillRoutingPolicy: {
      initialCheckUserMessageIndex: 4,
      backgroundRecheckIntervalMessages: 6
    },
    providerKeys: {
      openai: " sk-openai-new ",
      anthropic: "sk-anthropic-new"
    }
  });

  assert.equal(parsed.primary.provider, "openai");
  assert.equal(parsed.fallback?.provider, "anthropic");
  assert.equal(parsed.primary.model, "gpt-5.4");
  assert.equal(parsed.routingFastModelKey, "gpt-5.4-mini");
  assert.equal(parsed.routerPolicy.enabled, true);
  assert.equal(parsed.routerPolicy.mode, "shadow");
  assert.equal(parsed.routerPolicy.analyzeUploadsOnB2cUpload, true);
  assert.deepEqual(parsed.routerPolicy.precheckRuleOverrides?.continueTerms, ["ok", "continue"]);
  assert.deepEqual(parsed.routerPolicy.precheckRuleOverrides?.premiumTerms, ["rewrite"]);
  assert.equal(parsed.skillRoutingPolicy.initialCheckUserMessageIndex, 4);
  assert.equal(parsed.skillRoutingPolicy.backgroundRecheckIntervalMessages, 6);
  assert.deepEqual(parsed.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);
  assert.deepEqual(parsed.availableModelsByProvider.anthropic, ["claude-sonnet-4-5"]);
  assert.deepEqual(
    parsed.availableModelCatalogByProvider.openai.models
      .filter((profile) => profile.capabilities.includes("image"))
      .map((profile) => profile.model),
    ["gpt-image-1", "gpt-image-1.5"]
  );
  assert.deepEqual(
    parsed.availableModelCatalogByProvider.openai.models
      .filter((profile) => profile.capabilities.includes("video"))
      .map((profile) => profile.model),
    ["sora-2", "sora-2-pro"]
  );
  const parsedTtsProfile = parsed.availableModelCatalogByProvider.openai.models.find(
    (profile) => profile.model === "gpt-4o-mini-tts"
  );
  assert.equal(parsedTtsProfile?.billingMode, "text_chars_metered");
  assert.deepEqual(parsedTtsProfile?.providerPriceMetadata, {
    currency: "USD",
    textCharsPricing: {
      pricePer1MChars: 18
    }
  });
  assert.equal(parsed.availableModelCatalogByProvider.openai.models[0]?.inputTokenWeight, 4);
  assert.equal(parsed.availableModelCatalogByProvider.openai.models[0]?.cachedInputTokenWeight, 1);
  assert.equal(parsed.availableModelCatalogByProvider.openai.models[0]?.outputTokenWeight, 16);
  assert.equal(parsed.availableModelCatalogByProvider.openai.models[1]?.inputTokenWeight, 2);
  assert.equal(
    parsed.availableModelCatalogByProvider.openai.models[1]?.cachedInputTokenWeight,
    0.4
  );
  assert.equal(parsed.availableModelCatalogByProvider.openai.models[1]?.outputTokenWeight, 4);
  assert.equal(parsed.providerKeys.openai, "sk-openai-new");

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5.4",
                capabilities: ["chat"],
                ...tokenMeteredDefaults(),
                inputTokenWeight: -1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null
              }
            ]
          },
          anthropic: { models: [] }
        }
      }),
    /inputTokenWeight must be between 0/
  );

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-image-1",
                capabilities: ["image"],
                ...fixedOperationDefaults(),
                providerPriceMetadata: {
                  currency: "USD",
                  fixedOperationPricing: {
                    unitLabel: "render",
                    pricePerOperation: 0.04
                  },
                  tokenPricing: {
                    inputPer1M: 1,
                    cachedInputPer1M: 1,
                    outputPer1M: 1
                  }
                },
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null
              }
            ]
          },
          anthropic: { models: [] }
        }
      }),
    /providerPriceMetadata\.tokenPricing is not allowed when billingMode is fixed_operation/
  );

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-4o-mini-tts",
                capabilities: ["text_to_speech"],
                ...textCharsMeteredDefaults(),
                providerPriceMetadata: {
                  currency: "USD",
                  textCharsPricing: {
                    pricePer1MChars: 18
                  },
                  tokenPricing: {
                    inputPer1M: 1,
                    cachedInputPer1M: 1,
                    outputPer1M: 1
                  }
                },
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null
              }
            ]
          },
          anthropic: { models: [] }
        }
      }),
    /providerPriceMetadata\.tokenPricing is not allowed when billingMode is text_chars_metered/
  );

  assert.throws(
    () =>
      assertRequiredProviderKeysAvailable({
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallback: null,
        providerKeys: createEmptyPlatformRuntimeProviderKeyMetadata(),
        incomingProviderKeys: {}
      }),
    /OpenAI API key is required/
  );

  const providerKeys = createEmptyPlatformRuntimeProviderKeyMetadata();
  providerKeys.openai = {
    configured: true,
    lastFour: "1234",
    updatedAt: "2026-03-25T10:00:00.000Z"
  };
  providerKeys.anthropic = {
    configured: true,
    lastFour: "5678",
    updatedAt: "2026-03-25T10:05:00.000Z"
  };

  const settings = buildPlatformRuntimeProviderSettingsState({
    settings: {
      primaryProvider: "openai",
      primaryModel: "gpt‑5.4",
      fallbackProvider: "anthropic",
      fallbackModel: "claude-sonnet-4-5",
      routingFastModelKey: "gpt‑5.4-mini",
      routerPolicy: {
        enabled: true,
        mode: "active",
        classifierFailureFallbackMode: "premium",
        clarifyOnMissingContext: false,
        analyzeUploadsOnB2cUpload: true,
        precheckRuleOverrides: null,
        skillRoutingPolicy: {
          initialCheckUserMessageIndex: 2,
          backgroundRecheckIntervalMessages: 7
        }
      },
      availableModelsByProvider: {
        openai: ["gpt‑5.4", "gpt‑5.4-mini"],
        anthropic: ["claude-sonnet-4-5"]
      },
      availableModelCatalogByProvider: {
        openai: {
          models: [
            {
              model: "gpt‑5.4",
              capabilities: ["chat"],
              ...tokenMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 0.25,
              outputTokenWeight: 4,
              displayLabel: null,
              notes: null
            },
            {
              model: "gpt‑5.4-mini",
              capabilities: ["chat"],
              ...tokenMeteredDefaults(),
              inputTokenWeight: 0.5,
              cachedInputTokenWeight: 0.1,
              outputTokenWeight: 2,
              displayLabel: null,
              notes: null
            },
            {
              model: "gpt-image-1.5",
              capabilities: ["image"],
              ...tokenMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: null,
              notes: null
            },
            {
              model: "sora-2-pro",
              capabilities: ["video"],
              ...timeMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: null,
              notes: null
            },
            {
              model: "gpt-4o-mini-tts",
              capabilities: ["text_to_speech"],
              ...textCharsMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: null,
              notes: null
            }
          ]
        },
        anthropic: {
          models: [
            {
              model: "claude-sonnet-4-5",
              capabilities: ["chat"],
              ...tokenMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: null,
              notes: null
            }
          ]
        }
      }
    },
    providerKeys
  });
  assert.equal(settings.mode, "global_settings");
  assert.equal(settings.primary?.model, "gpt-5.4");
  assert.equal(settings.routingFastModelKey, "gpt-5.4-mini");
  assert.equal(settings.routerPolicy.mode, "active");
  assert.equal(settings.routerPolicy.classifierFailureFallbackMode, "premium");
  assert.equal(settings.routerPolicy.analyzeUploadsOnB2cUpload, true);
  assert.equal(settings.skillRoutingPolicy.initialCheckUserMessageIndex, 2);
  assert.equal(settings.skillRoutingPolicy.backgroundRecheckIntervalMessages, 7);
  assert.deepEqual(settings.availableModelsByProvider.anthropic, ["claude-sonnet-4-5"]);
  assert.deepEqual(settings.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);
  assert.deepEqual(
    settings.availableModelCatalogByProvider.openai.models
      .filter((profile) => profile.capabilities.includes("image"))
      .map((profile) => profile.model),
    ["gpt-image-1.5"]
  );
  assert.deepEqual(
    settings.availableModelCatalogByProvider.openai.models
      .filter((profile) => profile.capabilities.includes("video"))
      .map((profile) => profile.model),
    ["sora-2-pro"]
  );
  const settingsTtsProfile = settings.availableModelCatalogByProvider.openai.models.find(
    (profile) => profile.model === "gpt-4o-mini-tts"
  );
  assert.equal(settingsTtsProfile?.billingMode, "text_chars_metered");
  assert.deepEqual(settingsTtsProfile?.providerPriceMetadata, {
    currency: "USD",
    textCharsPricing: {
      pricePer1MChars: 18
    }
  });
  assert.deepEqual(settings.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);

  const profile = buildPlatformRuntimeProviderProfileState(settings);
  assert.equal(profile.mode, "admin_managed");
  assert.deepEqual(profile.availableModelsByProvider, {
    openai: ["gpt-5.4", "gpt-5.4-mini"],
    anthropic: ["claude-sonnet-4-5"]
  });
  assert.deepEqual(
    profile.availableModelCatalogByProvider.openai.models
      .filter((modelProfile) => modelProfile.capabilities.includes("image"))
      .map((modelProfile) => modelProfile.model),
    ["gpt-image-1.5"]
  );
  const profileTtsModel = profile.availableModelCatalogByProvider.openai.models.find(
    (modelProfile) => modelProfile.model === "gpt-4o-mini-tts"
  );
  assert.equal(profileTtsModel?.billingMode, "text_chars_metered");
  assert.equal(profile.primary.provider, "openai");
  assert.equal(profile.primary.credentialRef.secretRef.source, "persai");
  assert.equal(profile.primary.credentialRef.secretRef.provider, "persai-runtime");
  assert.equal(profile.primary.credentialRef.secretRef.id, "openai/api-key");
  assert.equal(profile.fallback?.credentialRef.secretRef.id, "anthropic/api-key");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
