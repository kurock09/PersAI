import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { MediaDeliveryService } from "../src/modules/workspace-management/application/media/media-delivery.service";
import type { AssistantChatMessageAttachment } from "../src/modules/workspace-management/domain/assistant-chat-message-attachment.entity";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";
const POSTER_PATH = `${SESSION_ROOT}/video.mp4.poster.jpg`;

function createAttachment(): AssistantChatMessageAttachment {
  return {
    id: "att-video-1",
    messageId: "msg-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    attachmentType: "video",
    storagePath: `${SESSION_ROOT}/video.mp4`,
    thumbnailStoragePath: null,
    posterStoragePath: POSTER_PATH,
    originalFilename: "video.mp4",
    mimeType: "video/mp4",
    sizeBytes: BigInt(39_500_000),
    durationMs: 12_000,
    width: 1280,
    height: 720,
    processingStatus: "ready",
    transcription: null,
    billingFacts: null,
    metadata: null,
    createdAt: new Date("2026-07-05T00:00:00.000Z")
  };
}

test("previewChatFileByPath resolves poster derivatives via parent attachment row", async () => {
  const attachment = createAttachment();
  let downloadedPath: string | null = null;
  const service = new MediaDeliveryService(
    {
      async findByChatIdAndStoragePath() {
        return null;
      },
      async findByChatIdAndDerivativeStoragePath(input: { storagePath: string }) {
        return input.storagePath === POSTER_PATH ? attachment : null;
      }
    } as never,
    {} as never,
    [],
    {
      buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }) {
        return `workspaces/${input.workspaceId}/${input.workspaceRelPath}`;
      },
      async downloadObject(objectKey: string) {
        downloadedPath = objectKey;
        return {
          buffer: Buffer.from("poster-bytes"),
          contentType: "image/jpeg"
        };
      }
    } as never,
    {} as never,
    {
      async get() {
        return null;
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  const result = await service.previewChatFileByPath({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    path: POSTER_PATH
  });

  assert.equal(downloadedPath, `workspaces/workspace-1/${POSTER_PATH}`);
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.originalFilename, "video.mp4.poster.jpg");
});

test("previewChatFileByPath still rejects unknown derivative paths", async () => {
  const service = new MediaDeliveryService(
    {
      async findByChatIdAndStoragePath() {
        return null;
      },
      async findByChatIdAndDerivativeStoragePath() {
        return null;
      }
    } as never,
    {} as never,
    [],
    {
      buildWorkspaceObjectKey() {
        return "unused";
      },
      async downloadObject() {
        return null;
      }
    } as never,
    {} as never,
    {
      async get() {
        return null;
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    () =>
      service.previewChatFileByPath({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        path: `${SESSION_ROOT}/missing.poster.jpg`
      }),
    NotFoundException
  );
});
