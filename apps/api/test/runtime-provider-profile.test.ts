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
    anthropic: [],
    deepseek: [],
    kimi: []
  });
  assert.deepEqual(Object.keys(managed.availableModelCatalogByProvider).sort(), [
    "anthropic",
    "deepseek",
    "heygen",
    "kimi",
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
          openai: ["gpt-5.4", "gpt-5.5"],
          anthropic: ["claude-sonnet-4-5"],
          deepseek: ["deepseek-v4-flash"],
          kimi: [],
          runway: ["runway-gen-4"]
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              { model: "gpt-5.4", capabilities: ["chat"] },
              { model: "gpt-5.5", capabilities: ["chat"] }
            ]
          },
          anthropic: {
            models: [{ model: "claude-sonnet-4-5", capabilities: ["chat"] }]
          },
          deepseek: {
            models: [{ model: "deepseek-v4-flash", capabilities: ["chat"] }]
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
    openai: ["gpt-5.4", "gpt-5.5"],
    anthropic: ["claude-sonnet-4-5"],
    deepseek: ["deepseek-v4-flash"],
    kimi: []
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
  // ADR-122 corrective — READ-path family-default fold-in: the catalog row for the
  // KNOWN model claude-sonnet-4-5 omits maxOutputTokens/contextWindow (stored null,
  // as PROD rows are with these brand-new fields), so the read path must coerce them
  // to the published ceiling. gpt-5.4 is NOT in defaults → stays null.
  const sonnetRead = catalogOnlyManaged.availableModelCatalogByProvider.anthropic.models.find(
    (profile) => profile.model === "claude-sonnet-4-5"
  );
  assert.equal(
    sonnetRead?.maxOutputTokens,
    64_000,
    "READ fold-in: known model claude-sonnet-4-5 null maxOutputTokens → family default 64k"
  );
  assert.equal(
    sonnetRead?.contextWindow,
    200_000,
    "READ fold-in: known model claude-sonnet-4-5 null contextWindow → family default 200k"
  );
  assert.equal(
    sonnetRead?.promptCachePolicy,
    null,
    "catalog row with no promptCachePolicy stays null for known Anthropic models"
  );
  const gpt54Read = catalogOnlyManaged.availableModelCatalogByProvider.openai.models.find(
    (profile) => profile.model === "gpt-5.4"
  );
  assert.equal(
    gpt54Read?.maxOutputTokens,
    null,
    "READ fold-in: unknown model gpt-5.4 maxOutputTokens stays null"
  );
  assert.equal(
    gpt54Read?.contextWindow,
    null,
    "READ fold-in: unknown model gpt-5.4 contextWindow stays null"
  );
  assert.equal(
    gpt54Read?.promptCachePolicy,
    null,
    "READ path keeps unknown-model promptCachePolicy null"
  );
  const gpt55Read = catalogOnlyManaged.availableModelCatalogByProvider.openai.models.find(
    (profile) => profile.model === "gpt-5.5"
  );
  assert.equal(
    gpt55Read?.promptCachePolicy,
    null,
    "catalog row with no promptCachePolicy stays null for known OpenAI models"
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

  const invalidPromptCachePolicyKnown = resolveRuntimeProviderProfileState({
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-5.5"
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5.5",
                capabilities: ["chat"],
                promptCachePolicy: { mode: "automatic", retention: "forever" }
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
  assert.equal(
    invalidPromptCachePolicyKnown.availableModelCatalogByProvider.openai.models[0]
      ?.promptCachePolicy,
    null,
    "invalid stored promptCachePolicy on known model degrades to null"
  );

  const invalidPromptCachePolicyUnknown = resolveRuntimeProviderProfileState({
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-unknown"
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-unknown",
                capabilities: ["chat"],
                promptCachePolicy: { mode: "automatic", retention: "forever" }
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
  assert.equal(
    invalidPromptCachePolicyUnknown.availableModelCatalogByProvider.openai.models[0]
      ?.promptCachePolicy,
    null,
    "invalid stored promptCachePolicy on unknown model stays null"
  );

  const explicitPromptCachePolicy = resolveRuntimeProviderProfileState({
    policyEnvelope: {
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        primary: {
          provider: "openai",
          model: "gpt-5.6-terra"
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5.6-terra",
                capabilities: ["chat"],
                promptCachePolicy: {
                  mode: "explicit",
                  ttl: "30m",
                  stableAnchor: "explicit",
                  sealedSpineBreakpoint: "explicit"
                }
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
  assert.deepEqual(
    explicitPromptCachePolicy.availableModelCatalogByProvider.openai.models[0]?.promptCachePolicy,
    {
      mode: "explicit",
      ttl: "30m",
      stableAnchor: "explicit",
      sealedSpineBreakpoint: "explicit"
    },
    "GPT-5.6-like explicit promptCachePolicy remains declarative catalog data"
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
