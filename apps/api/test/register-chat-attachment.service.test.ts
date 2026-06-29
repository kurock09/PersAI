import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RegisterChatAttachmentService } from "../src/modules/workspace-management/application/register-chat-attachment.service";

describe("register-chat-attachment.service", () => {
  test("rejects storage paths outside /workspace/ and /workspace/", async () => {
    const service = new RegisterChatAttachmentService(
      { assistantChat: { findFirst: async () => null } } as never,
      {
        create: async () => {
          throw new Error("should not create");
        }
      } as never,
      { upsert: async () => {} } as never,
      { findCurrentDocumentLinkByOutputPath: async () => null } as never
    );

    await assert.rejects(
      () =>
        service.execute({
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          messageId: "message-1",
          storagePath: "/tmp/evil.txt",
          attachmentType: "document",
          mimeType: "text/plain",
          sizeBytes: 1,
          originalFilename: "evil.txt",
          kind: "user_upload"
        }),
      (error: unknown) => error instanceof BadRequestException
    );
  });

  test("registers attachment and upserts workspace metadata", async () => {
    let createdInput: Record<string, unknown> | null = null;
    let upsertInput: Record<string, unknown> | null = null;

    const service = new RegisterChatAttachmentService(
      { assistantChat: { findFirst: async () => null } } as never,
      {
        create: async (input: Record<string, unknown>) => {
          createdInput = input;
          return {
            id: "attachment-1",
            storagePath: input.storagePath,
            attachmentType: input.attachmentType,
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            processingStatus: input.processingStatus,
            metadata: input.metadata,
            createdAt: new Date("2026-06-23T00:00:00.000Z")
          };
        }
      } as never,
      {
        upsert: async (input: Record<string, unknown>) => {
          upsertInput = input;
        }
      } as never,
      { findCurrentDocumentLinkByOutputPath: async () => null } as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: "/workspace/report.csv",
      attachmentType: "document",
      mimeType: "text/csv",
      sizeBytes: 12,
      originalFilename: "report.csv",
      kind: "user_upload",
      shortDescription: "Quarterly report"
    });

    assert.equal(result.attachmentId, "attachment-1");
    assert.equal(result.storagePath, "/workspace/report.csv");
    assert.equal(createdInput?.storagePath, "/workspace/report.csv");
    assert.equal(createdInput?.processingStatus, "ready");
    assert.deepEqual((createdInput?.metadata as Record<string, unknown>)?.kind, "user_upload");
    assert.equal(upsertInput?.path, "/workspace/report.csv");
    assert.equal(upsertInput?.shortDescription, "Quarterly report");
  });

  test("attaches registered documentLink metadata for files.attach outputs", async () => {
    let createdInput: Record<string, unknown> | null = null;

    const service = new RegisterChatAttachmentService(
      { assistantChat: { findFirst: async () => null } } as never,
      {
        create: async (input: Record<string, unknown>) => {
          createdInput = input;
          return {
            id: "attachment-link-1",
            storagePath: input.storagePath,
            attachmentType: input.attachmentType,
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            processingStatus: input.processingStatus,
            metadata: input.metadata,
            createdAt: new Date("2026-06-29T00:00:00.000Z")
          };
        }
      } as never,
      { upsert: async () => {} } as never,
      {
        async findCurrentDocumentLinkByOutputPath() {
          return {
            docId: "doc-registered-1",
            versionId: "version-registered-1",
            versionNumber: 4,
            descriptorMode: "create_data_document",
            documentType: "data_document",
            outputFormat: "xlsx",
            documentStatus: "ready",
            versionStatus: "ready",
            outputPath: "/workspace/report.xlsx",
            workspaceProjectPath: "/workspace/report-project",
            sourceManifestPath: "/workspace/report-project/manifest.json",
            inspectionPath: "/workspace/report.inspect.json",
            inspectionSummary: {
              format: "xlsx",
              counts: {
                pageCount: null,
                sheetCount: 3,
                formulaCount: 2,
                blankSheetCount: 0,
                paragraphCount: null,
                headingCount: null,
                tableCount: null,
                textCharCount: null
              },
              warnings: []
            },
            isCurrentOutput: true
          };
        }
      } as never
    );

    await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: "/workspace/report.xlsx",
      attachmentType: "document",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 24,
      originalFilename: "report.xlsx",
      kind: "files.attach"
    });

    assert.equal(
      (createdInput?.metadata as { documentLink?: { outputFormat?: string } })?.documentLink
        ?.outputFormat,
      "xlsx"
    );
    assert.equal(
      (
        createdInput?.metadata as {
          documentLink?: { inspectionSummary?: { counts?: { sheetCount?: number } } };
        }
      )?.documentLink?.inspectionSummary?.counts?.sheetCount,
      3
    );
  });

  test("passes thumbnail and poster storage paths to attachment create", async () => {
    let createdInput: Record<string, unknown> | null = null;

    const service = new RegisterChatAttachmentService(
      { assistantChat: { findFirst: async () => null } } as never,
      {
        create: async (input: Record<string, unknown>) => {
          createdInput = input;
          return {
            id: "attachment-2",
            storagePath: input.storagePath,
            thumbnailStoragePath: input.thumbnailStoragePath,
            posterStoragePath: input.posterStoragePath,
            attachmentType: input.attachmentType,
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            processingStatus: input.processingStatus,
            metadata: input.metadata,
            createdAt: new Date("2026-06-24T00:00:00.000Z")
          };
        }
      } as never,
      { upsert: async () => {} } as never,
      { findCurrentDocumentLinkByOutputPath: async () => null } as never
    );

    await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: "/workspace/clip.mp4",
      attachmentType: "video",
      mimeType: "video/mp4",
      sizeBytes: 1024,
      originalFilename: "clip.mp4",
      kind: "user_upload",
      thumbnailStoragePath: "/workspace/photo.jpg.thumb.webp",
      posterStoragePath: "/workspace/clip.mp4.poster.jpg"
    });

    assert.equal(createdInput?.thumbnailStoragePath, "/workspace/photo.jpg.thumb.webp");
    assert.equal(createdInput?.posterStoragePath, "/workspace/clip.mp4.poster.jpg");
  });
  test("runtime attachment with null messageId does not fall back to running attempt userMessageId", async () => {
    const service = new RegisterChatAttachmentService(
      {
        assistantChat: {
          findFirst: async () => ({ id: "chat-1" })
        },
        assistantWebChatTurnAttempt: {
          findFirst: async () => ({ userMessageId: "user-message-1" })
        }
      } as never,
      {
        create: async () => {
          throw new Error("should not create");
        }
      } as never,
      { upsert: async () => {} } as never,
      { findCurrentDocumentLinkByOutputPath: async () => null } as never
    );

    await assert.rejects(
      () =>
        service.executeFromRuntime({
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          channel: "web",
          externalThreadKey: "web-thread-1",
          messageId: null,
          storagePath: "/workspace/report.csv",
          attachmentType: "document",
          mimeType: "text/csv",
          sizeBytes: 12,
          originalFilename: "report.csv",
          kind: "files.attach"
        }),
      (error: unknown) =>
        error instanceof NotFoundException && error.message === "chat_message_not_found"
    );
  });
});
