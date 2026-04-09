import { describe, expect, it } from "vitest";
import {
  buildRuntimeProviderSettingsRequest,
  resolveRuntimeProviderSettingsAdminFormState,
  validateRuntimeProviderSettingsAdminDraft
} from "./runtime-provider-settings-admin";

describe("runtime-provider-settings-admin", () => {
  it("hydrates global settings into the simplified admin form", () => {
    const state = resolveRuntimeProviderSettingsAdminFormState({
      schema: "persai.adminRuntimeProviderSettings.v1",
      mode: "global_settings",
      primary: {
        provider: "openai",
        model: "gpt-5.4"
      },
      fallback: {
        provider: "anthropic",
        model: "claude-sonnet-4-5"
      },
      availableModelsByProvider: {
        openai: ["gpt-5.4", "gpt-4.1"],
        anthropic: ["claude-sonnet-4-5"]
      },
      optimizationPolicy: {
        heartbeat: {
          every: "0m",
          target: "none",
          lightContext: true,
          isolatedSession: true
        },
        contextPruning: {
          mode: "cache-ttl",
          ttl: "5m",
          keepLastAssistants: 3,
          softTrimRatio: 0.3,
          hardClearRatio: 0.5,
          minPrunableToolChars: 12000,
          softTrim: {
            maxChars: 3000,
            headChars: 1000,
            tailChars: 1000
          },
          hardClear: {
            enabled: true,
            placeholder: "[Old tool result content cleared]"
          }
        },
        compaction: {
          mode: "safeguard",
          reserveTokens: 24000,
          keepRecentTokens: 16000,
          recentTurnsPreserve: 4,
          identifierPolicy: "strict",
          postIndexSync: "async",
          truncateAfterCompaction: true
        },
        openai: {
          fastMode: false,
          serviceTier: "default",
          responsesServerCompaction: true,
          openaiWsWarmup: true
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
      tierSecurityPolicies: [],
      notes: []
    });

    expect(state.mode).toBe("global_settings");
    expect(state.draft.primary).toEqual({
      provider: "openai",
      model: "gpt-5.4"
    });
    expect(state.draft.fallbackEnabled).toBe(true);
    expect(state.draft.availableModelsTextByProvider.openai).toBe("gpt-5.4\ngpt-4.1");
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
        availableModelsTextByProvider: {
          openai: "gpt-4.1\ngpt-5.4",
          anthropic: "claude-sonnet-4-5"
        },
        providerKeys: {
          openai: "",
          anthropic: "sk-ant-new"
        }
      },
      optimizationPolicy: {
        heartbeat: {
          every: "0m",
          target: "none",
          lightContext: true,
          isolatedSession: true
        },
        contextPruning: {
          mode: "cache-ttl",
          ttl: "5m",
          keepLastAssistants: 3,
          softTrimRatio: 0.3,
          hardClearRatio: 0.5,
          minPrunableToolChars: 12000,
          softTrim: {
            maxChars: 3000,
            headChars: 1000,
            tailChars: 1000
          },
          hardClear: {
            enabled: true,
            placeholder: "[Old tool result content cleared]"
          }
        },
        compaction: {
          mode: "safeguard",
          reserveTokens: 24000,
          keepRecentTokens: 16000,
          recentTurnsPreserve: 4,
          identifierPolicy: "strict",
          postIndexSync: "async",
          truncateAfterCompaction: true
        },
        openai: {
          fastMode: false,
          serviceTier: "default",
          responsesServerCompaction: true,
          openaiWsWarmup: true
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
        availableModelsTextByProvider: {
          openai: "gpt-4.1",
          anthropic: ""
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
          availableModelsTextByProvider: {
            openai: "gpt-5.4",
            anthropic: ""
          },
          providerKeys: {
            openai: "",
            anthropic: ""
          }
        },
        optimizationPolicy: {
          heartbeat: {
            every: "0m",
            target: "none",
            lightContext: true,
            isolatedSession: true
          },
          contextPruning: {
            mode: "cache-ttl",
            ttl: "5m",
            keepLastAssistants: 3,
            softTrimRatio: 0.3,
            hardClearRatio: 0.5,
            minPrunableToolChars: 12000,
            softTrim: {
              maxChars: 3000,
              headChars: 1000,
              tailChars: 1000
            },
            hardClear: {
              enabled: true,
              placeholder: "[Old tool result content cleared]"
            }
          },
          compaction: {
            mode: "safeguard",
            reserveTokens: 24000,
            keepRecentTokens: 16000,
            recentTurnsPreserve: 4,
            identifierPolicy: "strict",
            postIndexSync: "async",
            truncateAfterCompaction: true
          },
          openai: {
            fastMode: false,
            serviceTier: "default",
            responsesServerCompaction: true,
            openaiWsWarmup: true
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
        availableModelsTextByProvider: {
          openai: "",
          anthropic: ""
        },
        providerKeys: {
          openai: "",
          anthropic: ""
        }
      })
    ).toBe("Primary model is required.");
  });
});
