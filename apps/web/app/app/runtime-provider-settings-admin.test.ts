import { describe, expect, it } from "vitest";
import {
  buildRuntimeProviderSettingsRequest,
  resolveRuntimeProviderSettingsAdminFormState,
  validateRuntimeProviderSettingsAdminDraft
} from "./runtime-provider-settings-admin";

function tokenMeteredDefaults() {
  return {
    kind: "cinematic" as const,
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
      },
      timePricing: null,
      fixedOperationPricing: null,
      tieredOperationPricing: null
    }
  };
}

function fixedOperationDefaults() {
  return {
    kind: "cinematic" as const,
    active: true,
    billingMode: "fixed_operation" as const,
    effectiveFrom: null,
    effectiveTo: null,
    providerPriceMetadata: {
      currency: "USD",
      tokenPricing: null,
      timePricing: null,
      fixedOperationPricing: {
        unitLabel: null,
        pricePerOperation: 0
      },
      tieredOperationPricing: null
    }
  };
}

function timeMeteredDefaults() {
  return {
    kind: "cinematic" as const,
    active: true,
    billingMode: "time_metered" as const,
    effectiveFrom: null,
    effectiveTo: null,
    providerPriceMetadata: {
      currency: "USD",
      timePricing: {
        unit: "minute" as const,
        pricePerUnit: 0
      }
    }
  };
}

describe("runtime-provider-settings-admin", () => {
  it("hydrates global settings into the simplified admin form", () => {
    const state = resolveRuntimeProviderSettingsAdminFormState({
      schema: "persai.adminRuntimeProviderSettings.v2",
      mode: "global_settings",
      primary: {
        provider: "openai",
        model: "gpt-5.4"
      },
      fallback: {
        provider: "anthropic",
        model: "claude-sonnet-4-5"
      },
      routingFastModelKey: "gpt-4.1",
      routerPolicy: {
        enabled: true,
        mode: "shadow",
        classifierFailureFallbackMode: "normal",
        clarifyOnMissingContext: true,
        analyzeUploadsOnB2cUpload: false,
        precheckRuleOverrides: null
      },
      skillRoutingPolicy: {
        initialCheckUserMessageIndex: 3,
        backgroundRecheckIntervalMessages: 5
      },
      availableModelsByProvider: {
        openai: ["gpt-5.4", "gpt-4.1"],
        anthropic: ["claude-sonnet-4-5"]
      },
      availableModelCatalogByProvider: {
        openai: {
          models: [
            {
              model: "gpt-5.4",
              capabilities: ["chat"],
              ...tokenMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 0.25,
              outputTokenWeight: 4,
              displayLabel: "GPT 5.4",
              notes: null
            },
            {
              model: "gpt-4.1",
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
              ...fixedOperationDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: null,
              notes: null
            },
            {
              model: "sora-2",
              capabilities: ["video"],
              ...fixedOperationDefaults(),
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
        },
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
              notes: null
            }
          ]
        },
        kling: {
          models: [
            {
              model: "kling-v2",
              capabilities: ["video"],
              ...timeMeteredDefaults(),
              inputTokenWeight: 1,
              cachedInputTokenWeight: 1,
              outputTokenWeight: 1,
              displayLabel: "Kling V2",
              notes: null
            }
          ]
        },
        heygen: {
          models: []
        }
      },
      providerKeys: {
        openai: {
          configured: true,
          lastFour: "1234",
          updatedAt: "2026-03-25T10:00:00.000Z"
        },
        anthropic: {
          configured: false,
          lastFour: null,
          updatedAt: null
        }
      },
      notes: []
    });

    expect(state.mode).toBe("global_settings");
    expect(state.draft.primary).toEqual({
      provider: "openai",
      model: "gpt-5.4"
    });
    expect(state.draft.fallbackEnabled).toBe(true);
    expect(state.draft.modelProfilesTextByProvider.openai).toContain(
      "gpt-5.4 | chat | 1 | 0.25 | 4 | GPT 5.4"
    );
    expect(state.draft.modelProfilesTextByProvider.openai).toContain(
      "gpt-image-1.5 | image | 1 | 1 | 1 |"
    );
    expect(state.draft.modelProfilesTextByProvider.runway).toContain(
      "runway-gen-4 | video | 1 | 1 | 1 | Runway Gen 4"
    );
    expect(state.draft.modelProfilesTextByProvider.kling).toContain(
      "kling-v2 | video | 1 | 1 | 1 | Kling V2"
    );
    expect(state.providerKeyState.openai.lastFour).toBe("1234");
    expect(state.draft.providerKeys.openai).toBe("");
  });

  it("builds a request when selected models are already present in the available catalog", () => {
    const request = buildRuntimeProviderSettingsRequest({
      draft: {
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallbackEnabled: true,
        fallback: {
          provider: "anthropic",
          model: "claude-sonnet-4-5"
        },
        modelProfilesTextByProvider: {
          openai:
            "gpt-4.1 | chat | 0.5 | 0.1 | 2\n" +
            "gpt-5.4 | chat | 1 | 0.25 | 4\n" +
            "gpt-image-1.5 | image | 1 | 1 | 1\n" +
            "sora-2 | video | 1 | 1 | 1",
          anthropic: "claude-sonnet-4-5 | chat | 1 | 1 | 1",
          runway: "runway-gen-4 | video | 1 | 1 | 1 | Runway Gen 4",
          kling: "kling-v2 | video | 1 | 1 | 1 | Kling V2",
          heygen: ""
        },
        providerKeys: {
          openai: "",
          anthropic: "sk-ant-new"
        }
      },
      providerKeyState: {
        openai: {
          configured: true,
          lastFour: "1234",
          updatedAt: "2026-03-25T10:00:00.000Z"
        },
        anthropic: {
          configured: false,
          lastFour: null,
          updatedAt: null
        }
      }
    });

    expect(request.primary).toEqual({
      provider: "openai",
      model: "gpt-5.4"
    });
    expect(request.fallback).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5"
    });
    expect(request.availableModelsByProvider.openai).toEqual(["gpt-4.1", "gpt-5.4"]);
    expect(request.availableModelsByProvider.anthropic).toEqual(["claude-sonnet-4-5"]);
    expect(request.availableModelCatalogByProvider.runway.models).toMatchObject([
      {
        model: "runway-gen-4",
        capabilities: ["video"],
        billingMode: "time_metered"
      }
    ]);
    expect(request.availableModelCatalogByProvider.kling.models).toMatchObject([
      {
        model: "kling-v2",
        capabilities: ["video"],
        billingMode: "time_metered"
      }
    ]);
    expect(
      request.availableModelCatalogByProvider.openai.models
        .filter((profile) => profile.capabilities.includes("image"))
        .map((profile) => profile.model)
    ).toEqual(["gpt-image-1.5"]);
    expect(
      request.availableModelCatalogByProvider.openai.models
        .filter((profile) => profile.capabilities.includes("video"))
        .map((profile) => profile.model)
    ).toEqual(["sora-2"]);
    expect(request.availableModelCatalogByProvider.openai.models[1]?.outputTokenWeight).toBe(4);
    expect(request.providerKeys).toEqual({
      anthropic: "sk-ant-new"
    });
  });

  it("rejects a primary model that is not present in the available catalog", () => {
    expect(
      validateRuntimeProviderSettingsAdminDraft({
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallbackEnabled: false,
        fallback: {
          provider: "anthropic",
          model: ""
        },
        modelProfilesTextByProvider: {
          openai: "gpt-4.1 | chat | 1 | 1 | 1",
          anthropic: "",
          runway: "",
          kling: "",
          heygen: ""
        },
        providerKeys: {
          openai: "",
          anthropic: ""
        }
      })
    ).toBe("Primary model must be listed under OpenAI available models.");
  });

  it("requires a key when a selected provider has none configured", () => {
    expect(() =>
      buildRuntimeProviderSettingsRequest({
        draft: {
          primary: {
            provider: "openai",
            model: "gpt-5.4"
          },
          fallbackEnabled: false,
          fallback: {
            provider: "anthropic",
            model: ""
          },
          modelProfilesTextByProvider: {
            openai: "gpt-5.4 | chat | 1 | 1 | 1",
            anthropic: "",
            runway: "",
            kling: "",
            heygen: ""
          },
          providerKeys: {
            openai: "",
            anthropic: ""
          }
        },
        providerKeyState: {
          openai: {
            configured: false,
            lastFour: null,
            updatedAt: null
          },
          anthropic: {
            configured: false,
            lastFour: null,
            updatedAt: null
          }
        }
      })
    ).toThrow("OpenAI API key is required for the selected provider.");
  });

  it("still validates missing primary model before key checks", () => {
    expect(
      validateRuntimeProviderSettingsAdminDraft({
        primary: {
          provider: "openai",
          model: ""
        },
        fallbackEnabled: false,
        fallback: {
          provider: "anthropic",
          model: ""
        },
        modelProfilesTextByProvider: {
          openai: "",
          anthropic: "",
          runway: "",
          kling: "",
          heygen: ""
        },
        providerKeys: {
          openai: "",
          anthropic: ""
        }
      })
    ).toBe("Primary model is required.");
  });

  it("keeps Runway and Kling catalogs out of chat model aliases", () => {
    const request = buildRuntimeProviderSettingsRequest({
      draft: {
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallbackEnabled: false,
        fallback: {
          provider: "anthropic",
          model: ""
        },
        modelProfilesTextByProvider: {
          openai: "gpt-5.4 | chat | 1 | 1 | 1",
          anthropic: "",
          runway: "runway-gen-4 | video | 1 | 1 | 1",
          kling: "kling-v2 | video | 1 | 1 | 1",
          heygen: ""
        },
        providerKeys: {
          openai: "",
          anthropic: ""
        }
      },
      providerKeyState: {
        openai: {
          configured: true,
          lastFour: "1234",
          updatedAt: "2026-03-25T10:00:00.000Z"
        },
        anthropic: {
          configured: false,
          lastFour: null,
          updatedAt: null
        }
      }
    });

    expect(request.availableModelsByProvider).toEqual({
      openai: ["gpt-5.4"],
      anthropic: []
    });
    expect(request.availableModelCatalogByProvider.runway.models[0]).toMatchObject({
      model: "runway-gen-4",
      capabilities: ["video"]
    });
    expect(request.availableModelCatalogByProvider.kling.models[0]).toMatchObject({
      model: "kling-v2",
      capabilities: ["video"]
    });
  });
});
