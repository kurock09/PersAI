import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { InboundMediaService } from "../src/modules/workspace-management/application/media/inbound-media.service";

async function run(): Promise<void> {
  const deletedStoragePaths: string[] = [];
  const releasedBytes: bigint[] = [];
  let attachmentCreated = false;
  const metrics = new PlatformHttpMetricsService();

  const service = new InboundMediaService(
    {
      async uploadChatMedia() {
        return {
          storagePath: "chat-1/msg-1/photo.jpg",
          sizeBytes: 12,
          mimeType: "image/jpeg"
        };
      },
      async deleteChatMedia(_assistantId: string, storagePath: string) {
        deletedStoragePaths.push(storagePath);
      }
    } as never,
    {
      async create() {
        attachmentCreated = true;
        throw new Error("attachment must not be created after capped media apply");
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
      }
    } as never,
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
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
  assert.match(result.enrichedMessage, /media storage limit was reached/i);
  assert.match(result.enrichedMessage, /hello/);
  assert.equal(result.systemNotices.length, 1);
  assert.match(result.systemNotices[0]!, /Media storage/i);
  assert.equal(attachmentCreated, false);
  assert.deepEqual(deletedStoragePaths, ["chat-1/msg-1/photo.jpg"]);
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
}

void run();
