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
        cacheCreationInputPer1M: 0,
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

function runwayVideoModelParameters() {
  return {
    duration: {
      kind: "allowed_list" as const,
      values: [5, 8, 10]
    },
    aspectRatios: [
      { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280:720" },
      { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720:1280" }
    ],
    referenceImageSupported: true,
    audioCapabilities: ["silent"] as const,
    inputCapabilities: ["text", "single_reference_image"] as const,
    providerParameters: null
  };
}

function klingVideoModelParameters() {
  return {
    duration: {
      kind: "range" as const,
      min: 3,
      max: 15,
      step: null,
      preferredValues: [4, 8, 12]
    },
    aspectRatios: [
      { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "16:9" },
      { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "9:16" }
    ],
    referenceImageSupported: true,
    audioCapabilities: ["silent", "provider_native_audio", "voice_control"] as const,
    inputCapabilities: ["text", "single_reference_image", "multi_image"] as const,
    providerParameters: {
      mode: "pro",
      sound: "off" as const
    }
  };
}

function openAiVideoModelParameters() {
  return {
    duration: {
      kind: "allowed_list" as const,
      values: [4, 8, 12]
    },
    aspectRatios: [
      { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280x720" },
      { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720x1280" }
    ],
    referenceImageSupported: true,
    audioCapabilities: ["silent"] as const,
    inputCapabilities: ["text", "single_reference_image"] as const,
    providerParameters: null
  };
}

function heygenVideoModelParameters() {
  return {
    duration: {
      kind: "range" as const,
      min: 1,
      max: 600,
      step: 1,
      preferredValues: [15, 30, 60]
    },
    aspectRatios: [
      { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "16:9" },
      { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "9:16" }
    ],
    referenceImageSupported: true,
    audioCapabilities: ["silent"] as const,
    inputCapabilities: ["text", "single_reference_image"] as const,
    providerParameters: {
      resolution: "720p" as const,
      aspectRatio: "9:16" as const,
      engine: "avatar_v" as const
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
      anthropic: ["claude-sonnet-4-5"],
      deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
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
                cacheCreationInputPer1M: 0,
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
                cacheCreationInputPer1M: 0,
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
            notes: null,
            videoModelParameters: openAiVideoModelParameters()
          },
          {
            model: "sora-2-pro",
            capabilities: ["video"],
            ...timeMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            videoModelParameters: openAiVideoModelParameters()
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
      },
      deepseek: {
        models: [
          {
            model: "deepseek-v4-flash",
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0.14,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0.0028,
                outputPer1M: 0.28
              }
            },
            inputTokenWeight: 0.112,
            cachedInputTokenWeight: 0.00224,
            outputTokenWeight: 0.224,
            displayLabel: "DeepSeek V4 Flash",
            notes: null
          },
          {
            model: "deepseek-v4-pro",
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 0.435,
                cacheCreationInputPer1M: 0,
                cachedInputPer1M: 0.003625,
                outputPer1M: 0.87
              }
            },
            inputTokenWeight: 0.348,
            cachedInputTokenWeight: 0.0029,
            outputTokenWeight: 0.696,
            displayLabel: "DeepSeek V4 Pro",
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
    providerKeys: {
      openai: " sk-openai-new ",
      anthropic: "sk-anthropic-new",
      deepseek: "sk-deepseek-new"
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
  assert.deepEqual(parsed.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);
  assert.deepEqual(parsed.availableModelsByProvider.anthropic, ["claude-sonnet-4-5"]);
  assert.deepEqual(parsed.availableModelsByProvider.deepseek, [
    "deepseek-v4-flash",
    "deepseek-v4-pro"
  ]);
  assert.deepEqual(Object.keys(parsed.availableModelCatalogByProvider).sort(), [
    "anthropic",
    "deepseek",
    "heygen",
    "kling",
    "openai",
    "runway"
  ]);
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
  const legacyTokenPricing = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: { provider: "openai", model: "gpt-5.4" },
    fallback: { provider: "anthropic", model: "claude-sonnet-4-5" },
    availableModelsByProvider: { openai: ["gpt-5.4"], anthropic: ["claude-sonnet-4-5"] },
    availableModelCatalogByProvider: {
      openai: {
        models: [
          {
            model: "gpt-5.4",
            capabilities: ["chat"],
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 0.25,
            outputTokenWeight: 4,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: {
                inputPer1M: 4,
                cachedInputPer1M: 1,
                outputPer1M: 16
              }
            }
          }
        ]
      },
      anthropic: { models: [] }
    }
  });
  assert.equal(
    legacyTokenPricing.availableModelCatalogByProvider.openai?.models[0]?.providerPriceMetadata
      .tokenPricing.cacheCreationInputPer1M,
    0
  );
  const parsedWithHeyGen = parseUpdatePlatformRuntimeProviderSettingsInput({
    ...parsed,
    availableModelCatalogByProvider: {
      ...parsed.availableModelCatalogByProvider,
      heygen: {
        models: [
          {
            model: "avatar_v",
            capabilities: ["video"],
            ...timeMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: "Avatar V 720p",
            notes: null,
            videoModelParameters: heygenVideoModelParameters()
          }
        ]
      }
    }
  });
  const heygenProfile = parsedWithHeyGen.availableModelCatalogByProvider.heygen.models[0];
  assert.equal(heygenProfile?.kind, "talking_avatar");
  assert.deepEqual(heygenProfile?.videoModelParameters?.providerParameters, {
    resolution: "720p",
    aspectRatio: "9:16",
    engine: "avatar_v"
  });
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
  assert.deepEqual(parsed.availableModelCatalogByProvider.runway.models, []);
  assert.deepEqual(parsed.availableModelCatalogByProvider.kling.models, []);
  assert.equal(parsed.providerKeys.openai, "sk-openai-new");
  assert.equal(parsed.providerKeys.deepseek, "sk-deepseek-new");

  const parsedWithVideoCatalogProviders = parseUpdatePlatformRuntimeProviderSettingsInput({
    ...parsed,
    availableModelCatalogByProvider: {
      ...parsed.availableModelCatalogByProvider,
      runway: {
        models: [
          {
            model: "runway-gen-4",
            capabilities: ["video"],
            ...timeMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: "Runway Gen 4",
            notes: null,
            videoModelParameters: runwayVideoModelParameters()
          }
        ]
      },
      kling: {
        models: [
          {
            model: "kling-v1",
            capabilities: ["video"],
            ...timeMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: "Kling v3",
            notes: null,
            videoModelParameters: klingVideoModelParameters()
          }
        ]
      }
    }
  });
  assert.deepEqual(parsedWithVideoCatalogProviders.availableModelsByProvider, {
    openai: ["gpt-5.4", "gpt-5.4-mini"],
    anthropic: ["claude-sonnet-4-5"],
    deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
  });
  assert.deepEqual(
    parsedWithVideoCatalogProviders.availableModelCatalogByProvider.runway.models.map(
      (profile) => profile.model
    ),
    ["runway-gen-4"]
  );
  assert.deepEqual(
    parsedWithVideoCatalogProviders.availableModelCatalogByProvider.kling.models.map(
      (profile) => profile.model
    ),
    ["kling-v1"]
  );
  assert.deepEqual(
    parsedWithVideoCatalogProviders.availableModelCatalogByProvider.runway.models[0]
      ?.videoModelParameters,
    runwayVideoModelParameters()
  );
  assert.deepEqual(
    parsed.availableModelCatalogByProvider.openai.models
      .filter((profile) => profile.capabilities.includes("video"))
      .map((profile) => profile.videoModelParameters?.audioCapabilities),
    [["silent"], ["silent"]]
  );
  assert.deepEqual(
    parsed.availableModelCatalogByProvider.openai.models
      .filter((profile) => profile.capabilities.includes("video"))
      .map((profile) => profile.videoModelParameters?.inputCapabilities),
    [
      ["text", "single_reference_image"],
      ["text", "single_reference_image"]
    ]
  );

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
                    cacheCreationInputPer1M: 1,
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
          ...parsed.availableModelCatalogByProvider,
          kling: {
            models: [
              {
                model: "kling-v2-6",
                capabilities: ["video"],
                ...timeMeteredDefaults(),
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: "Kling Voice",
                notes: null,
                videoModelParameters: {
                  ...klingVideoModelParameters(),
                  audioCapabilities: ["silent", "voice_control"]
                }
              }
            ]
          }
        }
      }),
    /audioCapabilities cannot include "voice_control" without "provider_native_audio"/
  );

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          ...parsed.availableModelCatalogByProvider,
          runway: {
            models: [
              {
                model: "runway-gen-4",
                capabilities: ["video"],
                ...timeMeteredDefaults(),
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: "Runway",
                notes: null,
                videoModelParameters: {
                  ...runwayVideoModelParameters(),
                  referenceImageSupported: false,
                  inputCapabilities: ["text", "multi_image"]
                }
              }
            ]
          }
        }
      }),
    /inputCapabilities cannot include "multi_image" when referenceImageSupported is false/
  );

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          ...parsed.availableModelCatalogByProvider,
          kling: {
            models: [
              {
                model: "kling-v3",
                capabilities: ["video"],
                ...timeMeteredDefaults(),
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: "Kling",
                notes: null,
                videoModelParameters: {
                  ...klingVideoModelParameters(),
                  inputCapabilities: ["text", "single_reference_image", "omni"]
                }
              }
            ]
          }
        }
      }),
    /inputCapabilities cannot include "omni" because Omni is deferred/
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
                    cacheCreationInputPer1M: 1,
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
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          ...parsed.availableModelCatalogByProvider,
          runway: {
            models: [
              {
                model: "runway-gen-4",
                capabilities: ["chat", "video"],
                ...timeMeteredDefaults(),
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null
              }
            ]
          },
          kling: { models: [] }
        }
      }),
    /capabilities must contain only "video" for runway catalog rows/
  );

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          ...parsed.availableModelCatalogByProvider,
          runway: {
            chat: ["runway-chat"],
            video: ["runway-gen-4"]
          },
          kling: { models: [] }
        }
      }),
    /runway legacy catalog rows must not include chat or image models/
  );

  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        availableModelCatalogByProvider: {
          ...parsed.availableModelCatalogByProvider,
          openai: {
            models: [
              ...parsed.availableModelCatalogByProvider.openai.models,
              {
                model: "shared-video",
                capabilities: ["video"],
                ...timeMeteredDefaults(),
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                videoModelParameters: runwayVideoModelParameters()
              }
            ]
          },
          runway: {
            models: [
              {
                model: "shared-video",
                capabilities: ["video"],
                ...timeMeteredDefaults(),
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                videoModelParameters: runwayVideoModelParameters()
              }
            ]
          },
          kling: { models: [] }
        }
      }),
    /duplicate active video model id "shared-video" across providers/
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
        precheckRuleOverrides: null
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
              notes: null,
              videoModelParameters: openAiVideoModelParameters()
            },
            {
              model: "sora-2-pro",
              capabilities: ["video"],
              ...timeMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: null,
              notes: null,
              videoModelParameters: openAiVideoModelParameters()
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
      },
      vcoinExchangeRate: null,
      heygenPersonaWorkspaceLimit: null,
      heygenPersonaCreationVcoin: null,
      heygenVoiceCloneWorkspaceLimit: null,
      heygenVoiceCloneCreationVcoin: null
    },
    providerKeys
  });
  assert.equal(settings.mode, "global_settings");
  assert.equal(settings.primary?.model, "gpt-5.4");
  assert.equal(settings.routingFastModelKey, "gpt-5.4-mini");
  assert.equal(settings.routerPolicy.mode, "active");
  assert.equal(settings.routerPolicy.classifierFailureFallbackMode, "premium");
  assert.equal(settings.routerPolicy.analyzeUploadsOnB2cUpload, true);
  assert.deepEqual(settings.availableModelsByProvider.anthropic, ["claude-sonnet-4-5"]);
  assert.deepEqual(settings.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);
  assert.deepEqual(settings.availableModelCatalogByProvider.runway.models, []);
  assert.deepEqual(settings.availableModelCatalogByProvider.kling.models, []);
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
  // ADR-108 Slice 1 — record with no persisted `vcoinExchangeRate` (legacy
  // row, or a pre-Slice-1 admin save) must surface the platform default 20
  // on read. The reader is the single source of truth here.
  assert.equal(settings.vcoinExchangeRate, 20);
  // ADR-109 Slice 5 — new platform knobs surface defaults when omitted.
  assert.equal(settings.heygenPersonaWorkspaceLimit, 10);
  assert.equal(settings.heygenPersonaCreationVcoin, 20);
  // ADR-111 Slice 3 — new cloned voice knobs surface defaults when omitted.
  assert.equal(settings.heygenVoiceCloneWorkspaceLimit, 5);
  assert.equal(settings.heygenVoiceCloneCreationVcoin, 50);

  const settingsWithExplicitRate = buildPlatformRuntimeProviderSettingsState({
    settings: {
      primaryProvider: "openai",
      primaryModel: "gpt-5.4",
      fallbackProvider: null,
      fallbackModel: null,
      routingFastModelKey: null,
      routerPolicy: null,
      availableModelsByProvider: null,
      availableModelCatalogByProvider: null,
      vcoinExchangeRate: 25,
      heygenPersonaWorkspaceLimit: null,
      heygenPersonaCreationVcoin: null,
      heygenVoiceCloneWorkspaceLimit: null,
      heygenVoiceCloneCreationVcoin: null
    },
    providerKeys
  });
  // ADR-108 Slice 1 — explicit persisted value round-trips unchanged.
  assert.equal(settingsWithExplicitRate.vcoinExchangeRate, 25);

  const settingsWithInvalidRate = buildPlatformRuntimeProviderSettingsState({
    settings: {
      primaryProvider: "openai",
      primaryModel: "gpt-5.4",
      fallbackProvider: null,
      fallbackModel: null,
      routingFastModelKey: null,
      routerPolicy: null,
      availableModelsByProvider: null,
      availableModelCatalogByProvider: null,
      // Defensively coerce negative / zero / fractional persisted values to
      // the platform default rather than propagating poison. Slice 5's
      // admin save path rejects bad input up front, but a hand-edited DB
      // row should not break the resolver.
      vcoinExchangeRate: -7 as unknown as number,
      heygenPersonaWorkspaceLimit: null,
      heygenPersonaCreationVcoin: null,
      heygenVoiceCloneWorkspaceLimit: null,
      heygenVoiceCloneCreationVcoin: null
    },
    providerKeys
  });
  assert.equal(settingsWithInvalidRate.vcoinExchangeRate, 20);

  // ADR-109 Slice 5 — explicit persisted persona knob values round-trip unchanged.
  const settingsWithPersonaKnobs = buildPlatformRuntimeProviderSettingsState({
    settings: {
      primaryProvider: "openai",
      primaryModel: "gpt-5.4",
      fallbackProvider: null,
      fallbackModel: null,
      routingFastModelKey: null,
      routerPolicy: null,
      availableModelsByProvider: null,
      availableModelCatalogByProvider: null,
      vcoinExchangeRate: null,
      heygenPersonaWorkspaceLimit: 5,
      heygenPersonaCreationVcoin: 0,
      heygenVoiceCloneWorkspaceLimit: 3,
      heygenVoiceCloneCreationVcoin: 75
    },
    providerKeys
  });
  assert.equal(settingsWithPersonaKnobs.heygenPersonaWorkspaceLimit, 5);
  assert.equal(settingsWithPersonaKnobs.heygenPersonaCreationVcoin, 0);
  assert.equal(settingsWithPersonaKnobs.heygenVoiceCloneWorkspaceLimit, 3);
  assert.equal(settingsWithPersonaKnobs.heygenVoiceCloneCreationVcoin, 75);

  // Parser default: when admin payload omits the field, normalize to 20.
  assert.equal(parsed.vcoinExchangeRate, 20);
  // ADR-109 Slice 5 — parser defaults for new persona knobs.
  assert.equal(parsed.heygenPersonaWorkspaceLimit, 10);
  assert.equal(parsed.heygenPersonaCreationVcoin, 20);
  // ADR-111 Slice 3 — parser defaults for cloned voice knobs.
  assert.equal(parsed.heygenVoiceCloneWorkspaceLimit, 5);
  assert.equal(parsed.heygenVoiceCloneCreationVcoin, 50);

  const parsedWithExplicitRate = parseUpdatePlatformRuntimeProviderSettingsInput({
    ...parsed,
    vcoinExchangeRate: 30
  });
  assert.equal(parsedWithExplicitRate.vcoinExchangeRate, 30);

  // Parser must reject obviously invalid rates so a bad admin save cannot
  // poison the persisted JSON.
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        vcoinExchangeRate: 0
      }),
    /vcoinExchangeRate must be a positive integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        vcoinExchangeRate: 1.5
      }),
    /vcoinExchangeRate must be a positive integer/
  );

  // ADR-109 Slice 5 — explicit round-trips for persona knobs.
  const parsedWithPersonaKnobs = parseUpdatePlatformRuntimeProviderSettingsInput({
    ...parsed,
    heygenPersonaWorkspaceLimit: 15,
    heygenPersonaCreationVcoin: 0,
    heygenVoiceCloneWorkspaceLimit: 10,
    heygenVoiceCloneCreationVcoin: 0
  });
  assert.equal(parsedWithPersonaKnobs.heygenPersonaWorkspaceLimit, 15);
  assert.equal(parsedWithPersonaKnobs.heygenPersonaCreationVcoin, 0);
  assert.equal(parsedWithPersonaKnobs.heygenVoiceCloneWorkspaceLimit, 10);
  assert.equal(parsedWithPersonaKnobs.heygenVoiceCloneCreationVcoin, 0);

  // Reject zero/negative/fractional for persona workspace limit (must be ≥ 1).
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenPersonaWorkspaceLimit: 0
      }),
    /heygenPersonaWorkspaceLimit must be a positive integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenPersonaWorkspaceLimit: -1
      }),
    /heygenPersonaWorkspaceLimit must be a positive integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenPersonaWorkspaceLimit: 1.5
      }),
    /heygenPersonaWorkspaceLimit must be a positive integer/
  );
  // Reject negative for persona creation cost (must be ≥ 0, 0 is allowed).
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenPersonaCreationVcoin: -1
      }),
    /heygenPersonaCreationVcoin must be a non-negative integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenPersonaCreationVcoin: 1.5
      }),
    /heygenPersonaCreationVcoin must be a non-negative integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenVoiceCloneWorkspaceLimit: 0
      }),
    /heygenVoiceCloneWorkspaceLimit must be a positive integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenVoiceCloneWorkspaceLimit: 11
      }),
    /heygenVoiceCloneWorkspaceLimit must be at most 10/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenVoiceCloneWorkspaceLimit: 1.5
      }),
    /heygenVoiceCloneWorkspaceLimit must be a positive integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenVoiceCloneCreationVcoin: -1
      }),
    /heygenVoiceCloneCreationVcoin must be a non-negative integer/
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput({
        ...parsed,
        heygenVoiceCloneCreationVcoin: 1.5
      }),
    /heygenVoiceCloneCreationVcoin must be a non-negative integer/
  );

  const profile = buildPlatformRuntimeProviderProfileState(settings);
  assert.equal(profile.mode, "admin_managed");
  assert.deepEqual(profile.availableModelsByProvider, {
    openai: ["gpt-5.4", "gpt-5.4-mini"],
    anthropic: ["claude-sonnet-4-5"],
    deepseek: []
  });
  assert.deepEqual(profile.allowedProviders, ["openai", "anthropic", "deepseek"]);
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

  // ADR-122 D1 — maxOutputTokens / contextWindow normalization
  runAdr122NormalizationTests();
  runAdr122SeedingTests();
}

function minimalCatalogInput(modelOverrides: Record<string, unknown> = {}) {
  return {
    primary: { provider: "openai", model: "gpt-5.4" },
    fallback: null,
    availableModelsByProvider: { openai: ["gpt-5.4"], anthropic: [] },
    availableModelCatalogByProvider: {
      openai: {
        models: [
          {
            model: "gpt-5.4",
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            ...modelOverrides
          }
        ]
      }
    }
  };
}

function runAdr122NormalizationTests() {
  // null is allowed for both fields (round-trips as null)
  const withNulls = parseUpdatePlatformRuntimeProviderSettingsInput(
    minimalCatalogInput({ maxOutputTokens: null, contextWindow: null, promptCacheRetention: null })
  );
  const withNullsModel = withNulls.availableModelCatalogByProvider.openai.models[0];
  assert.equal(withNullsModel?.maxOutputTokens, null, "maxOutputTokens=null round-trips as null");
  assert.equal(withNullsModel?.contextWindow, null, "contextWindow=null round-trips as null");
  assert.equal(
    withNullsModel?.promptCacheRetention,
    null,
    "promptCacheRetention=null round-trips as null"
  );

  // undefined (absent) is treated as null
  const withAbsent = parseUpdatePlatformRuntimeProviderSettingsInput(minimalCatalogInput());
  const withAbsentModel = withAbsent.availableModelCatalogByProvider.openai.models[0];
  assert.equal(withAbsentModel?.maxOutputTokens, null, "absent maxOutputTokens defaults to null");
  assert.equal(withAbsentModel?.contextWindow, null, "absent contextWindow defaults to null");
  assert.equal(
    withAbsentModel?.promptCacheRetention,
    null,
    "absent promptCacheRetention defaults to null"
  );

  // Valid positive integers are accepted
  const withValid = parseUpdatePlatformRuntimeProviderSettingsInput(
    minimalCatalogInput({
      maxOutputTokens: 64000,
      contextWindow: 200000,
      promptCacheRetention: "24h"
    })
  );
  const withValidModel = withValid.availableModelCatalogByProvider.openai.models[0];
  assert.equal(withValidModel?.maxOutputTokens, 64000, "positive integer maxOutputTokens accepted");
  assert.equal(withValidModel?.contextWindow, 200000, "positive integer contextWindow accepted");
  assert.equal(withValidModel?.promptCacheRetention, "24h", "valid promptCacheRetention accepted");

  // 0 is rejected
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(minimalCatalogInput({ maxOutputTokens: 0 })),
    /maxOutputTokens must be a positive integer/,
    "0 rejected for maxOutputTokens"
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(minimalCatalogInput({ contextWindow: 0 })),
    /contextWindow must be a positive integer/,
    "0 rejected for contextWindow"
  );

  // Negative is rejected
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(minimalCatalogInput({ maxOutputTokens: -1 })),
    /maxOutputTokens must be a positive integer/,
    "negative rejected for maxOutputTokens"
  );

  // Non-integer is rejected
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(
        minimalCatalogInput({ maxOutputTokens: 1.5 })
      ),
    /maxOutputTokens must be a positive integer/,
    "non-integer rejected for maxOutputTokens"
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(minimalCatalogInput({ contextWindow: 1.5 })),
    /contextWindow must be a positive integer/,
    "non-integer rejected for contextWindow"
  );

  // Over max is rejected
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(
        minimalCatalogInput({ maxOutputTokens: 1_000_001 })
      ),
    /maxOutputTokens must be at most/,
    "over-max rejected for maxOutputTokens"
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(
        minimalCatalogInput({ contextWindow: 2_000_001 })
      ),
    /contextWindow must be at most/,
    "over-max rejected for contextWindow"
  );
  assert.throws(
    () =>
      parseUpdatePlatformRuntimeProviderSettingsInput(
        minimalCatalogInput({ promptCacheRetention: "forever" })
      ),
    /promptCacheRetention must be one of: in_memory, 24h/,
    "invalid promptCacheRetention rejected"
  );
}

function runAdr122SeedingTests() {
  // Synthesis from legacy availableModelsByProvider (createDefaultModelProfiles path)
  // seeds known Anthropic models with MODEL_CAPABILITY_DEFAULTS
  const fromLegacy = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: { provider: "anthropic", model: "claude-sonnet-4-6" },
    fallback: null,
    availableModelsByProvider: { openai: [], anthropic: ["claude-sonnet-4-6"] },
    availableModelCatalogByProvider: null
  });
  const seededModel = fromLegacy.availableModelCatalogByProvider.anthropic.models.find(
    (m) => m.model === "claude-sonnet-4-6"
  );
  assert.equal(seededModel?.maxOutputTokens, 64_000, "claude-sonnet-4-6 seeded maxOutputTokens");
  assert.equal(seededModel?.contextWindow, 200_000, "claude-sonnet-4-6 seeded contextWindow");
  assert.equal(seededModel?.promptCacheRetention, "in_memory");

  // claude-opus-4-6 has higher maxOutputTokens
  const fromLegacyOpus = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: { provider: "anthropic", model: "claude-opus-4-6" },
    fallback: null,
    availableModelsByProvider: { openai: [], anthropic: ["claude-opus-4-6"] },
    availableModelCatalogByProvider: null
  });
  const opusModel = fromLegacyOpus.availableModelCatalogByProvider.anthropic.models.find(
    (m) => m.model === "claude-opus-4-6"
  );
  assert.equal(opusModel?.maxOutputTokens, 128_000, "claude-opus-4-6 seeded maxOutputTokens=128k");
  assert.equal(opusModel?.contextWindow, 200_000, "claude-opus-4-6 seeded contextWindow=200k");
  assert.equal(opusModel?.promptCacheRetention, "in_memory");

  const fromLegacyGpt55 = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: { provider: "openai", model: "gpt-5.5" },
    fallback: null,
    availableModelsByProvider: { openai: ["gpt-5.5"], anthropic: [] },
    availableModelCatalogByProvider: null
  });
  const gpt55Seeded = fromLegacyGpt55.availableModelCatalogByProvider.openai.models.find(
    (m) => m.model === "gpt-5.5"
  );
  assert.equal(gpt55Seeded?.promptCacheRetention, "24h", "gpt-5.5 seeded promptCacheRetention=24h");

  // Unknown model seeds null (no defaults applied)
  const fromLegacyUnknown = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: { provider: "openai", model: "gpt-unknown" },
    fallback: null,
    availableModelsByProvider: { openai: ["gpt-unknown"], anthropic: [] },
    availableModelCatalogByProvider: null
  });
  const unknownModel = fromLegacyUnknown.availableModelCatalogByProvider.openai.models.find(
    (m) => m.model === "gpt-unknown"
  );
  assert.equal(unknownModel?.maxOutputTokens, null, "unknown model seeds null maxOutputTokens");
  assert.equal(unknownModel?.contextWindow, null, "unknown model seeds null contextWindow");
  assert.equal(
    unknownModel?.promptCacheRetention,
    null,
    "unknown model seeds null promptCacheRetention"
  );

  // Null on an UNKNOWN model row round-trips as null (gpt-5.4 is not in defaults).
  const withExplicitNullCatalog = parseUpdatePlatformRuntimeProviderSettingsInput(
    minimalCatalogInput({ maxOutputTokens: null, contextWindow: null, promptCacheRetention: null })
  );
  const explicitNullModel =
    withExplicitNullCatalog.availableModelCatalogByProvider.openai.models[0];
  assert.equal(explicitNullModel?.maxOutputTokens, null, "unknown-model null round-trips as null");
  assert.equal(
    explicitNullModel?.contextWindow,
    null,
    "unknown-model null contextWindow round-trips as null"
  );
  assert.equal(
    explicitNullModel?.promptCacheRetention,
    null,
    "unknown-model null promptCacheRetention round-trips as null"
  );

  runAdr122WriteFoldInTests();
}

// ADR-122 corrective — WRITE-path family-default fold-in (normalizeModelProfiles).
function knownModelCatalogInput(
  provider: "openai" | "anthropic",
  model: string,
  modelOverrides: Record<string, unknown> = {}
) {
  return {
    primary: { provider, model },
    fallback: null,
    availableModelsByProvider:
      provider === "openai"
        ? { openai: [model], anthropic: [] }
        : { openai: [], anthropic: [model] },
    availableModelCatalogByProvider: {
      [provider]: {
        models: [
          {
            model,
            capabilities: ["chat"],
            ...tokenMeteredDefaults(),
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            ...modelOverrides
          }
        ]
      }
    }
  };
}

function runAdr122WriteFoldInTests() {
  // KNOWN model with null stored → folded to the family default (OpenAI gpt-5).
  const gpt5Null = parseUpdatePlatformRuntimeProviderSettingsInput(
    knownModelCatalogInput("openai", "gpt-5", {
      maxOutputTokens: null,
      contextWindow: null,
      promptCacheRetention: null
    })
  );
  const gpt5NullModel = gpt5Null.availableModelCatalogByProvider.openai.models.find(
    (m) => m.model === "gpt-5"
  );
  assert.equal(
    gpt5NullModel?.maxOutputTokens,
    128_000,
    "WRITE fold-in: known OpenAI model (gpt-5) null maxOutputTokens → family default 128k"
  );
  assert.equal(
    gpt5NullModel?.contextWindow,
    400_000,
    "WRITE fold-in: known OpenAI model (gpt-5) null contextWindow → family default 400k"
  );
  assert.equal(
    gpt5NullModel?.promptCacheRetention,
    "in_memory",
    "WRITE fold-in: known OpenAI model (gpt-5) null promptCacheRetention → family default in_memory"
  );

  // KNOWN model with explicit value → admin value overrides the family default.
  const gpt5Explicit = parseUpdatePlatformRuntimeProviderSettingsInput(
    knownModelCatalogInput("openai", "gpt-5", {
      maxOutputTokens: 32_000,
      contextWindow: 250_000,
      promptCacheRetention: "24h"
    })
  );
  const gpt5ExplicitModel = gpt5Explicit.availableModelCatalogByProvider.openai.models.find(
    (m) => m.model === "gpt-5"
  );
  assert.equal(
    gpt5ExplicitModel?.maxOutputTokens,
    32_000,
    "WRITE fold-in: explicit admin maxOutputTokens overrides the family default"
  );
  assert.equal(
    gpt5ExplicitModel?.contextWindow,
    250_000,
    "WRITE fold-in: explicit admin contextWindow overrides the family default"
  );
  assert.equal(
    gpt5ExplicitModel?.promptCacheRetention,
    "24h",
    "WRITE fold-in: explicit admin promptCacheRetention overrides the family default"
  );

  // KNOWN Anthropic model with null → folded to Anthropic default.
  const sonnetNull = parseUpdatePlatformRuntimeProviderSettingsInput(
    knownModelCatalogInput("anthropic", "claude-sonnet-4-5", {
      maxOutputTokens: null,
      contextWindow: null,
      promptCacheRetention: null
    })
  );
  const sonnetNullModel = sonnetNull.availableModelCatalogByProvider.anthropic.models.find(
    (m) => m.model === "claude-sonnet-4-5"
  );
  assert.equal(
    sonnetNullModel?.maxOutputTokens,
    64_000,
    "WRITE fold-in: known Anthropic model null maxOutputTokens → family default 64k"
  );
  assert.equal(
    sonnetNullModel?.contextWindow,
    200_000,
    "WRITE fold-in: known Anthropic model null contextWindow → family default 200k"
  );
  assert.equal(
    sonnetNullModel?.promptCacheRetention,
    "in_memory",
    "WRITE fold-in: known Anthropic model null promptCacheRetention → family default in_memory"
  );

  const gpt55Null = parseUpdatePlatformRuntimeProviderSettingsInput(
    knownModelCatalogInput("openai", "gpt-5.5", {
      maxOutputTokens: null,
      contextWindow: null,
      promptCacheRetention: null
    })
  );
  const gpt55NullModel = gpt55Null.availableModelCatalogByProvider.openai.models.find(
    (m) => m.model === "gpt-5.5"
  );
  assert.equal(
    gpt55NullModel?.promptCacheRetention,
    "24h",
    "WRITE fold-in: known OpenAI model gpt-5.5 null promptCacheRetention → family default 24h"
  );

  // UNKNOWN model with null → stays null (resolver fallback governs at runtime).
  const unknownNull = parseUpdatePlatformRuntimeProviderSettingsInput(
    knownModelCatalogInput("openai", "gpt-unknown-write", {
      maxOutputTokens: null,
      contextWindow: null,
      promptCacheRetention: null
    })
  );
  const unknownNullModel = unknownNull.availableModelCatalogByProvider.openai.models.find(
    (m) => m.model === "gpt-unknown-write"
  );
  assert.equal(
    unknownNullModel?.maxOutputTokens,
    null,
    "WRITE fold-in: unknown model null maxOutputTokens stays null"
  );
  assert.equal(
    unknownNullModel?.contextWindow,
    null,
    "WRITE fold-in: unknown model null contextWindow stays null"
  );
  assert.equal(
    unknownNullModel?.promptCacheRetention,
    null,
    "WRITE fold-in: unknown model null promptCacheRetention stays null"
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
