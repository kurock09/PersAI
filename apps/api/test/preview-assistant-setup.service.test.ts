import assert from "node:assert/strict";
import { PreviewAssistantSetupService } from "../src/modules/workspace-management/application/preview-assistant-setup.service";
import type {
  AssistantRuntimeFacade,
  AssistantRuntimeSetupPreviewTurnInput
} from "../src/modules/workspace-management/application/assistant-runtime.facade";
import type { AssistantPublishedVersionRepository } from "../src/modules/workspace-management/domain/assistant-published-version.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type { AssistantPublishedVersion } from "../src/modules/workspace-management/domain/assistant-published-version.entity";
import type { MaterializeAssistantPublishedVersionService } from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

const assistant: Assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "workspace-1",
  draftDisplayName: "Mira",
  draftInstructions: "Be warm.",
  draftTraits: { warmth: 80 },
  draftAvatarEmoji: "🙂",
  draftAvatarUrl: null,
  draftAssistantGender: "female",
  draftUpdatedAt: new Date("2026-04-03T00:00:00.000Z"),
  applyStatus: "not_requested",
  applyTargetVersionId: null,
  applyAppliedVersionId: null,
  applyRequestedAt: null,
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  configDirtyAt: null,
  createdAt: new Date("2026-04-03T00:00:00.000Z"),
  updatedAt: new Date("2026-04-03T00:00:00.000Z")
};

const latestVersion: AssistantPublishedVersion = {
  id: "pub-7",
  assistantId: assistant.id,
  version: 7,
  snapshotDisplayName: "Older",
  snapshotInstructions: "Older",
  snapshotTraits: null,
  snapshotAvatarEmoji: null,
  snapshotAvatarUrl: null,
  snapshotAssistantGender: "neutral",
  publishedByUserId: assistant.userId,
  createdAt: new Date("2026-04-02T00:00:00.000Z")
};

async function run(): Promise<void> {
  let previewInput: AssistantRuntimeSetupPreviewTurnInput | null = null;

  const assistantRepository: AssistantRepository = {
    findById: async () => assistant,
    findByUserId: async () => assistant,
    create: async () => assistant,
    updateDraft: async () => assistant,
    setApplyPending: async () => assistant,
    setApplyInProgress: async () => assistant,
    setApplyResult: async () => assistant,
    deleteById: async () => undefined,
    assignOwner: async () => assistant
  };

  const publishedVersionRepository: AssistantPublishedVersionRepository = {
    create: async () => latestVersion,
    findLatestByAssistantId: async () => latestVersion,
    findById: async () => latestVersion
  };

  const assistantRuntime = {
    preflight: async () => ({ live: true, ready: true, checkedAt: new Date().toISOString() }),
    applyMaterializedSpec: async () => {
      throw new Error("preview should not apply a live runtime spec");
    },
    cleanupWorkspace: async () => {
      throw new Error("preview should not clean the live workspace");
    },
    consumeBootstrapWorkspace: async () => undefined,
    resetWorkspace: async () => undefined,
    resetMemoryWorkspace: async () => undefined,
    deleteWebChatSession: async () => undefined,
    sendWebChatTurn: async () => {
      throw new Error("preview should not send a normal web chat turn");
    },
    previewSetupTurn: async (input) => {
      previewInput = input;
      return {
        assistantMessage: "Hello, I am Mira.",
        respondedAt: "2026-04-03T12:00:00.000Z",
        media: []
      };
    },
    streamWebChatTurn: async function* () {
      throw new Error("unused");
      yield undefined as never;
    },
    controlCronJob: async () => ({}),
    downloadChatMedia: async () => null
  } as Pick<
    AssistantRuntimeFacade,
    | "preflight"
    | "applyMaterializedSpec"
    | "cleanupWorkspace"
    | "consumeBootstrapWorkspace"
    | "resetWorkspace"
    | "resetMemoryWorkspace"
    | "deleteWebChatSession"
    | "sendWebChatTurn"
    | "previewSetupTurn"
    | "streamWebChatTurn"
    | "controlCronJob"
    | "downloadChatMedia"
  > as AssistantRuntimeFacade;

  const materializeService = {
    buildRuntimeArtifacts: async (
      runtimeAssistant: Assistant,
      previewVersion: AssistantPublishedVersion
    ) => {
      assert.equal(runtimeAssistant.id, assistant.id);
      assert.equal(previewVersion.assistantId, assistant.id);
      assert.equal(previewVersion.version, 8);
      assert.equal(previewVersion.snapshotDisplayName, "Mira");
      return {
        currentConfigGeneration: 1,
        layers: {},
        runtimeBundle: {
          schema: "persai.runtime.bundle.v1"
        },
        openclawBootstrap: { bootstrap: true },
        openclawWorkspace: { workspace: true },
        layersDocument: "{}",
        runtimeBundleDocument: "{}",
        runtimeBundleHash: "bundle-hash-1",
        openclawBootstrapDocument: "{}",
        openclawWorkspaceDocument: "{}",
        contentHash: "hash-1"
      };
    }
  } as MaterializeAssistantPublishedVersionService;

  const prisma = {
    appUser: {
      findUnique: async () => ({ displayName: "Alex" })
    },
    workspace: {
      findUnique: async () => ({ timezone: "Europe/Moscow" })
    }
  } as WorkspaceManagementPrismaService;

  const service = new PreviewAssistantSetupService(
    assistantRepository,
    publishedVersionRepository,
    assistantRuntime,
    materializeService,
    prisma
  );

  const result = await service.execute("user-1");

  assert.deepEqual(result, {
    message: "Hello, I am Mira.",
    respondedAt: "2026-04-03T12:00:00.000Z"
  });
  assert.ok(previewInput);
  assert.equal(previewInput.assistantId, assistant.id);
  assert.deepEqual(previewInput.legacyBridge.bootstrap, { bootstrap: true });
  assert.deepEqual(previewInput.legacyBridge.workspace, { workspace: true });
  assert.deepEqual(previewInput.runtimeBundle, {
    schema: "persai.runtime.bundle.v1"
  });
  assert.equal(previewInput.userTimezone, "Europe/Moscow");
  assert.match(previewInput.userMessage, /Introduce yourself to Alex/);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
