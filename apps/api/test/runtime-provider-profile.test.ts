import assert from "node:assert/strict";
import {
  assertValidRuntimeProviderProfilePatch,
  resolveRuntimeProviderProfileState
} from "../src/modules/workspace-management/application/runtime-provider-profile";

async function run(): Promise<void> {
  const legacy = resolveRuntimeProviderProfileState({
    policyEnvelope: null,
    secretRefs: null
  });
  assert.equal(legacy.mode, "legacy_openclaw_default");
  assert.equal(legacy.primary, null);
  assert.equal(legacy.fallback, null);

  const managed = resolveRuntimeProviderProfileState({
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

  assert.equal(managed.mode, "admin_managed");
  assert.equal(managed.primary.provider, "openai");
  assert.equal(managed.primary.model, "gpt-5.4");
  assert.equal(managed.primary.credentialRef.refKey, "env:default:OPENAI_API_KEY");
  assert.equal(managed.fallback?.provider, "anthropic");
  assert.equal(managed.fallback?.credentialRef.secretRef.id, "ANTHROPIC_API_KEY");

  assert.throws(
    () =>
      resolveRuntimeProviderProfileState({
        policyEnvelope: {
          runtimeProviderProfile: {
            schema: "persai.runtimeProviderProfile.v1",
            primary: {
              provider: "openai",
              model: "gpt-5.4"
            }
          }
        },
        secretRefs: {
          refs: {
            runtime_provider_credentials: {
              schema: "persai.runtimeProviderCredentialRefs.v1",
              providers: {
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
        }
      }),
    /requires secretRefs\.refs\.runtime_provider_credentials\.providers\.openai/
  );

  assert.throws(
    () =>
      assertValidRuntimeProviderProfilePatch({
        policyEnvelope: {
          runtimeProviderProfile: {
            schema: "persai.runtimeProviderProfile.v1",
            primary: {
              provider: "openai",
              model: "gpt-5.4"
            }
          }
        },
        secretRefs: null
      }),
    /targetPatch\.secretRefs\.refs\.runtime_provider_credentials is required/
  );
}

void run();
