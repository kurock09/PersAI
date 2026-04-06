import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
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
  const metrics = new PlatformHttpMetricsService();
  const service = new ManageChatMediaService(
    {
      async findByUserId(userId: string) {
        return userId === "user-1" ? assistant : null;
      }
    } as never,
    {
      async findOrCreateChatBySurfaceThread() {
        return {
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
      async recordMediaUpload() {
        return undefined;
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
  const failingService = new ManageChatMediaService(
    {
      async findByUserId() {
        return assistant;
      }
    } as never,
    {
      async findOrCreateChatBySurfaceThread() {
        return {
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
    {} as never,
    {} as never,
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
        return { allowed: false };
      },
      async recordMediaUpload() {
        return undefined;
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
      error instanceof BadRequestException &&
      error.message === "Media storage quota exceeded for this workspace."
  );
  const failureSeries = failureMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "web_stage_attachment" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(failureSeries?.count, 1);
}

void run();
