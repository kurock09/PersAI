import assert from "node:assert/strict";
import { ListChatWorkspaceFilesService } from "../src/modules/workspace-management/application/list-chat-workspace-files.service";

async function run(): Promise<void> {
  const attachments = [
    {
      id: "att-image",
      messageId: "msg-1",
      chatId: "chat-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      attachmentType: "image" as const,
      storagePath: "/shared/input/photo.jpg",
      thumbnailStoragePath: "/shared/input/photo.jpg.thumb.webp",
      posterStoragePath: null,
      originalFilename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready" as const,
      transcription: null,
      billingFactsJson: null,
      metadata: null,
      clientTurnId: null,
      clientAttachmentId: null,
      createdAt: new Date("2026-06-20T10:00:00.000Z")
    },
    {
      id: "att-voice",
      messageId: "msg-2",
      chatId: "chat-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      attachmentType: "voice" as const,
      storagePath: "/shared/input/note.webm",
      thumbnailStoragePath: null,
      posterStoragePath: null,
      originalFilename: "note.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(900),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready" as const,
      transcription: null,
      billingFactsJson: null,
      metadata: { source: "voice_input" },
      clientTurnId: null,
      clientAttachmentId: null,
      createdAt: new Date("2026-06-21T10:00:00.000Z")
    },
    {
      id: "att-video",
      messageId: "msg-3",
      chatId: "chat-2",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      attachmentType: "video" as const,
      storagePath: "/shared/outbound/self/clip.mp4",
      thumbnailStoragePath: null,
      posterStoragePath: "/shared/outbound/self/clip.mp4.poster.jpg",
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(5000),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready" as const,
      transcription: null,
      billingFactsJson: null,
      metadata: null,
      clientTurnId: null,
      clientAttachmentId: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z")
    }
  ];

  const service = new ListChatWorkspaceFilesService(
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return {
          assistant: { id: "assistant-1", workspaceId: "workspace-1" }
        };
      }
    } as never,
    {
      async findChatById(chatId: string) {
        assert.equal(chatId, "chat-1");
        return {
          id: "chat-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          surface: "web"
        };
      }
    } as never,
    {
      assistantChatMessageAttachment: {
        findMany: async () => attachments
      }
    } as never
  );

  const all = await service.execute({ userId: "user-1", chatId: "chat-1" });
  assert.equal(all.files.length, 2);
  assert.equal(all.files[0]?.attachmentType, "video");
  assert.equal(all.files[1]?.attachmentType, "image");
  assert.equal(
    all.files.some((file) => file.storagePath.includes("note.webm")),
    false
  );

  const images = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    type: "image"
  });
  assert.equal(images.files.length, 1);
  assert.equal(images.files[0]?.thumbnailStoragePath, "/shared/input/photo.jpg.thumb.webp");

  const paged = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    limit: 1
  });
  assert.equal(paged.files.length, 1);
  assert.equal(paged.nextCursor, paged.files[0]?.storagePath ?? null);

  const pageTwo = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    limit: 1,
    cursor: paged.nextCursor
  });
  assert.equal(pageTwo.files.length, 1);
  assert.equal(pageTwo.nextCursor, null);
}

void run();
