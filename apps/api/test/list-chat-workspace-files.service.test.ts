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
      attachmentType: "image",
      storagePath: "/workspace/photo.jpg",
      thumbnailStoragePath: "/workspace/photo.jpg.thumb.webp",
      posterStoragePath: null,
      originalFilename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
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
      attachmentType: "voice",
      storagePath: "/workspace/note.webm",
      thumbnailStoragePath: null,
      posterStoragePath: null,
      originalFilename: "note.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(900),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
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
      attachmentType: "video",
      storagePath: "/workspace/clip.mp4",
      thumbnailStoragePath: null,
      posterStoragePath: "/workspace/clip.mp4.poster.jpg",
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(5000),
      durationMs: null,
      width: null,
      height: null,
      processingStatus: "ready",
      transcription: null,
      billingFactsJson: null,
      metadata: null,
      clientTurnId: null,
      clientAttachmentId: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z")
    }
  ];

  // ADR-127 W1 — manifest entries: every storagePath above plus an orphan
  // row for a model-written file with no attachment row, plus an external
  // download that the gallery must skip.
  const manifest = [
    {
      path: "/workspace/photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      createdAt: new Date("2026-06-20T10:00:00.000Z"),
      updatedAt: new Date("2026-06-20T10:00:00.000Z")
    },
    {
      path: "/workspace/note.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(900),
      createdAt: new Date("2026-06-21T10:00:00.000Z"),
      updatedAt: new Date("2026-06-21T10:00:00.000Z")
    },
    {
      path: "/workspace/clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(5000),
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    },
    {
      path: "/workspace/report.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      createdAt: new Date("2026-06-23T10:00:00.000Z"),
      updatedAt: new Date("2026-06-23T10:00:00.000Z"),
      originChatId: "chat-1"
    },
    {
      // External-download bytes are tracked in the manifest but excluded
      // from the gallery; the prefix check matches the literal storage
      // path written by media-delivery (no leading slash).
      path: "external-download/messages/msg-99",
      mimeType: "application/octet-stream",
      sizeBytes: BigInt(10),
      createdAt: new Date("2026-06-24T10:00:00.000Z"),
      updatedAt: new Date("2026-06-24T10:00:00.000Z")
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
      workspaceFileMetadata: {
        findMany: async () => manifest
      },
      assistantChatMessageAttachment: {
        findMany: async () => attachments
      }
    } as never
  );

  const chatScoped = await service.execute({ userId: "user-1", chatId: "chat-1" });
  // chat scope: image + session-origin orphan document (voice filtered, other-chat video excluded).
  assert.equal(chatScoped.files.length, 2);
  const orphan = chatScoped.files.find((file) => file.storagePath.endsWith("report.pdf"));
  assert.ok(orphan, "expected orphan PDF tile from manifest with no attachment");
  assert.equal(orphan?.chatId, "chat-1");
  assert.equal(orphan?.messageId, null);
  assert.equal(orphan?.attachmentType, "document");
  assert.equal(orphan?.originalFilename, "report.pdf");

  const attached = chatScoped.files.find((file) => file.storagePath === "/workspace/photo.jpg");
  assert.ok(attached);
  assert.equal(attached?.chatId, "chat-1");
  assert.equal(attached?.messageId, "msg-1");
  assert.equal(attached?.thumbnailStoragePath, "/workspace/photo.jpg.thumb.webp");

  assert.equal(
    chatScoped.files.some((file) => file.storagePath.includes("note.webm")),
    false,
    "voice-note attachments must be filtered out"
  );
  assert.equal(
    chatScoped.files.some((file) => file.storagePath.startsWith("external-download/")),
    false,
    "external-download manifest entries must be filtered out"
  );
  assert.equal(
    chatScoped.files.some((file) => file.storagePath === "/workspace/clip.mp4"),
    false,
    "other-chat attachments must be excluded from chat scope"
  );

  const workspaceScoped = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    scope: "workspace"
  });
  assert.equal(workspaceScoped.files.length, 3);

  const images = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    type: "image"
  });
  assert.equal(images.files.length, 1);
  assert.equal(images.files[0]?.thumbnailStoragePath, "/workspace/photo.jpg.thumb.webp");

  const documents = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    type: "document"
  });
  assert.equal(documents.files.length, 1);
  assert.equal(documents.files[0]?.chatId, "chat-1");
  assert.equal(documents.files[0]?.storagePath, "/workspace/report.pdf");

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
