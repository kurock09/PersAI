import assert from "node:assert/strict";
import { ManageAdminToolCredentialsService } from "../src/modules/workspace-management/application/manage-admin-tool-credentials.service";

async function run(): Promise<void> {
  const rolloutRequests: unknown[] = [];
  let configGeneration = 0;

  const service = new ManageAdminToolCredentialsService(
    {
      assertCanPerformDangerousAdminAction: async () => ({ workspaceId: "ws-1" })
    } as never,
    {
      execute: async () => {
        configGeneration += 1;
        return configGeneration;
      }
    } as never,
    {
      assertEncryptionConfigured: () => undefined,
      upsertProviderKey: async () => undefined,
      resolveSecretValueByProviderKey: async () => null,
      loadKeyMetadataByKeys: async () => ({})
    } as never,
    {
      execute: async () => undefined
    } as never,
    {
      createAutomaticGlobalRollout: async (input: unknown) => {
        rolloutRequests.push(input);
        return {};
      }
    } as never,
    {
      forceRefreshVoiceCatalog: async () => null
    } as never,
    {
      platformHeygenVoiceCatalogCache: {
        async findUnique() {
          return null;
        }
      }
    } as never
  );

  await service.updateCredentials(
    "admin-1",
    {
      keys: {
        tool_browser: "browserless-secret",
        tool_video_generate_runway: "runway-secret",
        tool_video_generate_kling: "kling-secret",
        tool_video_generate_heygen: "heygen-secret"
      },
      providers: {
        tool_browser: "browserless"
      },
      documentProviderTemplateIds: {
        pdfmonkey: "template-123"
      },
      ttsPrimaryProviderId: "openai"
    },
    "step-up"
  );

  assert.equal(configGeneration, 1);
  assert.equal(rolloutRequests.length, 1);
  assert.deepEqual(rolloutRequests[0], {
    actorUserId: "admin-1",
    workspaceId: "ws-1",
    rolloutType: "tool_policy_change",
    triggerSource: "tool_policy",
    scopeType: "affected_policy",
    criticality: "hard",
    targetGeneration: 1,
    scopeMetadata: {
      reason: "admin.tool_credentials.update",
      updatedCredentials: [
        "tool_browser",
        "tool_video_generate_runway",
        "tool_video_generate_kling",
        "tool_video_generate_heygen"
      ],
      updatedProviders: [
        {
          credentialKey: "tool_browser",
          providerId: "browserless"
        }
      ],
      updatedDocumentProviderTemplateIds: ["pdfmonkey"],
      ttsPrimaryProviderId: "openai"
    },
    auditEventCode: "admin.materialization_rollout_created",
    auditSummary: "Admin queued a tool credential materialization rollout."
  });

  console.log("manage-admin-tool-credentials.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
