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
  assert.deepEqual(Object.keys(parsed.availableModelCatalogByProvider).sort(), [
    "anthropic",
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
    anthropic: ["claude-sonnet-4-5"]
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
      heygenPersonaCreationVcoin: null
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
      heygenPersonaCreationVcoin: null
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
      heygenPersonaCreationVcoin: 0
    },
    providerKeys
  });
  assert.equal(settingsWithPersonaKnobs.heygenPersonaWorkspaceLimit, 5);
  assert.equal(settingsWithPersonaKnobs.heygenPersonaCreationVcoin, 0);

  // Parser default: when admin payload omits the field, normalize to 20.
  assert.equal(parsed.vcoinExchangeRate, 20);
  // ADR-109 Slice 5 — parser defaults for new persona knobs.
  assert.equal(parsed.heygenPersonaWorkspaceLimit, 10);
  assert.equal(parsed.heygenPersonaCreationVcoin, 20);

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
    heygenPersonaCreationVcoin: 0
  });
  assert.equal(parsedWithPersonaKnobs.heygenPersonaWorkspaceLimit, 15);
  assert.equal(parsedWithPersonaKnobs.heygenPersonaCreationVcoin, 0);

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

  const profile = buildPlatformRuntimeProviderProfileState(settings);
  assert.equal(profile.mode, "admin_managed");
  assert.deepEqual(profile.availableModelsByProvider, {
    openai: ["gpt-5.4", "gpt-5.4-mini"],
    anthropic: ["claude-sonnet-4-5"]
  });
  assert.deepEqual(profile.allowedProviders, ["openai", "anthropic"]);
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
