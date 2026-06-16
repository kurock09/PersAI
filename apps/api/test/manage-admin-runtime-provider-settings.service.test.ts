import assert from "node:assert/strict";
import { ManageAdminRuntimeProviderSettingsService } from "../src/modules/workspace-management/application/manage-admin-runtime-provider-settings.service";

async function run(): Promise<void> {
  const rolloutRequests: unknown[] = [];
  let configGeneration = 0;

  const service = new ManageAdminRuntimeProviderSettingsService(
    {
      platformRuntimeProviderSettings: {
        upsert: async () => ({})
      }
    } as never,
    {
      assertCanReadAdminSurface: async () => ({ workspaceId: "ws-1" }),
      assertCanPerformDangerousAdminAction: async () => ({ workspaceId: "ws-1" })
    } as never,
    {
      assertEncryptionConfigured: () => undefined,
      loadKeyMetadata: async () => ({
        openai: { configured: true, lastFour: "1234", updatedAt: "2026-05-01T00:00:00.000Z" },
        anthropic: { configured: true, lastFour: "5678", updatedAt: "2026-05-01T00:00:00.000Z" }
      }),
      upsertProviderKey: async () => undefined
    } as never,
    {
      execute: async () => ({
        schema: "persai.adminRuntimeProviderSettings.v2",
        mode: "global_settings",
        primary: { provider: "openai", model: "gpt-5.4" },
        fallback: null,
        routingFastModelKey: "gpt-5.4-mini",
        routerPolicy: {
          enabled: true,
          mode: "shadow",
          classifierFailureFallbackMode: "normal",
          clarifyOnMissingContext: true,
          analyzeUploadsOnB2cUpload: false,
          precheckRuleOverrides: null
        },
        availableModelsByProvider: {
          openai: ["gpt-5.4"],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: { models: [] },
          anthropic: { models: [] }
        },
        providerKeys: {
          openai: { configured: true, lastFour: "1234", updatedAt: "2026-05-01T00:00:00.000Z" },
          anthropic: { configured: false, lastFour: null, updatedAt: null }
        },
        notes: []
      })
    } as never,
    {
      execute: async () => {
        configGeneration += 1;
        return configGeneration;
      }
    } as never,
    {
      execute: async () => undefined
    } as never,
    {
      createAutomaticGlobalRollout: async (input: unknown) => {
        rolloutRequests.push(input);
        return {};
      }
    } as never
  );

  const result = await service.updateSettings(
    "admin-1",
    {
      primary: { provider: "openai", model: "gpt-5.4" },
      fallback: null,
      routingFastModelKey: "gpt-5.4-mini",
      routerPolicy: {
        enabled: true,
        mode: "shadow",
        classifierFailureFallbackMode: "normal",
        clarifyOnMissingContext: true,
        analyzeUploadsOnB2cUpload: true,
        precheckRuleOverrides: null
      },
      availableModelsByProvider: {
        openai: ["gpt-5.4"],
        anthropic: []
      },
      availableModelCatalogByProvider: {
        openai: { models: [] },
        anthropic: { models: [] }
      },
      providerKeys: {}
    },
    "step-up"
  );

  assert.equal(result.configGeneration, 1);
  assert.equal(rolloutRequests.length, 1);
  assert.deepEqual(rolloutRequests[0], {
    actorUserId: "admin-1",
    workspaceId: "ws-1",
    rolloutType: "runtime_provider_settings_change",
    triggerSource: "provider_settings",
    scopeType: "provider_profile",
    criticality: "hard",
    targetGeneration: 1,
    scopeMetadata: {
      reason: "admin.runtime_provider_settings.update",
      primaryProvider: "openai",
      primaryModel: "gpt-5.4",
      fallbackProvider: null,
      fallbackModel: null
    },
    auditEventCode: "admin.materialization_rollout_created",
    auditSummary: "Admin queued a runtime provider settings materialization rollout."
  });
}

void run();
