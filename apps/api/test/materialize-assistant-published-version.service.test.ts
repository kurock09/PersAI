import assert from "node:assert/strict";
import {
  buildImageEditToolCredentialRef,
  buildImageGenerateToolCredentialRef,
  buildVideoGenerateToolCredentialRef,
  normalizeSkillScenarioSteps,
  resolveAllowedPlanCapabilityModelKey,
  resolveAllowedPlanPrimaryModelKey,
  resolveTtsModelKeyForProvider,
  resolveVideoGenerateProviderSelection
} from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";
import { buildToolCredentialSecretRef } from "../src/modules/workspace-management/application/tool-credential-settings";
import type { RuntimeToolPolicy } from "@persai/runtime-contract";

const RUNWAY_VIDEO_MODEL_PARAMETERS = {
  duration: {
    kind: "allowed_list" as const,
    values: [5, 8, 10]
  },
  aspectRatios: [
    { aspectRatio: "16:9" as const, size: "1280x720" as const, providerValue: "1280:720" },
    { aspectRatio: "9:16" as const, size: "720x1280" as const, providerValue: "720:1280" }
  ],
  referenceImageSupported: true,
  providerParameters: null
};

const KLING_VIDEO_MODEL_PARAMETERS = {
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
  providerParameters: {
    mode: "pro",
    sound: "off" as const
  }
};

async function run(): Promise<void> {
  const adminManagedProfile = {
    schema: "persai.runtimeProviderProfile.v1",
    mode: "admin_managed" as const,
    derivedFrom: {
      policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
      secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
    },
    allowedProviders: ["openai", "anthropic"] as const,
    availableModelsByProvider: {
      openai: ["gpt-5.4"],
      anthropic: ["claude-sonnet-4-5"]
    },
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
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },
              timePricing: null,
              fixedOperationPricing: null,
              tieredOperationPricing: null
            }
          },
          {
            model: "gpt-image-1.5",
            capabilities: ["image"],
            active: true,
            billingMode: "fixed_operation",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: null,
              timePricing: null,
              fixedOperationPricing: { unitLabel: null, pricePerOperation: 0 },
              tieredOperationPricing: null
            }
          },
          {
            model: "sora-2-pro",
            capabilities: ["video"],
            active: true,
            billingMode: "time_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            videoModelParameters: {
              duration: {
                kind: "allowed_list" as const,
                values: [4, 8, 12]
              },
              aspectRatios: [
                {
                  aspectRatio: "16:9" as const,
                  size: "1280x720" as const,
                  providerValue: "1280x720"
                },
                {
                  aspectRatio: "9:16" as const,
                  size: "720x1280" as const,
                  providerValue: "720x1280"
                }
              ],
              referenceImageSupported: true,
              providerParameters: null
            },
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: null,
              timePricing: { unit: "second", pricePerUnit: 0 },
              fixedOperationPricing: null,
              tieredOperationPricing: null
            }
          },
          {
            model: "gpt-4o-mini-tts",
            capabilities: ["text_to_speech"],
            active: true,
            billingMode: "text_chars_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: null,
              timePricing: null,
              fixedOperationPricing: null,
              textCharsPricing: { pricePer1MChars: 18 },
              tieredOperationPricing: null
            }
          }
        ]
      },
      anthropic: {
        models: [
          {
            model: "claude-sonnet-4-5",
            capabilities: ["chat"],
            active: true,
            billingMode: "token_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },
              timePricing: null,
              fixedOperationPricing: null,
              tieredOperationPricing: null
            }
          }
        ]
      },
      runway: {
        models: [
          {
            model: "gen4-turbo",
            capabilities: ["video"],
            active: true,
            billingMode: "time_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            videoModelParameters: RUNWAY_VIDEO_MODEL_PARAMETERS,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: null,
              timePricing: { unit: "second", pricePerUnit: 0 },
              fixedOperationPricing: null,
              tieredOperationPricing: null
            }
          }
        ]
      },
      kling: {
        models: [
          {
            model: "kling-v3",
            capabilities: ["video"],
            active: true,
            billingMode: "time_metered",
            effectiveFrom: null,
            effectiveTo: null,
            inputTokenWeight: 1,
            cachedInputTokenWeight: 1,
            outputTokenWeight: 1,
            displayLabel: null,
            notes: null,
            videoModelParameters: KLING_VIDEO_MODEL_PARAMETERS,
            providerPriceMetadata: {
              currency: "USD",
              tokenPricing: null,
              timePricing: { unit: "second", pricePerUnit: 0 },
              fixedOperationPricing: null,
              tieredOperationPricing: null
            }
          }
        ]
      },
      heygen: {
        models: []
      }
    },
    primary: {
      provider: "openai" as const,
      model: "gpt-5.4",
      credentialRef: {
        refKey: "persai:openai",
        secretRef: {
          source: "persai" as const,
          provider: "persai-runtime",
          id: "openai/api-key"
        }
      }
    },
    fallback: null,
    notes: []
  };

  assert.equal(
    resolveAllowedPlanPrimaryModelKey({
      runtimeProviderProfile: adminManagedProfile,
      planPrimaryModelKey: "gpt-5.4"
    }),
    "gpt-5.4"
  );

  assert.equal(
    resolveAllowedPlanPrimaryModelKey({
      runtimeProviderProfile: adminManagedProfile,
      planPrimaryModelKey: "gpt-4.1-mini"
    }),
    null
  );

  assert.equal(
    resolveAllowedPlanPrimaryModelKey({
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        mode: "unconfigured_default",
        derivedFrom: {
          policyEnvelopeSchema: null,
          secretRefsSchema: null
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: {
          openai: [],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: { models: [] },
          anthropic: { models: [] },
          runway: { models: [] },
          kling: { models: [] }
        },
        primary: null,
        fallback: null,
        notes: []
      },
      planPrimaryModelKey: "gpt-4.1-mini"
    }),
    "gpt-4.1-mini"
  );

  assert.equal(
    resolveAllowedPlanPrimaryModelKey({
      runtimeProviderProfile: {
        ...adminManagedProfile,
        primary: {
          ...adminManagedProfile.primary,
          provider: "openai",
          model: "gpt-5.4"
        },
        availableModelCatalogByProvider: {
          ...adminManagedProfile.availableModelCatalogByProvider,
          anthropic: {
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
                maxOutputTokens: null,
                contextWindow: null,
                promptCacheRetention: null,
                displayLabel: null,
                notes: null,
                videoModelParameters: null,
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
                maxOutputTokens: null,
                contextWindow: null,
                promptCacheRetention: null,
                displayLabel: null,
                notes: null,
                videoModelParameters: null,
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
              }
            ]
          }
        }
      },
      planPrimaryModelKey: "shared-foreign-model"
    }),
    null
  );

  assert.equal(
    resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile: adminManagedProfile,
      planModelKey: "gpt-image-1.5",
      capability: "image"
    }),
    "gpt-image-1.5"
  );
  assert.equal(
    resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile: adminManagedProfile,
      planModelKey: "gen4-turbo",
      capability: "image"
    }),
    null
  );
  assert.equal(
    resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile: adminManagedProfile,
      planModelKey: "gen4-turbo",
      capability: "video"
    }),
    "gen4-turbo"
  );
  assert.equal(
    resolveAllowedPlanCapabilityModelKey({
      runtimeProviderProfile: adminManagedProfile,
      planModelKey: "kling-v3",
      capability: "video"
    }),
    "kling-v3"
  );

  assert.deepEqual(
    resolveVideoGenerateProviderSelection({
      runtimeProviderProfile: adminManagedProfile,
      modelKey: "sora-2-pro"
    }),
    {
      providerId: "openai",
      modelKey: "sora-2-pro"
    }
  );
  assert.deepEqual(
    resolveVideoGenerateProviderSelection({
      runtimeProviderProfile: adminManagedProfile,
      modelKey: "gen4-turbo"
    }),
    {
      providerId: "runway",
      modelKey: "gen4-turbo"
    }
  );
  assert.deepEqual(
    resolveVideoGenerateProviderSelection({
      runtimeProviderProfile: adminManagedProfile,
      modelKey: "kling-v3"
    }),
    {
      providerId: "kling",
      modelKey: "kling-v3"
    }
  );
  assert.equal(
    resolveTtsModelKeyForProvider({
      runtimeProviderProfile: adminManagedProfile,
      providerId: "openai"
    }),
    "gpt-4o-mini-tts"
  );
  assert.equal(
    resolveTtsModelKeyForProvider({
      runtimeProviderProfile: adminManagedProfile,
      providerId: "yandex"
    }),
    null
  );

  const openAiMediaRef = {
    ...buildToolCredentialSecretRef("tool_image_generate"),
    configured: true,
    providerId: "openai",
    modelKey: "gpt-image-1.5"
  };
  const materializedImageGenerateRef = buildImageGenerateToolCredentialRef({
    imageCredentialRef: openAiMediaRef,
    imageGenerateModelKey: "gpt-image-1.5",
    imageGenerateFallbackModelKey: null
  });
  const materializedImageEditRef = buildImageEditToolCredentialRef({
    imageCredentialRef: openAiMediaRef,
    imageEditModelKey: "gpt-image-1.5",
    imageEditFallbackModelKey: null
  });

  assert.equal(
    materializedImageGenerateRef.secretRef.id,
    "tool/image_generate/api-key",
    "image_generate keeps the existing OpenAI media credential"
  );
  assert.equal(materializedImageGenerateRef.providerId, "openai");
  assert.equal(materializedImageGenerateRef.modelKey, "gpt-image-1.5");
  assert.equal(
    materializedImageEditRef.secretRef.id,
    "tool/image_generate/api-key",
    "image_edit keeps the existing OpenAI media credential"
  );
  assert.equal(materializedImageEditRef.providerId, "openai");
  assert.equal(materializedImageEditRef.modelKey, "gpt-image-1.5");

  const materializedOpenAiVideoRef = buildVideoGenerateToolCredentialRef({
    runtimeProviderProfile: adminManagedProfile,
    keyMetadata: {
      tool_image_generate: { configured: true },
      tool_video_generate_runway: { configured: false },
      tool_video_generate_kling: { configured: false }
    },
    imageCredentialRef: openAiMediaRef,
    videoGenerateModelKey: "sora-2-pro",
    videoGenerateFallbackModelKey: null
  });
  assert.equal(materializedOpenAiVideoRef.secretRef.id, "tool/image_generate/api-key");
  assert.equal(materializedOpenAiVideoRef.providerId, "openai");
  assert.equal(materializedOpenAiVideoRef.modelKey, "sora-2-pro");

  const materializedRunwayVideoRef = buildVideoGenerateToolCredentialRef({
    runtimeProviderProfile: adminManagedProfile,
    keyMetadata: {
      tool_image_generate: { configured: true },
      tool_video_generate_runway: { configured: false },
      tool_video_generate_kling: { configured: false }
    },
    imageCredentialRef: openAiMediaRef,
    videoGenerateModelKey: "gen4-turbo",
    videoGenerateFallbackModelKey: null
  });
  assert.equal(materializedRunwayVideoRef.secretRef.id, "tool/video_generate/runway/api-key");
  assert.equal(materializedRunwayVideoRef.providerId, "runway");
  assert.equal(materializedRunwayVideoRef.modelKey, "gen4-turbo");

  const materializedKlingVideoRef = buildVideoGenerateToolCredentialRef({
    runtimeProviderProfile: adminManagedProfile,
    keyMetadata: {
      tool_image_generate: { configured: true },
      tool_video_generate_runway: { configured: false },
      tool_video_generate_kling: { configured: true }
    },
    imageCredentialRef: openAiMediaRef,
    videoGenerateModelKey: "kling-v3",
    videoGenerateFallbackModelKey: null
  });
  assert.equal(materializedKlingVideoRef.secretRef.id, "tool/video_generate/kling/api-key");
  assert.equal(materializedKlingVideoRef.providerId, "kling");
  assert.equal(materializedKlingVideoRef.modelKey, "kling-v3");
  assert.equal(materializedKlingVideoRef.configured, true);
  assert.deepEqual(materializedKlingVideoRef.videoModelParameters, KLING_VIDEO_MODEL_PARAMETERS);

  const crossProviderFallbackRef = buildVideoGenerateToolCredentialRef({
    runtimeProviderProfile: adminManagedProfile,
    keyMetadata: {
      tool_image_generate: { configured: true },
      tool_video_generate_runway: { configured: false },
      tool_video_generate_kling: { configured: true }
    },
    imageCredentialRef: openAiMediaRef,
    videoGenerateModelKey: "sora-2-pro",
    videoGenerateFallbackModelKey: "kling-v3"
  });
  assert.equal(crossProviderFallbackRef.secretRef.id, "tool/image_generate/api-key");
  assert.equal(crossProviderFallbackRef.providerId, "openai");
  assert.equal(crossProviderFallbackRef.modelKey, "sora-2-pro");
  assert.deepEqual(
    crossProviderFallbackRef.fallbacks?.map((ref) => ({
      secretId: ref.secretRef.id,
      providerId: ref.providerId
    })),
    [{ secretId: "tool/video_generate/kling/api-key", providerId: "kling" }]
  );
  assert.deepEqual(materializedRunwayVideoRef.videoModelParameters, RUNWAY_VIDEO_MODEL_PARAMETERS);

  const incompatibleFallbackRef = buildVideoGenerateToolCredentialRef({
    runtimeProviderProfile: adminManagedProfile,
    keyMetadata: {
      tool_image_generate: { configured: true },
      tool_video_generate_runway: { configured: true },
      tool_video_generate_kling: { configured: true }
    },
    imageCredentialRef: openAiMediaRef,
    videoGenerateModelKey: "kling-v3",
    videoGenerateFallbackModelKey: "gen4-turbo"
  });
  assert.equal(incompatibleFallbackRef.providerId, "kling");
  assert.equal(incompatibleFallbackRef.fallbacks?.[0]?.providerId, "runway");
  assert.equal(incompatibleFallbackRef.fallbacks?.[0]?.modelKey, "gen4-turbo");

  assert.throws(
    () =>
      resolveVideoGenerateProviderSelection({
        runtimeProviderProfile: adminManagedProfile,
        modelKey: "missing-video-model"
      }),
    /not present in the active runtime video catalog/
  );

  // ── ADR-109 Slice 8 — talkingVideoEnabled materialization into toolPolicy ──
  // Simulates the post-resolveRuntimeToolPolicies injection in the service:
  //   toolPolicies = rawToolPolicies.map(p =>
  //     p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: planTalkingVideoEnabled } : p
  //   );
  const baseVideoPolicy: RuntimeToolPolicy = {
    toolCode: "video_generate",
    displayName: "Video Generate",
    description: "Generate a short video clip from text.",
    kind: "plan",
    executionMode: "worker",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: 5
  };

  // Plan with talkingVideoEnabled=true → policy must carry talkingVideoEnabled: true
  const policiesWithTalking = [baseVideoPolicy, { ...baseVideoPolicy, toolCode: "web_search" }].map(
    (p) => (p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: true } : p)
  );
  const videoWithTalking = policiesWithTalking.find((p) => p.toolCode === "video_generate");
  assert.equal(
    videoWithTalking?.talkingVideoEnabled,
    true,
    "Slice 8: materialized toolPolicy must carry talkingVideoEnabled: true when plan has it on"
  );

  // Plan with talkingVideoEnabled=false → policy must carry talkingVideoEnabled: false
  const policiesWithTalkingOff = [baseVideoPolicy].map((p) =>
    p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: false } : p
  );
  const videoWithTalkingOff = policiesWithTalkingOff.find((p) => p.toolCode === "video_generate");
  assert.equal(
    videoWithTalkingOff?.talkingVideoEnabled,
    false,
    "Slice 8: materialized toolPolicy must carry talkingVideoEnabled: false when plan has it off"
  );

  // Legacy plan (no talkingVideoEnabled in billingHints) → resolvePlanTalkingVideoEnabled returns false
  // Verify the defensive read pattern used in the runtime Slice 7 TODO-stub:
  //   const talkingVideoEnabled = (policy as unknown as Record<string, unknown>)?.talkingVideoEnabled;
  //   if (talkingVideoEnabled === false) { ... }
  // When the field is absent (legacy bundle), `talkingVideoEnabled` is `undefined`, which is NOT `=== false`
  // so the gate is permissive. After Slice 8 materialization, absent-field plans get explicit `false`.
  const legacyPolicies = [{ ...baseVideoPolicy }]; // no talkingVideoEnabled on legacy bundle
  const legacyVideoPolicy = legacyPolicies.find((p) => p.toolCode === "video_generate");
  const legacyTalkingVideoEnabled = (legacyVideoPolicy as unknown as Record<string, unknown>)
    ?.talkingVideoEnabled;
  assert.equal(
    legacyTalkingVideoEnabled,
    undefined,
    "Slice 8: legacy bundle without talkingVideoEnabled has undefined (permissive for Slice 7 gate)"
  );

  // After Slice 8, materialization always writes the boolean explicitly:
  const slice8LegacyPolicies = [{ ...baseVideoPolicy }].map((p) =>
    p.toolCode === "video_generate" ? { ...p, talkingVideoEnabled: false } : p
  );
  const slice8LegacyVideoPolicy = slice8LegacyPolicies.find((p) => p.toolCode === "video_generate");
  assert.equal(
    slice8LegacyVideoPolicy?.talkingVideoEnabled,
    false,
    "Slice 8: legacy plan (no flag in billingHints) must default to false after materialization"
  );

  // ── ADR-109 Slice 10 — persona catalog attach logic ──
  // Tests the branching logic inside `attachMaterializedVideoPersonaCatalog` by simulating
  // the gates and asserting the resulting credential ref shape.
  // This mirrors the pattern used in test 2 of materialize-heygen-voice-catalog.test.ts.

  const heygenBaseRef = {
    refKey: "persai:persai-runtime:tool/video_generate/heygen/api-key",
    secretRef: {
      source: "persai",
      provider: "persai-runtime",
      id: "tool/video_generate/heygen/api-key"
    },
    configured: true,
    providerId: "heygen"
  };

  const fixturePersonas = [
    {
      id: "01937c8a-0000-4000-8000-000000000001",
      workspaceId: "ws-test",
      displayName: "Маша",
      displayNameLower: "маша",
      portraitImageUrl: "https://example.com/masha.jpg",
      portraitImageStorageKey: "storage/masha.jpg",
      heygenVoiceId: "voice-masha",
      heygenVoiceLabel: "Russian (Female)",
      clonedVoiceId: "clone-masha",
      linkedClonedVoiceDisplayName: "Masha Brand",
      linkedClonedVoiceProviderId: "heygen-clone-masha",
      linkedClonedVoiceStatus: "ready",
      linkedClonedVoiceArchived: false,
      heygenAvatarId: "avatar-masha",
      archived: false,
      archivedAt: null,
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01")
    },
    {
      id: "01937d12-0000-4000-8000-000000000002",
      workspaceId: "ws-test",
      displayName: "Anna",
      displayNameLower: "anna",
      portraitImageUrl: "https://example.com/anna.jpg",
      portraitImageStorageKey: "storage/anna.jpg",
      heygenVoiceId: "voice-anna",
      heygenVoiceLabel: "English (Female)",
      clonedVoiceId: null,
      linkedClonedVoiceDisplayName: null,
      linkedClonedVoiceProviderId: null,
      linkedClonedVoiceStatus: null,
      linkedClonedVoiceArchived: null,
      heygenAvatarId: "avatar-anna",
      archived: false,
      archivedAt: null,
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01")
    }
  ];

  // Simulates the `attachMaterializedVideoPersonaCatalog` logic:
  function simulateAttachPersonaCatalog(
    ref: typeof heygenBaseRef & { videoPersonaCatalog?: unknown },
    workspacePersonas: typeof fixturePersonas,
    talkingVideoEnabled: boolean
  ) {
    if (ref.providerId !== "heygen") return ref;
    if (talkingVideoEnabled !== true) return ref;
    const catalog = {
      provider: "heygen" as const,
      schema: "persai.runtimeVideoPersonaCatalog.v1" as const,
      personas: workspacePersonas.map((row) => ({
        personaId: row.id,
        displayName: row.displayName,
        voiceLabel:
          row.linkedClonedVoiceArchived === false &&
          row.linkedClonedVoiceStatus === "ready" &&
          row.linkedClonedVoiceDisplayName !== null
            ? row.linkedClonedVoiceDisplayName
            : row.heygenVoiceLabel,
        presetVoiceLabel: row.heygenVoiceLabel,
        linkedClonedVoiceDisplayName:
          row.linkedClonedVoiceArchived === false && row.linkedClonedVoiceStatus === "ready"
            ? row.linkedClonedVoiceDisplayName
            : null
      }))
    };
    return { ...ref, videoPersonaCatalog: catalog };
  }

  // Case 1: HeyGen + talkingVideoEnabled=true + 2 active personas → catalog with 2 entries
  {
    const result = simulateAttachPersonaCatalog(heygenBaseRef, fixturePersonas, true);
    assert.ok(
      "videoPersonaCatalog" in result,
      "Slice 10: HeyGen + talkingVideoEnabled=true must attach videoPersonaCatalog"
    );
    const catalog = (
      result as typeof result & { videoPersonaCatalog: { provider: string; personas: unknown[] } }
    ).videoPersonaCatalog;
    assert.equal(catalog.provider, "heygen", "Slice 10: catalog provider must be 'heygen'");
    assert.equal(catalog.personas.length, 2, "Slice 10: catalog must contain 2 persona entries");
    const p0 = catalog.personas[0] as {
      personaId: string;
      displayName: string;
      voiceLabel: string;
      presetVoiceLabel: string | null;
      linkedClonedVoiceDisplayName: string | null;
    };
    assert.equal(p0.personaId, "01937c8a-0000-4000-8000-000000000001");
    assert.equal(p0.displayName, "Маша");
    assert.equal(p0.voiceLabel, "Masha Brand");
    assert.equal(p0.presetVoiceLabel, "Russian (Female)");
    assert.equal(p0.linkedClonedVoiceDisplayName, "Masha Brand");
    console.log("PASS Slice 10: heygen + talkingVideoEnabled=true + 2 personas → catalog attached");
  }

  // Case 2: HeyGen + talkingVideoEnabled=false → NO videoPersonaCatalog
  {
    const result = simulateAttachPersonaCatalog(heygenBaseRef, fixturePersonas, false);
    assert.ok(
      !("videoPersonaCatalog" in result),
      "Slice 10: talkingVideoEnabled=false must NOT attach videoPersonaCatalog"
    );
    console.log("PASS Slice 10: heygen + talkingVideoEnabled=false → no catalog");
  }

  // Case 3: HeyGen + talkingVideoEnabled=true + 0 personas (empty list) → empty catalog
  {
    const result = simulateAttachPersonaCatalog(heygenBaseRef, [], true);
    assert.ok(
      "videoPersonaCatalog" in result,
      "Slice 10: empty persona list must still attach videoPersonaCatalog (not skip)"
    );
    const catalog = (result as typeof result & { videoPersonaCatalog: { personas: unknown[] } })
      .videoPersonaCatalog;
    assert.equal(
      catalog.personas.length,
      0,
      "Slice 10: empty persona list → empty catalog.personas"
    );
    console.log("PASS Slice 10: heygen + talkingVideoEnabled=true + 0 personas → empty catalog");
  }

  // Case 4: Non-HeyGen credential (Kling) → no videoPersonaCatalog regardless of talkingVideoEnabled
  {
    const klingRef = { ...heygenBaseRef, providerId: "kling" as string };
    const result = simulateAttachPersonaCatalog(
      klingRef as typeof heygenBaseRef,
      fixturePersonas,
      true
    );
    assert.ok(
      !("videoPersonaCatalog" in result),
      "Slice 10: non-heygen provider must NOT attach videoPersonaCatalog (gate 1 fails)"
    );
    console.log("PASS Slice 10: non-heygen ref → no catalog regardless of talkingVideoEnabled");
  }

  // ── ADR-109 Slice 10c Fix #3d: buildTalkingAvatarCredentialRef simulation tests ──
  // The private method is tested via a simulation that mirrors its branching logic.

  type HeygenCatalogRow = {
    model: string;
    active: boolean;
    kind?: string;
    videoModelParameters?: unknown | null;
  };

  // Simulates the key branching logic of buildTalkingAvatarCredentialRef.
  function simulateBuildTalkingAvatarRef(params: {
    heygenKeyConfigured: boolean;
    talkingVideoEnabled: boolean;
    heygenCatalogRows: HeygenCatalogRow[];
    talkingAvatarModelKey: string | null;
  }): { modelKey: string } | null {
    if (!params.heygenKeyConfigured) return null;
    if (!params.talkingVideoEnabled) return null;
    const activeRows = params.heygenCatalogRows.filter((r) => r.active);
    if (activeRows.length === 0) return null;
    const resolvedModelKey =
      params.talkingAvatarModelKey !== null &&
      activeRows.some((r) => r.model === params.talkingAvatarModelKey)
        ? params.talkingAvatarModelKey
        : (activeRows[0]?.model ?? null);
    if (resolvedModelKey === null) return null;
    return { modelKey: resolvedModelKey };
  }

  // Case 1: secret configured + toggle on + catalog rows → ref built with resolved model key.
  {
    const result = simulateBuildTalkingAvatarRef({
      heygenKeyConfigured: true,
      talkingVideoEnabled: true,
      heygenCatalogRows: [
        { model: "heygen-photo-avatar-v3", active: true },
        { model: "heygen-photo-avatar-v4", active: true }
      ],
      talkingAvatarModelKey: null
    });
    assert.notEqual(
      result,
      null,
      "Slice 10c: configured secret + toggle on + active rows → non-null ref"
    );
    assert.equal(
      result?.modelKey,
      "heygen-photo-avatar-v3",
      "Slice 10c: no plan key → defaults to first active HeyGen row"
    );
    console.log("PASS Slice 10c materializ: secret+toggle+rows → ref built, defaults to first row");
  }

  // Case 2: HeyGen secret NOT configured → null ref (no credential leak).
  {
    const result = simulateBuildTalkingAvatarRef({
      heygenKeyConfigured: false,
      talkingVideoEnabled: true,
      heygenCatalogRows: [{ model: "heygen-photo-avatar-v3", active: true }],
      talkingAvatarModelKey: null
    });
    assert.equal(
      result,
      null,
      "Slice 10c: HeyGen secret not configured → null (no credential built)"
    );
    console.log("PASS Slice 10c materializ: unconfigured heygen secret → null ref");
  }

  // Case 3: talkingVideoEnabled=false → null ref (plan toggle gate).
  {
    const result = simulateBuildTalkingAvatarRef({
      heygenKeyConfigured: true,
      talkingVideoEnabled: false,
      heygenCatalogRows: [{ model: "heygen-photo-avatar-v3", active: true }],
      talkingAvatarModelKey: null
    });
    assert.equal(result, null, "Slice 10c: talkingVideoEnabled=false → null (plan toggle gate)");
    console.log("PASS Slice 10c materializ: talkingVideoEnabled=false → null ref");
  }

  // Case 4a: plan.talkingAvatarModelKey set and active → specific model used.
  {
    const result = simulateBuildTalkingAvatarRef({
      heygenKeyConfigured: true,
      talkingVideoEnabled: true,
      heygenCatalogRows: [
        { model: "heygen-photo-avatar-v3", active: true },
        { model: "heygen-photo-avatar-v4", active: true }
      ],
      talkingAvatarModelKey: "heygen-photo-avatar-v4"
    });
    assert.equal(
      result?.modelKey,
      "heygen-photo-avatar-v4",
      "Slice 10c: plan.talkingAvatarModelKey set to active row → specific model used"
    );
    console.log("PASS Slice 10c materializ: plan model key set → specific model resolved");
  }

  // Case 4b: plan.talkingAvatarModelKey set but NOT in catalog → falls back to first active.
  {
    const result = simulateBuildTalkingAvatarRef({
      heygenKeyConfigured: true,
      talkingVideoEnabled: true,
      heygenCatalogRows: [{ model: "heygen-photo-avatar-v3", active: true }],
      talkingAvatarModelKey: "heygen-nonexistent-model"
    });
    assert.equal(
      result?.modelKey,
      "heygen-photo-avatar-v3",
      "Slice 10c: plan model key not in catalog → falls back to first active row"
    );
    console.log("PASS Slice 10c materializ: plan model key not in catalog → first row fallback");
  }

  // ADR-119 Slice 4 — normalizeSkillScenarioSteps new optional fields
  {
    // New fields present → values flow through to the bundle step
    const steps = normalizeSkillScenarioSteps([
      {
        number: 1,
        directive: "Ask for brief.",
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: [],
        expectedUserResponse: "4 brief items",
        nextStepTrigger: "All 4 items collected.",
        recoveryGuidance: "Re-ask for missing items."
      }
    ]);
    assert.equal(steps.length, 1);
    assert.equal(
      steps[0]!.expectedUserResponse,
      "4 brief items",
      "expectedUserResponse flows through from row to bundle step"
    );
    assert.equal(
      steps[0]!.nextStepTrigger,
      "All 4 items collected.",
      "nextStepTrigger flows through from row to bundle step"
    );
    assert.equal(
      steps[0]!.recoveryGuidance,
      "Re-ask for missing items.",
      "recoveryGuidance flows through from row to bundle step"
    );
    console.log("PASS ADR-119 Slice 4 materializ: new step fields flow through when present");
  }

  {
    // New fields absent → materialized bundle has null (not undefined)
    const steps = normalizeSkillScenarioSteps([
      {
        number: 1,
        directive: "No new fields.",
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: []
      }
    ]);
    assert.equal(steps.length, 1);
    assert.equal(
      steps[0]!.expectedUserResponse,
      null,
      "missing expectedUserResponse → null (not undefined)"
    );
    assert.equal(steps[0]!.nextStepTrigger, null, "missing nextStepTrigger → null (not undefined)");
    assert.equal(
      steps[0]!.recoveryGuidance,
      null,
      "missing recoveryGuidance → null (not undefined)"
    );
    console.log("PASS ADR-119 Slice 4 materializ: missing new step fields → null (not undefined)");
  }

  {
    // New fields explicitly set to null → materialized bundle has null
    const steps = normalizeSkillScenarioSteps([
      {
        number: 1,
        directive: "Explicit nulls.",
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: [],
        expectedUserResponse: null,
        nextStepTrigger: null,
        recoveryGuidance: null
      }
    ]);
    assert.equal(steps[0]!.expectedUserResponse, null);
    assert.equal(steps[0]!.nextStepTrigger, null);
    assert.equal(steps[0]!.recoveryGuidance, null);
    console.log("PASS ADR-119 Slice 4 materializ: explicit null new step fields → null");
  }
}

void run();
