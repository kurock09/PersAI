import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AttachmentObjectAvailabilityService } from "../src/modules/workspace-management/application/media/attachment-object-availability.service";
import type { AssistantChatMessageAttachment } from "../src/modules/workspace-management/domain/assistant-chat-message-attachment.entity";

function createAttachment(
  overrides: Partial<AssistantChatMessageAttachment> = {}
): AssistantChatMessageAttachment {
  return {
    id: "attachment-1",
    messageId: "message-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    attachmentType: "image",
    storagePath: "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-1/image.png",
    originalFilename: "image.png",
    mimeType: "image/png",
    sizeBytes: 128n,
    durationMs: null,
    width: null,
    height: null,
    processingStatus: "ready",
    transcription: null,
    metadata: null,
    clientTurnId: null,
    clientAttachmentId: null,
    createdAt: new Date("2026-04-30T10:00:00.000Z"),
    ...overrides
  };
}

describe("AttachmentObjectAvailabilityService", () => {
  test("passes when every ready attachment object exists", async () => {
    const checkedKeys: string[] = [];
    const service = new AttachmentObjectAvailabilityService({
      existsObject: async (objectKey: string) => {
        checkedKeys.push(objectKey);
        return true;
      }
    } as never);

    await service.assertRuntimeReadable({
      assistantId: "assistant-1",
      chatId: "chat-1",
      messageId: "message-1",
      channel: "telegram",
      attachments: [createAttachment()]
    });

    assert.deepEqual(checkedKeys, [
      "assistant-media/assistants/assistant-1/chats/chat-1/messages/message-1/image.png"
    ]);
  });

  test("fails before runtime when a ready attachment object is missing", async () => {
    const service = new AttachmentObjectAvailabilityService({
      existsObject: async () => false
    } as never);

    await assert.rejects(
      () =>
        service.assertRuntimeReadable({
          assistantId: "assistant-1",
          chatId: "chat-1",
          messageId: "message-1",
          channel: "web",
          attachments: [createAttachment()]
        }),
      (error) => {
        const row = error as {
          errorObject?: { code?: string; details?: Record<string, unknown> };
        };
        assert.equal(row.errorObject?.code, "attachment_object_unavailable");
        assert.deepEqual(row.errorObject?.details?.attachmentIds, ["attachment-1"]);
        return true;
      }
    );
  });
});
