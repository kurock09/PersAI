import { describe, expect, it } from "vitest";
import {
  buildRuntimeProviderRolloutPatch,
  createDefaultRuntimeProviderAdminDraft,
  resolveRuntimeProviderAdminFormState,
  validateRuntimeProviderAdminDraft
} from "./runtime-provider-profile-admin";

describe("runtime-provider-profile-admin", () => {
  it("hydrates current H1 governance into the admin form draft", () => {
    const state = resolveRuntimeProviderAdminFormState({
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
      secretRefs: {
        schema: "persai.secretRefs.v1",
        refs: {
          runtime_provider_credentials: {
            schema: "persai.runtimeProviderCredentialRefs.v1",
            providers: {
              openai: {
                refKey: "env:default:OPENAI_API_KEY",
                secretRef: {
                  source: "env",
                  provider: "default",
                  id: "OPENAI_API_KEY"
                }
              },
              anthropic: {
                refKey: "env:default:ANTHROPIC_API_KEY",
                secretRef: {
                  source: "env",
                  provider: "default",
                  id: "ANTHROPIC_API_KEY"
                }
              }
            }
          }
        }
      }
    });

    expect(state.mode).toBe("admin_managed");
    expect(state.draft.primary).toEqual({
      provider: "openai",
      model: "gpt-5.4"
    });
    expect(state.draft.fallbackEnabled).toBe(true);
    expect(state.draft.fallback).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5"
    });
    expect(state.draft.credentials.openai.secretId).toBe("OPENAI_API_KEY");
    expect(state.draft.credentials.anthropic.refKey).toBe("env:default:ANTHROPIC_API_KEY");
  });

  it("builds a merged rollout patch without dropping unrelated governance branches", () => {
    const draft = createDefaultRuntimeProviderAdminDraft();
    draft.primary.provider = "openai";
    draft.primary.model = "gpt-5.4";
    draft.fallbackEnabled = true;
    draft.fallback.provider = "anthropic";
    draft.fallback.model = "claude-sonnet-4-5";
    draft.credentials.openai = {
      refKey: "env:default:OPENAI_API_KEY",
      secretSource: "env",
      secretProvider: "default",
      secretId: "OPENAI_API_KEY"
    };
    draft.credentials.anthropic = {
      refKey: "env:default:ANTHROPIC_API_KEY",
      secretSource: "env",
      secretProvider: "default",
      secretId: "ANTHROPIC_API_KEY"
    };

    const patch = buildRuntimeProviderRolloutPatch({
      governance: {
        policyEnvelope: {
          platformUpdateWindow: "default",
          runtime_provider_profile: {
            schema: "stale.profile.v0"
          }
        },
        secretRefs: {
          schema: "persai.secretRefs.v1",
          refs: {
            telegram_bot_token: {
              refKey: "vault://assistants/a1/telegram_bot_token/v1",
              manager: "backend_vault_kms"
            },
            runtimeProviderCredentials: {
              schema: "stale.credential.refs.v0"
            }
          }
        }
      },
      draft
    });

    expect(patch).toEqual({
      policyEnvelope: {
        platformUpdateWindow: "default",
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
      secretRefs: {
        schema: "persai.secretRefs.v1",
        refs: {
          telegram_bot_token: {
            refKey: "vault://assistants/a1/telegram_bot_token/v1",
            manager: "backend_vault_kms"
          },
          runtime_provider_credentials: {
            schema: "persai.runtimeProviderCredentialRefs.v1",
            providers: {
              openai: {
                refKey: "env:default:OPENAI_API_KEY",
                secretRef: {
                  source: "env",
                  provider: "default",
                  id: "OPENAI_API_KEY"
                }
              },
              anthropic: {
                refKey: "env:default:ANTHROPIC_API_KEY",
                secretRef: {
                  source: "env",
                  provider: "default",
                  id: "ANTHROPIC_API_KEY"
                }
              }
            }
          }
        }
      }
    });
  });

  it("requires credential refs for selected providers", () => {
    const draft = createDefaultRuntimeProviderAdminDraft();
    draft.primary.provider = "openai";
    draft.primary.model = "gpt-5.4";

    expect(validateRuntimeProviderAdminDraft(draft)).toBe(
      "OpenAI credential ref is required for the selected provider."
    );
  });
});
