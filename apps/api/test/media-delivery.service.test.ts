import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { MediaDeliveryService } from "../src/modules/workspace-management/application/media/media-delivery.service";
import type { AssistantChatMessageAttachment } from "../src/modules/workspace-management/domain/assistant-chat-message-attachment.entity";

function createAttachment(
  overrides: Partial<AssistantChatMessageAttachment>
): AssistantChatMessageAttachment {
  return {
    id: "att-1",
    messageId: "msg-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    assistantFileId: null,
    attachmentType: "document",
    storagePath: "chat/out.bin",
    originalFilename: "out.bin",
    mimeType: "application/octet-stream",
    sizeBytes: BigInt(1),
    durationMs: null,
    width: null,
    height: null,
    processingStatus: "ready",
    transcription: null,
    metadata: null,
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    ...overrides
  };
}

const fakeAssistantFileRegistry = {
  async ensureAttachmentFile(input: { sourceAttachmentId: string }) {
    return { fileRef: `file-${input.sourceAttachmentId}` };
  }
};

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let uploadCalls = 0;
  let createCalls = 0;
  const blockedMetrics = new PlatformHttpMetricsService();

  const blockedService = new MediaDeliveryService(
    {
      async create() {
        createCalls += 1;
        return createAttachment({});
      }
    } as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/blocked.js";
      },
      async saveObject() {
        uploadCalls += 1;
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/blocked.js",
          sizeBytes: 19,
          mimeType: "text/javascript"
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    blockedMetrics
  );

  globalThis.fetch = async () =>
    new Response(Buffer.from("console.log('x');"), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });
  const blocked = await blockedService.deliver({
    artifacts: [
      {
        source: "runtime_url",
        url: "https://media.example/reports/payload.js",
        type: "document"
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.deepEqual(blocked.attachments, []);
  assert.equal(uploadCalls, 0);
  assert.equal(createCalls, 0);
  const blockedSeries = blockedMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "failure"
    );
  assert.equal(blockedSeries?.count, 1);

  let uploadedMime: string | null = null;
  const safeMetrics = new PlatformHttpMetricsService();
  const safeService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/render.png";
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        uploadedMime = input.mimeType;
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/render.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      }
    } as never,
    fakeAssistantFileRegistry as never,
    safeMetrics
  );

  globalThis.fetch = async () =>
    new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });
  const delivered = await safeService.deliver({
    artifacts: [
      {
        source: "runtime_url",
        url: "https://media.example/images/render.png",
        type: "image"
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(uploadedMime, "image/png");
  assert.equal(delivered.attachments.length, 1);
  assert.equal(delivered.attachments[0]?.fileRef, "file-att-1");
  assert.equal(delivered.attachments[0]?.mimeType, "image/png");
  assert.equal(delivered.attachments[0]?.originalFilename, "render.png");
  const successSeries = safeMetrics
    .getSnapshot()
    .mediaStageSeries.find(
      (series) =>
        series.key.stage === "delivery_persist" &&
        series.key.channel === "web" &&
        series.key.outcome === "success"
    );
  assert.equal(successSeries?.count, 1);

  let objectDownloadCalls = 0;
  let deletedObjectKey: string | null = null;
  const nativeMetrics = new PlatformHttpMetricsService();
  const nativeService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated.png";
      },
      async downloadObject(objectKey: string) {
        objectDownloadCalls += 1;
        assert.equal(objectKey, "assistant-media/runtime-output/generated.png");
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/generated.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject(objectKey: string) {
        deletedObjectKey = objectKey;
      }
    } as never,
    fakeAssistantFileRegistry as never,
    nativeMetrics
  );

  const nativeDelivered = await nativeService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/generated.png",
        type: "image",
        mimeType: "image/png",
        filename: "generated.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(objectDownloadCalls, 1);
  assert.equal(deletedObjectKey, "assistant-media/runtime-output/generated.png");
  assert.equal(nativeDelivered.attachments.length, 1);
  assert.equal(nativeDelivered.attachments[0]?.originalFilename, "generated.png");

  let persistedAttachmentDeletedObjectKey: string | null = null;
  const persistedAttachmentService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    [],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/copied.png";
      },
      async downloadObject(objectKey: string) {
        assert.equal(
          objectKey,
          "assistant-media/assistants/assistant-1/chats/chat-older/messages/msg-older/original.png"
        );
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/copied.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject(objectKey: string) {
        persistedAttachmentDeletedObjectKey = objectKey;
      }
    } as never,
    fakeAssistantFileRegistry as never,
    new PlatformHttpMetricsService()
  );

  const persistedAttachmentDelivered = await persistedAttachmentService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey:
          "assistant-media/assistants/assistant-1/chats/chat-older/messages/msg-older/original.png",
        type: "image",
        mimeType: "image/png",
        filename: "original.png",
        sizeBytes: 9
      }
    ],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(persistedAttachmentDeletedObjectKey, null);
  assert.equal(persistedAttachmentDelivered.attachments.length, 1);
  assert.equal(persistedAttachmentDelivered.attachments[0]?.originalFilename, "original.png");

  let adapterTarget: {
    channel: string;
    chatId: string | number;
    metadata?: Record<string, unknown>;
  } | null = null;
  let adapterCaption: string | undefined;
  const adapterService = new MediaDeliveryService(
    {
      async create(input: {
        storagePath: string;
        originalFilename: string | null;
        mimeType: string;
        sizeBytes: bigint;
      }) {
        return createAttachment({
          storagePath: input.storagePath,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes
        });
      }
    } as never,
    [
      {
        channel: "telegram",
        async sendImage(target, _buffer, _filename, caption) {
          adapterTarget = target;
          adapterCaption = caption;
        },
        async sendVoice() {},
        async sendAudio() {},
        async sendDocument() {},
        async sendVideo() {}
      }
    ],
    {
      buildChatMessageObjectKey() {
        return "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/telegram.png";
      },
      async downloadObject(objectKey: string) {
        assert.equal(objectKey, "assistant-media/runtime-output/telegram.png");
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "image/png"
        };
      },
      async saveObject(input: { mimeType: string; buffer: Buffer }) {
        return {
          objectKey:
            "assistant-media/assistants/assistant-1/chats/chat-1/messages/msg-1/telegram.png",
          sizeBytes: input.buffer.length,
          mimeType: input.mimeType
        };
      },
      async deleteObject() {}
    } as never,
    fakeAssistantFileRegistry as never,
    new PlatformHttpMetricsService()
  );

  await adapterService.deliver({
    artifacts: [
      {
        source: "persai_object_storage",
        objectKey: "assistant-media/runtime-output/telegram.png",
        type: "image",
        mimeType: "image/png",
        filename: "telegram.png",
        sizeBytes: 9,
        caption: "Runtime caption"
      }
    ],
    channel: "telegram",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1",
    channelTarget: {
      channel: "telegram",
      chatId: "tg-chat-1",
      metadata: {
        botToken: "bot-token"
      }
    }
  });

  assert.deepEqual(adapterTarget, {
    channel: "telegram",
    chatId: "tg-chat-1",
    metadata: {
      botToken: "bot-token"
    }
  });
  assert.equal(adapterCaption, "Runtime caption");
  globalThis.fetch = originalFetch;
}

void run();
