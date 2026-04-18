import assert from "node:assert/strict";
import {
  assertRequiredProviderKeysAvailable,
  buildPlatformRuntimeProviderProfileState,
  buildPlatformRuntimeProviderSettingsState,
  createEmptyPlatformRuntimeProviderKeyMetadata,
  parseUpdatePlatformRuntimeProviderSettingsInput
} from "../src/modules/workspace-management/application/platform-runtime-provider-settings";

async function run(): Promise<void> {
  const parsed = parseUpdatePlatformRuntimeProviderSettingsInput({
    primary: {
      provider: "openai",
      model: "gpt‑5.4"
    },
    fallback: {
      provider: "anthropic",
      model: "claude-sonnet-4-5"
    },
    availableModelsByProvider: {
      openai: ["gpt‑5.4", "gpt‑5.4-mini"],
      anthropic: ["claude-sonnet-4-5"]
    },
    routingFastModelKey: "gpt‑5.4-mini",
    routerPolicy: {
      enabled: true,
      mode: "shadow",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      precheckRuleOverrides: {
        continueTerms: ["ok", "continue"],
        retrievalTerms: ["find in docs"],
        reasoningTerms: ["architecture"],
        premiumTerms: ["rewrite"],
        toolTerms: ["browse"]
      }
    },
    providerKeys: {
      openai: " sk-openai-new ",
      anthropic: "sk-anthropic-new"
    }
  });

  assert.equal(parsed.primary.provider, "openai");
  assert.equal(parsed.fallback?.provider, "anthropic");
  assert.equal(parsed.primary.model, "gpt-5.4");
  assert.equal(parsed.routingFastModelKey, "gpt-5.4-mini");
  assert.equal(parsed.routerPolicy.enabled, true);
  assert.equal(parsed.routerPolicy.mode, "shadow");
  assert.deepEqual(parsed.routerPolicy.precheckRuleOverrides?.continueTerms, ["ok", "continue"]);
  assert.deepEqual(parsed.routerPolicy.precheckRuleOverrides?.premiumTerms, ["rewrite"]);
  assert.deepEqual(parsed.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);
  assert.deepEqual(parsed.availableModelsByProvider.anthropic, ["claude-sonnet-4-5"]);
  assert.equal(parsed.providerKeys.openai, "sk-openai-new");

  assert.throws(
    () =>
      assertRequiredProviderKeysAvailable({
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallback: null,
        providerKeys: createEmptyPlatformRuntimeProviderKeyMetadata(),
        incomingProviderKeys: {}
      }),
    /OpenAI API key is required/
  );

  const providerKeys = createEmptyPlatformRuntimeProviderKeyMetadata();
  providerKeys.openai = {
    configured: true,
    lastFour: "1234",
    updatedAt: "2026-03-25T10:00:00.000Z"
  };
  providerKeys.anthropic = {
    configured: true,
    lastFour: "5678",
    updatedAt: "2026-03-25T10:05:00.000Z"
  };

  const settings = buildPlatformRuntimeProviderSettingsState({
    settings: {
      primaryProvider: "openai",
      primaryModel: "gpt‑5.4",
      fallbackProvider: "anthropic",
      fallbackModel: "claude-sonnet-4-5",
      routingFastModelKey: "gpt‑5.4-mini",
      routerPolicy: {
        enabled: true,
        mode: "active",
        classifierFailureFallbackMode: "premium",
        clarifyOnMissingContext: false,
        precheckRuleOverrides: null
      },
      availableModelsByProvider: {
        openai: ["gpt‑5.4", "gpt‑5.4-mini"],
        anthropic: ["claude-sonnet-4-5"]
      }
    },
    providerKeys
  });
  assert.equal(settings.mode, "global_settings");
  assert.equal(settings.primary?.model, "gpt-5.4");
  assert.equal(settings.routingFastModelKey, "gpt-5.4-mini");
  assert.equal(settings.routerPolicy.mode, "active");
  assert.equal(settings.routerPolicy.classifierFailureFallbackMode, "premium");
  assert.deepEqual(settings.availableModelsByProvider.anthropic, ["claude-sonnet-4-5"]);
  assert.deepEqual(settings.availableModelsByProvider.openai, ["gpt-5.4", "gpt-5.4-mini"]);

  const profile = buildPlatformRuntimeProviderProfileState(settings);
  assert.equal(profile.mode, "admin_managed");
  assert.deepEqual(profile.availableModelsByProvider, {
    openai: ["gpt-5.4", "gpt-5.4-mini"],
    anthropic: ["claude-sonnet-4-5"]
  });
  assert.equal(profile.primary.provider, "openai");
  assert.equal(profile.primary.credentialRef.secretRef.source, "persai");
  assert.equal(profile.primary.credentialRef.secretRef.provider, "persai-runtime");
  assert.equal(profile.primary.credentialRef.secretRef.id, "openai/api-key");
  assert.equal(profile.fallback?.credentialRef.secretRef.id, "anthropic/api-key");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
