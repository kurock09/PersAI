import assert from "node:assert/strict";
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

async function run(): Promise<void> {
  let uploadCalls = 0;
  let createCalls = 0;

  const blockedService = new MediaDeliveryService(
    {
      async downloadChatMedia() {
        return {
          buffer: Buffer.from("console.log('x');"),
          contentType: "application/octet-stream"
        };
      },
      async uploadChatMedia() {
        uploadCalls += 1;
        return {
          storagePath: "chat/blocked.js",
          sizeBytes: 19,
          mimeType: "text/javascript"
        };
      }
    } as never,
    {
      async create() {
        createCalls += 1;
        return createAttachment({});
      }
    } as never,
    [],
    {
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never
  );

  const blocked = await blockedService.deliver({
    artifacts: [{ url: "reports/payload.js", type: "document" }],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.deepEqual(blocked.attachments, []);
  assert.equal(uploadCalls, 0);
  assert.equal(createCalls, 0);

  let uploadedMime: string | null = null;
  const safeService = new MediaDeliveryService(
    {
      async downloadChatMedia() {
        return {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
          contentType: "application/octet-stream"
        };
      },
      async uploadChatMedia(_params: {
        assistantId: string;
        runtimeTier: string;
        chatId: string;
        messageId: string;
        fileBuffer: Buffer;
        mimeType: string;
      }) {
        uploadedMime = _params.mimeType;
        return {
          storagePath: "chat/image.png",
          sizeBytes: _params.fileBuffer.length,
          mimeType: _params.mimeType
        };
      }
    } as never,
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
      async resolveByAssistantId() {
        return "free_shared_restricted";
      }
    } as never
  );

  const delivered = await safeService.deliver({
    artifacts: [{ url: "images/render.png", type: "image" }],
    channel: "web",
    assistantId: "assistant-1",
    chatId: "chat-1",
    messageId: "msg-1",
    workspaceId: "workspace-1"
  });

  assert.equal(uploadedMime, "image/png");
  assert.equal(delivered.attachments.length, 1);
  assert.equal(delivered.attachments[0]?.mimeType, "image/png");
  assert.equal(delivered.attachments[0]?.originalFilename, "render.png");
}

void run();
