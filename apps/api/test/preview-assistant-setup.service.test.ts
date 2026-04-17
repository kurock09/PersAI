import assert from "node:assert/strict";
import { afterEach } from "node:test";
import { PreviewAssistantSetupService } from "../src/modules/workspace-management/application/preview-assistant-setup.service";
import type { AssistantPublishedVersionRepository } from "../src/modules/workspace-management/domain/assistant-published-version.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type { AssistantPublishedVersion } from "../src/modules/workspace-management/domain/assistant-published-version.entity";
import type { MaterializeAssistantPublishedVersionService } from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

const ORIGINAL_ENV = process.env;

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

function setApiEnv(): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    PERSAI_RUNTIME_BUNDLE_SYNC_TIMEOUT_MS: "9000",
    PERSAI_RUNTIME_TURN_TIMEOUT_MS: "9000"
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function run(): Promise<void> {
  setApiEnv();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];

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
          schema: "persai.runtime.bundle.v1",
          promptConstructor: {
            onboarding: {
              previewTurnPrompt: "Show Mira's character to Alex.",
              welcomeTurnPrompt: "Hello Alex, I am Mira.",
              firstTurnPrompt: "Hello Alex, I am Mira."
            }
          }
        },
        assistantConfig: { bootstrap: true },
        assistantWorkspace: { workspace: true },
        layersDocument: "{}",
        runtimeBundleDocument: "{}",
        runtimeBundleHash: "bundle-hash-1",
        assistantConfigDocument: "{}",
        assistantWorkspaceDocument: "{}",
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

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    requests.push({ url, body });
    if (url === "http://runtime.local/api/v1/bundles/warm") {
      return new Response(
        JSON.stringify({
          bundle: body?.bundle,
          warmedAt: "2026-04-03T12:00:00.000Z",
          replaced: false,
          cacheEntries: 1,
          evictedBundleIds: []
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "http://runtime.local/api/v1/turns/create") {
      return new Response(
        JSON.stringify({
          requestId: "runtime-request-1",
          sessionId: "runtime-session-1",
          assistantText: "Hello, I am Mira.",
          artifacts: [],
          respondedAt: "2026-04-03T12:00:00.000Z",
          usage: null
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (url === "http://runtime.local/api/v1/bundles/invalidate") {
      return new Response(
        JSON.stringify({
          invalidatedAt: "2026-04-03T12:00:01.000Z",
          invalidatedCount: 1,
          remainingEntries: 0
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    throw new Error(`Unexpected preview fetch url: ${url}`);
  }) as typeof fetch;

  try {
    const service = new PreviewAssistantSetupService(
      assistantRepository,
      publishedVersionRepository,
      materializeService,
      prisma
    );

    const result = await service.execute("user-1");

    assert.deepEqual(result, {
      message: "Hello, I am Mira.",
      respondedAt: "2026-04-03T12:00:00.000Z"
    });
    assert.equal(requests.length, 3);
    assert.equal(requests[0]?.url, "http://runtime.local/api/v1/bundles/warm");
    assert.equal((requests[0]?.body?.bundle as Record<string, unknown>)?.assistantId, assistant.id);
    assert.equal(
      (requests[0]?.body?.bundle as Record<string, unknown>)?.publishedVersionId,
      (requests[1]?.body?.bundle as Record<string, unknown>)?.publishedVersionId
    );
    assert.equal(requests[0]?.body?.runtimeTier, "free_shared_restricted");
    assert.equal(requests[0]?.body?.bundleDocument, "{}");
    assert.equal(requests[1]?.url, "http://runtime.local/api/v1/turns/create");
    assert.equal(requests[1]?.body?.runtimeTier, "free_shared_restricted");
    assert.equal(
      (requests[1]?.body?.message as Record<string, unknown>)?.text,
      "Show Mira's character to Alex."
    );
    assert.equal(
      (requests[1]?.body?.message as Record<string, unknown>)?.timezone,
      "Europe/Moscow"
    );
    assert.equal((requests[2]?.body as Record<string, unknown>)?.assistantId, assistant.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
