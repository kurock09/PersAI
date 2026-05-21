import assert from "node:assert/strict";
import { resolveAllowedPlanPrimaryModelKey } from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";

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
          anthropic: { models: [] }
        },
        primary: null,
        fallback: null,
        notes: []
      },
      planPrimaryModelKey: "gpt-4.1-mini"
    }),
    "gpt-4.1-mini"
  );
}

void run();
