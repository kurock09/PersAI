import assert from "node:assert/strict";
import {
  buildImageEditToolCredentialRef,
  buildImageGenerateToolCredentialRef,
  buildVideoGenerateToolCredentialRef,
  resolveAllowedPlanCapabilityModelKey,
  resolveAllowedPlanPrimaryModelKey,
  resolveVideoGenerateProviderSelection
} from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";
import { buildToolCredentialSecretRef } from "../src/modules/workspace-management/application/tool-credential-settings";

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
}

void run();
