import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ManageChatMediaService } from "../src/modules/workspace-management/application/manage-chat-media.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";

const assistant: Assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "workspace-1",
  draftDisplayName: null,
  draftInstructions: null,
  draftTraits: null,
  draftAvatarEmoji: null,
  draftAvatarUrl: null,
  draftAssistantGender: null,
  draftUpdatedAt: null,
  applyStatus: "succeeded",
  applyTargetVersionId: null,
  applyAppliedVersionId: null,
  applyRequestedAt: null,
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  configDirtyAt: null,
  createdAt: new Date("2026-04-06T00:00:00.000Z"),
  updatedAt: new Date("2026-04-06T00:00:00.000Z")
};

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.WEB_ACTIVE_CHATS_CAP = "20";
  process.env.QUOTA_TOKEN_BUDGET_DEFAULT = "100";
  process.env.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT = "3";
  const metrics = new PlatformHttpMetricsService();
  const deletedStoragePaths: string[] = [];
  const releasedBytes: bigint[] = [];
  const service = new ManageChatMediaService(
    {
      async findByUserId(userId: string) {
        return userId === "user-1" ? assistant : null;
      }
    } as never,
    {
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "created" as const,
          chat: {
            id: "chat-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: null,
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage() {
        return {
          id: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async create(input: {
        storagePath: string;
        mimeType: string;
        sizeBytes: bigint;
        originalFilename: string | null;
        transcription: string | null;
        metadata: Record<string, unknown> | null;
      }) {
        return {
          id: "att-1",
          messageId: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          attachmentType: "image",
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: null,
          width: 100,
          height: 100,
          processingStatus: "ready",
          transcription: input.transcription,
          metadata: input.metadata,
          createdAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async uploadChatMedia(input: {
        assistantId: string;
        runtimeTier: string;
        chatId: string;
        messageId: string;
        fileBuffer: Buffer;
        mimeType: string;
      }) {
        return {
          storagePath: `${input.chatId}/${input.messageId}/image.png`,
          sizeBytes: input.fileBuffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteChatMedia(_assistantId: string, storagePath: string) {
        deletedStoragePaths.push(storagePath);
      },
      async getWorkspaceStorageUsage() {
        return { usedBytes: 1000 };
      }
    } as never,
    {
      async process(buffer: Buffer, mime: string) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: mime,
          normalizedExtension: "png",
          transcription: null,
          textExtract: null,
          durationMs: null,
          width: 100,
          height: 100
        };
      }
    } as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never,
    {
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async resolveWorkspaceStorageLimit() {
        return { limitBytes: BigInt(524_288_000) };
      },
      async recordMediaUpload(input: { sizeBytes: bigint }) {
        return {
          appliedDelta: input.sizeBytes,
          capped: false,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: input.sizeBytes,
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      },
      async releaseMediaStorage(input: { sizeBytes: bigint }) {
        releasedBytes.push(input.sizeBytes);
        return {
          releasedDelta: input.sizeBytes,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(0),
            mediaStorageBytesLimit: BigInt(1000),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    metrics
  );

  const staged = await service.stageForWebThread({
    userId: "user-1",
    surfaceThreadKey: "thread-1",
    file: {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      mimetype: "image/png",
      originalname: "image.png"
    }
  });

  assert.equal(staged.chatId, "chat-1");
  assert.equal(staged.messageId, "msg-1");
  assert.deepEqual(deletedStoragePaths, []);
  assert.deepEqual(releasedBytes, []);
  const successSeries = metrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "web_stage_attachment" &&
        series.key.channel === "web" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 1);

  const failureMetrics = new PlatformHttpMetricsService();
  const cappedDeletes: string[] = [];
  const cappedReleases: bigint[] = [];
  const failingService = new ManageChatMediaService(
    {
      async findByUserId() {
        return assistant;
      }
    } as never,
    {
      async getOrCreateWebChatBySurfaceThreadUnderCap() {
        return {
          outcome: "created" as const,
          chat: {
            id: "chat-1",
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: null,
            archivedAt: null,
            lastMessageAt: null,
            createdAt: new Date("2026-04-06T00:00:00.000Z"),
            updatedAt: new Date("2026-04-06T00:00:00.000Z")
          }
        };
      },
      async createMessage() {
        return {
          id: "msg-1",
          chatId: "chat-1",
          assistantId: assistant.id,
          author: "user",
          content: "",
          createdAt: new Date("2026-04-06T00:00:00.000Z"),
          updatedAt: new Date("2026-04-06T00:00:00.000Z")
        };
      }
    } as never,
    {
      async create() {
        throw new Error("attachment must not be created when quota caps the upload");
      }
    } as never,
    {
      async uploadChatMedia() {
        return {
          storagePath: "chat-1/msg-1/image.png",
          sizeBytes: 12,
          mimeType: "image/png"
        };
      },
      async deleteChatMedia(_assistantId: string, storagePath: string) {
        cappedDeletes.push(storagePath);
      },
      async getWorkspaceStorageUsage() {
        return { usedBytes: 1000 };
      }
    } as never,
    {
      async process(buffer: Buffer, mime: string) {
        return {
          normalizedBuffer: buffer,
          normalizedMime: mime,
          normalizedExtension: "png",
          transcription: null,
          textExtract: null,
          durationMs: null,
          width: 100,
          height: 100
        };
      }
    } as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never,
    {
      async checkMediaStorageQuota() {
        return { allowed: true };
      },
      async resolveWorkspaceStorageLimit() {
        return { limitBytes: BigInt(524_288_000) };
      },
      async recordMediaUpload() {
        return {
          appliedDelta: BigInt(5),
          capped: true,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(100),
            mediaStorageBytesLimit: BigInt(100),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      },
      async releaseMediaStorage(input: { sizeBytes: bigint }) {
        cappedReleases.push(input.sizeBytes);
        return {
          releasedDelta: input.sizeBytes,
          state: {
            id: "state-1",
            workspaceId: assistant.workspaceId,
            tokenBudgetUsed: BigInt(0),
            tokenBudgetLimit: null,
            costOrTokenDrivingToolClassUnitsUsed: 0,
            costOrTokenDrivingToolClassUnitsLimit: null,
            activeWebChatsCurrent: 0,
            activeWebChatsLimit: null,
            mediaStorageBytesUsed: BigInt(95),
            mediaStorageBytesLimit: BigInt(100),
            lastComputedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }
    } as never,
    failureMetrics
  );

  await assert.rejects(
    () =>
      failingService.stageForWebThread({
        userId: "user-1",
        surfaceThreadKey: "thread-1",
        file: {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          mimetype: "image/png",
          originalname: "image.png"
        }
      }),
    (error) =>
      error instanceof ApiErrorHttpException &&
      error.errorObject.code === "media_storage_quota_exceeded"
  );
  assert.deepEqual(cappedDeletes, ["chat-1/msg-1/image.png"]);
  assert.deepEqual(cappedReleases, [BigInt(5)]);
  const failureSeries = failureMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "web_stage_attachment" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(failureSeries?.count, 1);

  await assert.rejects(
    () =>
      new ManageChatMediaService(
        {
          async findByUserId() {
            return assistant;
          }
        } as never,
        {
          async getOrCreateWebChatBySurfaceThreadUnderCap() {
            return {
              outcome: "cap_reached" as const,
              activeCount: 20,
              limit: 20
            };
          }
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        new PlatformHttpMetricsService()
      ).stageForWebThread({
        userId: "user-1",
        surfaceThreadKey: "thread-cap",
        file: {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          mimetype: "image/png",
          originalname: "image.png"
        }
      }),
    (error: unknown) =>
      error instanceof Error &&
      "errorObject" in error &&
      typeof error.errorObject === "object" &&
      error.errorObject !== null &&
      "code" in error.errorObject &&
      error.errorObject.code === "active_chat_cap_reached"
  );
}

void run();
