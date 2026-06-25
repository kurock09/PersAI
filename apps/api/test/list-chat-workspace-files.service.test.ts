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
      storagePath: "/workspace/input/photo.jpg",
      thumbnailStoragePath: "/workspace/input/photo.jpg.thumb.webp",
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
      storagePath: "/workspace/input/note.webm",
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
      storagePath: "/workspace/outbound/self/clip.mp4",
      thumbnailStoragePath: null,
      posterStoragePath: "/workspace/outbound/self/clip.mp4.poster.jpg",
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
      path: "/workspace/input/photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: BigInt(1200),
      createdAt: new Date("2026-06-20T10:00:00.000Z"),
      updatedAt: new Date("2026-06-20T10:00:00.000Z")
    },
    {
      path: "/workspace/input/note.webm",
      mimeType: "audio/webm",
      sizeBytes: BigInt(900),
      createdAt: new Date("2026-06-21T10:00:00.000Z"),
      updatedAt: new Date("2026-06-21T10:00:00.000Z")
    },
    {
      path: "/workspace/outbound/self/clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(5000),
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    },
    {
      path: "/workspace/outbound/self/report.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      createdAt: new Date("2026-06-23T10:00:00.000Z"),
      updatedAt: new Date("2026-06-23T10:00:00.000Z")
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

  const all = await service.execute({ userId: "user-1", chatId: "chat-1" });
  // image + video + orphan document (voice is filtered, external-download skipped).
  assert.equal(all.files.length, 3);
  const orphan = all.files.find((file) => file.storagePath.endsWith("report.pdf"));
  assert.ok(orphan, "expected orphan PDF tile from manifest with no attachment");
  assert.equal(orphan?.chatId, null);
  assert.equal(orphan?.messageId, null);
  assert.equal(orphan?.attachmentType, "document");
  assert.equal(orphan?.originalFilename, "report.pdf");

  const attached = all.files.find((file) => file.storagePath === "/workspace/input/photo.jpg");
  assert.ok(attached);
  assert.equal(attached?.chatId, "chat-1");
  assert.equal(attached?.messageId, "msg-1");
  assert.equal(attached?.thumbnailStoragePath, "/workspace/input/photo.jpg.thumb.webp");

  assert.equal(
    all.files.some((file) => file.storagePath.includes("note.webm")),
    false,
    "voice-note attachments must be filtered out"
  );
  assert.equal(
    all.files.some((file) => file.storagePath.startsWith("external-download/")),
    false,
    "external-download manifest entries must be filtered out"
  );

  const images = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    type: "image"
  });
  assert.equal(images.files.length, 1);
  assert.equal(images.files[0]?.thumbnailStoragePath, "/workspace/input/photo.jpg.thumb.webp");

  const documents = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    type: "document"
  });
  assert.equal(documents.files.length, 1);
  assert.equal(documents.files[0]?.chatId, null);
  assert.equal(documents.files[0]?.storagePath, "/workspace/outbound/self/report.pdf");

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
  assert.notEqual(pageTwo.nextCursor, null);

  const pageThree = await service.execute({
    userId: "user-1",
    chatId: "chat-1",
    limit: 1,
    cursor: pageTwo.nextCursor
  });
  assert.equal(pageThree.files.length, 1);
  assert.equal(pageThree.nextCursor, null);
}

void run();
