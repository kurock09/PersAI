import assert from "node:assert/strict";
import { ManageAdminToolCredentialsService } from "../src/modules/workspace-management/application/manage-admin-tool-credentials.service";
import { HEYGEN_VOICE_CACHE_KEY } from "../src/modules/workspace-management/application/heygen/heygen-voice-catalog.service";

async function run(): Promise<void> {
  const rolloutRequests: unknown[] = [];
  let configGeneration = 0;

  const service = new ManageAdminToolCredentialsService(
    {
      assertCanReadAdminSurface: async () => undefined,
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
        async findUnique(input: { where: { cacheKey: string } }) {
          assert.equal(input.where.cacheKey, HEYGEN_VOICE_CACHE_KEY);
          return {
            fetchedAt: new Date("2026-06-12T13:52:14.570Z"),
            voicesJson: [
              {
                voice_id: "voice-1",
                name: "Imported Voice",
                type: "private",
                language: "en-US",
                gender: "female",
                preview_audio: "https://cdn.example/voice-1.mp3",
                support_locale: true,
                support_pause: true,
                engine: "avatar_v"
              }
            ]
          };
        }
      }
    } as never
  );

  const state = await service.getCredentials("admin-1");
  assert.deepEqual(state.heygenVoiceCatalog, {
    refreshedAt: "2026-06-12T13:52:14.570Z",
    voicesCount: 1
  });

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
      mediaReserve: {
        enabled: true,
        apiKey: "reserve-secret",
        baseUrl: "https://api.proxyapi.ru/openai/v1"
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
      updatedMediaReserve: {
        enabled: true,
        apiKeyUpdated: true,
        baseUrlUpdated: true
      },
      ttsPrimaryProviderId: "openai"
    },
    auditEventCode: "admin.materialization_rollout_created",
    auditSummary: "Admin queued a tool credential materialization rollout."
  });
}

void run();

async function runModelShortlistImpliesApproval(): Promise<void> {
  let receivedPatches: unknown[] = [];
  const service = new ManageAdminToolCredentialsService(
    {
      assertCanReadAdminSurface: async () => undefined,
      assertCanPerformDangerousAdminAction: async () => ({ workspaceId: "ws-1" })
    } as never,
    { execute: async () => 1 } as never,
    {
      assertEncryptionConfigured: () => undefined,
      upsertProviderKey: async () => undefined,
      resolveSecretValueByProviderKey: async () => null,
      loadKeyMetadataByKeys: async () => ({})
    } as never,
    { execute: async () => undefined } as never,
    { createAutomaticGlobalRollout: async () => ({}) } as never,
    {
      updateAdminVoiceCuration: async (input: { patches: unknown[] }) => {
        receivedPatches = input.patches;
        return { voices: [] };
      }
    } as never,
    {} as never
  );

  await service.updateHeygenVoiceCuration(
    "admin-1",
    {
      patches: [
        {
          providerVoiceId: "voice-model-only",
          approved: false,
          enabled: false,
          modelShortlist: true,
          languageBucket: "ru",
          gender: "female"
        }
      ]
    },
    "step-up"
  );

  assert.deepEqual(receivedPatches, [
    {
      providerVoiceId: "voice-model-only",
      approved: true,
      enabled: true,
      modelShortlist: true,
      languageBucket: "ru",
      gender: "female"
    }
  ]);
}

void runModelShortlistImpliesApproval();
