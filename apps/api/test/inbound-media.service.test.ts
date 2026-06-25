import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { InboundMediaService } from "../src/modules/workspace-management/application/media/inbound-media.service";
import type { AssistantChatMessageAttachment } from "../src/modules/workspace-management/domain/assistant-chat-message-attachment.entity";

describe("inbound-media.service", () => {
  test("rolls back primary upload when workspace media quota is capped", async () => {
    const deletedStoragePaths: string[] = [];
    const releasedBytes: bigint[] = [];
    let registerCalls = 0;
    const metrics = new PlatformHttpMetricsService();
    const sharedObjectKey = "workspaces/workspace-1/workspace/input/photo.jpg";

    const service = new InboundMediaService(
      {
        async create() {
          throw new Error("attachment must not be created after capped media apply");
        },
        async findById() {
          return null;
        }
      } as never,
      {
        async process(buffer: Buffer, mime: string) {
          return {
            normalizedBuffer: buffer,
            normalizedMime: mime,
            normalizedExtension: "jpg",
            transcription: null,
            textExtract: null,
            durationMs: null,
            width: 100,
            height: 100
          };
        },
        async createImageThumbnail() {
          throw new Error("thumbnail must not run after capped media apply");
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
          return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
        },
        async saveObject() {
          return {
            objectKey: sharedObjectKey,
            sizeBytes: 12,
            mimeType: "image/jpeg"
          };
        },
        async deleteObject(objectKey: string) {
          deletedStoragePaths.push(objectKey);
        }
      } as never,
      {
        async recordMediaUpload() {
          return {
            appliedDelta: BigInt(5),
            capped: true,
            state: {
              id: "state-1",
              workspaceId: "workspace-1",
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
          releasedBytes.push(input.sizeBytes);
          return {
            releasedDelta: input.sizeBytes,
            state: {
              id: "state-1",
              workspaceId: "workspace-1",
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
      {
        async execute() {
          registerCalls += 1;
          return { attachmentId: "attachment-1" };
        }
      } as never,
      {
        async get() {
          return null;
        }
      } as never,
      metrics
    );

    const result = await service.resolve({
      channel: "telegram",
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1",
      messageId: "msg-1",
      workspaceId: "workspace-1",
      userMessage: "hello",
      rawAttachments: [
        {
          buffer: Buffer.from([0xff, 0xd8, 0xff]),
          mime: "image/jpeg",
          originalFilename: "photo.jpg",
          source: "telegram_download"
        }
      ]
    });

    assert.deepEqual(result.attachments, []);
    assert.match(result.enrichedMessage, /Attachment processing notes:/);
    assert.match(result.enrichedMessage, /Media storage full: 0 MB used out of 0 MB\./);
    assert.match(result.enrichedMessage, /hello/);
    assert.equal(registerCalls, 0);
    assert.deepEqual(deletedStoragePaths, [sharedObjectKey]);
    assert.deepEqual(releasedBytes, [BigInt(5)]);
    const failureSeries = metrics
      .getSnapshot()
      .mediaStageSeries.find(
        (series) =>
          series.key.stage === "inbound_resolve" &&
          series.key.channel === "telegram" &&
          series.key.outcome === "failure"
      );
    assert.equal(failureSeries?.count, 1);
  });

  test("generates image thumbnail path and saves derivative after primary upload", async () => {
    const savedObjectKeys: string[] = [];
    let registerInput: Record<string, unknown> | null = null;
    const storagePath = "/workspace/input/photo.jpg";
    const thumbBuffer = Buffer.from("thumb");

    const attachment: AssistantChatMessageAttachment = {
      id: "attachment-1",
      messageId: "msg-1",
      chatId: "chat-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      attachmentType: "image",
      storagePath,
      thumbnailStoragePath: `${storagePath}.thumb.webp`,
      posterStoragePath: null,
      originalFilename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(12),
      durationMs: null,
      width: 100,
      height: 100,
      processingStatus: "ready",
      transcription: null,
      billingFacts: null,
      metadata: null,
      clientTurnId: null,
      clientAttachmentId: null,
      createdAt: new Date("2026-06-24T00:00:00.000Z")
    };

    const service = new InboundMediaService(
      {
        async create() {
          throw new Error("create should not be called directly");
        },
        async findById() {
          return attachment;
        }
      } as never,
      {
        async process(buffer: Buffer, mime: string) {
          return {
            normalizedBuffer: buffer,
            normalizedMime: mime,
            normalizedExtension: "jpg",
            transcription: null,
            textExtract: null,
            durationMs: null,
            width: 100,
            height: 100
          };
        },
        async createImageThumbnail() {
          return {
            buffer: thumbBuffer,
            mimeType: "image/webp",
            width: 64,
            height: 64
          };
        },
        async createVideoPoster() {
          throw new Error("createVideoPoster should not run for images");
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
          return `workspaces/${input.workspaceId}${input.workspaceRelPath}`;
        },
        async saveObject(input: { objectKey: string }) {
          savedObjectKeys.push(input.objectKey);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.objectKey.endsWith(".thumb.webp") ? 4 : 12,
            mimeType: input.objectKey.endsWith(".thumb.webp") ? "image/webp" : "image/jpeg"
          };
        },
        async deleteObject() {}
      } as never,
      {
        async recordMediaUpload() {
          return {
            appliedDelta: BigInt(12),
            capped: false,
            state: {
              id: "state-1",
              workspaceId: "workspace-1",
              tokenBudgetUsed: BigInt(0),
              tokenBudgetLimit: null,
              costOrTokenDrivingToolClassUnitsUsed: 0,
              costOrTokenDrivingToolClassUnitsLimit: null,
              activeWebChatsCurrent: 0,
              activeWebChatsLimit: null,
              mediaStorageBytesUsed: BigInt(12),
              mediaStorageBytesLimit: null,
              lastComputedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date()
            }
          };
        },
        async releaseMediaStorage() {
          throw new Error("releaseMediaStorage should not run");
        }
      } as never,
      {
        async execute(input: Record<string, unknown>) {
          registerInput = input;
          return { attachmentId: "attachment-1", storagePath };
        }
      } as never,
      {
        async get() {
          return null;
        }
      } as never,
      new PlatformHttpMetricsService()
    );

    const result = await service.resolve({
      channel: "web",
      assistantId: "assistant-1",
      userId: "user-1",
      chatId: "chat-1",
      messageId: "msg-1",
      workspaceId: "workspace-1",
      userMessage: "photo",
      rawAttachments: [
        {
          buffer: Buffer.from([0xff, 0xd8, 0xff]),
          mime: "image/jpeg",
          originalFilename: "photo.jpg",
          source: "web_staged_upload"
        }
      ]
    });

    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0]?.thumbnailStoragePath, `${storagePath}.thumb.webp`);
    assert.equal(registerInput?.thumbnailStoragePath, `${storagePath}.thumb.webp`);
    assert.equal(registerInput?.posterStoragePath, null);
    assert.deepEqual(savedObjectKeys, [
      `workspaces/workspace-1${storagePath}`,
      `workspaces/workspace-1${storagePath}.thumb.webp`
    ]);
  });
});
