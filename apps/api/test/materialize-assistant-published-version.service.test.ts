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
        chat: ["gpt-5.4"],
        image: ["gpt-image-1.5"],
        video: ["sora-2-pro"]
      },
      anthropic: {
        chat: ["claude-sonnet-4-5"],
        image: [],
        video: []
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
          openai: { chat: [], image: [], video: [] },
          anthropic: { chat: [], image: [], video: [] }
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
