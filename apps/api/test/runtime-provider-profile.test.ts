import assert from "node:assert/strict";
import {
  assertValidRuntimeProviderProfilePatch,
  resolveRuntimeProviderProfileState
} from "../src/modules/workspace-management/application/runtime-provider-profile";

const RUNWAY_VIDEO_MODEL_PARAMETERS = {
  duration: { kind: "allowed_list" as const, values: [5, 8, 10] },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280:720" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720:1280" }
  ],
  referenceImageSupported: true,
  audioCapabilities: ["silent"] as const,
  inputCapabilities: ["text", "single_reference_image"] as const,
  providerParameters: null
};

const KLING_VIDEO_MODEL_PARAMETERS = {
  duration: { kind: "range" as const, min: 3, max: 15, step: 1 },
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

async function run(): Promise<void> {
  const legacy = resolveRuntimeProviderProfileState({
    policyEnvelope: null,
    secretRefs: null
  });
  assert.equal(legacy.mode, "unconfigured_default");
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
  assert.deepEqual(managed.availableModelsByProvider, {
    openai: [],
    anthropic: []
  });
  assert.deepEqual(Object.keys(managed.availableModelCatalogByProvider).sort(), [
    "anthropic",
    "heygen",
    "kling",
    "openai",
    "runway"
  ]);
  assert.deepEqual(managed.availableModelCatalogByProvider.runway.models, []);
  assert.deepEqual(managed.availableModelCatalogByProvider.kling.models, []);
  assert.deepEqual(managed.availableModelCatalogByProvider.heygen.models, []);

  const catalogOnlyManaged = resolveRuntimeProviderProfileState({
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        availableModelsByProvider: {
          openai: ["gpt-5.4"],
          anthropic: ["claude-sonnet-4-5"],
          runway: ["runway-gen-4"]
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [{ model: "gpt-5.4", capabilities: ["chat"] }]
          },
          anthropic: {
            models: [{ model: "claude-sonnet-4-5", capabilities: ["chat"] }]
          },
          runway: {
            models: [
              {
                model: "runway-gen-4",
                capabilities: ["video"],
                videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
              }
            ]
          },
          kling: {
            models: [
              {
                model: "kling-v3",
                capabilities: ["video"],
                videoModelParameters: KLING_VIDEO_MODEL_PARAMETERS
              }
            ]
          }
        }
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
            }
          }
        }
      }
    }
  });
  assert.deepEqual(catalogOnlyManaged.availableModelsByProvider, {
    openai: ["gpt-5.4"],
    anthropic: ["claude-sonnet-4-5"]
  });
  assert.deepEqual(
    catalogOnlyManaged.availableModelCatalogByProvider.runway.models.map(
      (profile) => profile.model
    ),
    ["runway-gen-4"]
  );
  assert.deepEqual(
    catalogOnlyManaged.availableModelCatalogByProvider.kling.models.map((profile) => profile.model),
    ["kling-v3"]
  );
  assert.deepEqual(
    catalogOnlyManaged.availableModelCatalogByProvider.runway.models[0]?.videoModelParameters
      ?.audioCapabilities,
    ["silent"]
  );
  assert.deepEqual(
    catalogOnlyManaged.availableModelCatalogByProvider.runway.models[0]?.videoModelParameters
      ?.inputCapabilities,
    ["text", "single_reference_image"]
  );
  const legacyVideoDefaults = resolveRuntimeProviderProfileState({
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "sora-2",
                capabilities: ["video"],
                videoModelParameters: {
                  duration: { kind: "allowed_list", values: [4, 8, 12] },
                  aspectRatios: [
                    {
                      aspectRatio: "16:9",
                      size: "1280x720",
                      providerValue: "1280x720"
                    }
                  ],
                  referenceImageSupported: false
                }
              }
            ]
          },
          anthropic: {
            models: [{ model: "claude-sonnet-4-5", capabilities: ["chat"] }]
          }
        }
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
            }
          }
        }
      }
    }
  });
  assert.deepEqual(
    legacyVideoDefaults.availableModelCatalogByProvider.openai.models[0]?.videoModelParameters
      ?.audioCapabilities,
    ["silent"]
  );
  assert.deepEqual(
    legacyVideoDefaults.availableModelCatalogByProvider.openai.models[0]?.videoModelParameters
      ?.inputCapabilities,
    ["text"]
  );

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
      resolveRuntimeProviderProfileState({
        policyEnvelope: {
          runtimeProviderProfile: {
            schema: "persai.runtimeProviderProfile.v1",
            primary: {
              provider: "runway",
              model: "runway-gen-4"
            }
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
                }
              }
            }
          }
        }
      }),
    /primary\.provider must be one of: openai, anthropic/
  );

  assert.throws(
    () =>
      resolveRuntimeProviderProfileState({
        policyEnvelope: {
          runtimeProviderProfile: {
            schema: "persai.runtimeProviderProfile.v1",
            primary: {
              provider: "openai",
              model: "gpt-5.4"
            },
            availableModelCatalogByProvider: {
              openai: {
                models: [{ model: "gpt-5.4", capabilities: ["chat"] }]
              },
              anthropic: {
                models: [{ model: "claude-sonnet-4-5", capabilities: ["chat"] }]
              },
              runway: {
                models: [
                  {
                    model: "runway-gen-4",
                    capabilities: ["chat", "video"],
                    videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
                  }
                ]
              }
            }
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
                }
              }
            }
          }
        }
      }),
    /must contain only "video" for runway catalog rows/
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

  // ADR-109 Slice 2b: kind field assertions
  {
    // Parser defaults non-HeyGen rows to "cinematic"
    const runwayProfile = resolveRuntimeProviderProfileState({
      policyEnvelope: {
        runtimeProviderProfile: {
          schema: "persai.runtimeProviderProfile.v1",
          primary: { provider: "openai", model: "gpt-5.4" },
          availableModelCatalogByProvider: {
            runway: {
              models: [
                {
                  model: "runway-gen-4",
                  capabilities: ["video"],
                  videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
                }
              ]
            }
          }
        }
      },
      secretRefs: {
        refs: {
          runtime_provider_credentials: {
            schema: "persai.runtimeProviderCredentialRefs.v1",
            providers: {
              openai: {
                secretRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }
              }
            }
          }
        }
      }
    });
    assert.equal(runwayProfile.mode, "admin_managed");
    const runwayRow = runwayProfile.availableModelCatalogByProvider.runway.models[0];
    assert.equal(runwayRow?.kind, "cinematic", "runway rows must default to cinematic");
  }

  {
    // Parser defaults HeyGen rows to "talking_avatar"
    const heygenProfile = resolveRuntimeProviderProfileState({
      policyEnvelope: {
        runtimeProviderProfile: {
          schema: "persai.runtimeProviderProfile.v1",
          primary: { provider: "openai", model: "gpt-5.4" },
          availableModelCatalogByProvider: {
            heygen: {
              models: [
                {
                  model: "heygen-v2",
                  capabilities: ["video"],
                  videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
                }
              ]
            }
          }
        }
      },
      secretRefs: {
        refs: {
          runtime_provider_credentials: {
            schema: "persai.runtimeProviderCredentialRefs.v1",
            providers: {
              openai: {
                secretRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }
              }
            }
          }
        }
      }
    });
    assert.equal(heygenProfile.mode, "admin_managed");
    const heygenRow = heygenProfile.availableModelCatalogByProvider.heygen.models[0];
    assert.equal(heygenRow?.kind, "talking_avatar", "heygen rows must default to talking_avatar");
  }

  {
    // Parser accepts explicit kind field on a catalog row
    const explicitKindProfile = resolveRuntimeProviderProfileState({
      policyEnvelope: {
        runtimeProviderProfile: {
          schema: "persai.runtimeProviderProfile.v1",
          primary: { provider: "openai", model: "gpt-5.4" },
          availableModelCatalogByProvider: {
            runway: {
              models: [
                {
                  model: "runway-gen-4",
                  capabilities: ["video"],
                  kind: "cinematic",
                  videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
                }
              ]
            }
          }
        }
      },
      secretRefs: {
        refs: {
          runtime_provider_credentials: {
            schema: "persai.runtimeProviderCredentialRefs.v1",
            providers: {
              openai: {
                secretRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }
              }
            }
          }
        }
      }
    });
    assert.equal(explicitKindProfile.mode, "admin_managed");
    const explicitKindRow = explicitKindProfile.availableModelCatalogByProvider.runway.models[0];
    assert.equal(
      explicitKindRow?.kind,
      "cinematic",
      "parser must accept explicit kind='cinematic'"
    );
  }

  // Parser refuses incompatible kind/provider: HeyGen with kind="cinematic"
  assert.throws(
    () =>
      resolveRuntimeProviderProfileState({
        policyEnvelope: {
          runtimeProviderProfile: {
            schema: "persai.runtimeProviderProfile.v1",
            primary: { provider: "openai", model: "gpt-5.4" },
            availableModelCatalogByProvider: {
              heygen: {
                models: [
                  {
                    model: "heygen-v2",
                    capabilities: ["video"],
                    kind: "cinematic",
                    videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
                  }
                ]
              }
            }
          }
        },
        secretRefs: {
          refs: {
            runtime_provider_credentials: {
              schema: "persai.runtimeProviderCredentialRefs.v1",
              providers: {
                openai: {
                  secretRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }
                }
              }
            }
          }
        }
      }),
    /HeyGen rows must have kind='talking_avatar'/
  );

  // Parser refuses incompatible kind/provider: non-HeyGen with kind="talking_avatar"
  assert.throws(
    () =>
      resolveRuntimeProviderProfileState({
        policyEnvelope: {
          runtimeProviderProfile: {
            schema: "persai.runtimeProviderProfile.v1",
            primary: { provider: "openai", model: "gpt-5.4" },
            availableModelCatalogByProvider: {
              runway: {
                models: [
                  {
                    model: "runway-gen-4",
                    capabilities: ["video"],
                    kind: "talking_avatar",
                    videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS
                  }
                ]
              }
            }
          }
        },
        secretRefs: {
          refs: {
            runtime_provider_credentials: {
              schema: "persai.runtimeProviderCredentialRefs.v1",
              providers: {
                openai: {
                  secretRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }
                }
              }
            }
          }
        }
      }),
    /only HeyGen rows may have kind='talking_avatar'/
  );
}

void run();
