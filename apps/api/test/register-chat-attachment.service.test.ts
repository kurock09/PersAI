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
      { findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const }) } as never
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
      { findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const }) } as never
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
    assert.equal(upsertInput?.originChatId, "chat-1");
    assert.equal(upsertInput?.originAssistantId, "assistant-1");
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
            status: "ready" as const,
            link: {
              docId: "doc-registered-1",
              versionId: "version-registered-1",
              versionNumber: 4,
              descriptorMode: "create_document",
              documentType: "workspace_document",
              outputFormat: "xlsx",
              documentStatus: "ready",
              versionStatus: "ready",
              outputPath: "/workspace/report.xlsx",
              workspaceProjectPath: "/workspace/report-project",
              projectManifestPath: "/workspace/report-project/project.json",
              projectSourcePath: "/workspace/report-project/source/source.xlsx",
              sourceKind: "imported_workspace_file",
              sourcePath: "/workspace/source.xlsx",
              sourceFormat: "xlsx",
              sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
            }
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
          documentLink?: {
            sourceKind?: string;
            sourceFormat?: string;
            projectManifestPath?: string;
            projectSourcePath?: string;
            inspectionSummary?: { counts?: { sheetCount?: number } };
          };
        }
      )?.documentLink?.inspectionSummary?.counts?.sheetCount,
      3
    );
    assert.equal(
      (
        createdInput?.metadata as {
          documentLink?: { projectManifestPath?: string; sourceKind?: string };
        }
      )?.documentLink?.projectManifestPath,
      "/workspace/report-project/project.json"
    );
    assert.equal(
      (
        createdInput?.metadata as {
          documentLink?: { projectSourcePath?: string };
        }
      )?.documentLink?.projectSourcePath,
      "/workspace/report-project/source/source.xlsx"
    );
    assert.equal(
      (createdInput?.metadata as { documentLink?: { sourceKind?: string; sourceFormat?: string } })
        ?.documentLink?.sourceKind,
      "imported_workspace_file"
    );
    assert.equal(
      (createdInput?.metadata as { documentLink?: { sourceKind?: string; sourceFormat?: string } })
        ?.documentLink?.sourceFormat,
      "xlsx"
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
      { findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const }) } as never
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
      { findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const }) } as never
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

  test("auto-registers files.attach for project-owned document outputs without a registered current version", async () => {
    let createdInput: Record<string, unknown> | null = null;
    const documentLink = {
      docId: "doc-auto-1",
      versionId: "version-auto-1",
      versionNumber: 1,
      descriptorMode: "create_document",
      documentType: "workspace_document",
      outputFormat: "pdf",
      documentStatus: "ready",
      versionStatus: "ready",
      outputPath: "/workspace/projects/report/output/report.pdf",
      workspaceProjectPath: "/workspace/projects/report",
      projectManifestPath: "/workspace/projects/report/project.json",
      projectSourcePath: "/workspace/projects/report/source/report.docx",
      sourceKind: "imported_workspace_file",
      sourcePath: "/workspace/report.docx",
      sourceFormat: "docx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sourceManifestPath: "/workspace/projects/report/extract/manifest.json",
      inspectionPath: "/workspace/projects/report/output/report.inspect.json",
      inspectionSummary: {
        format: "pdf",
        counts: {
          pageCount: 3,
          sheetCount: null,
          formulaCount: null,
          blankSheetCount: null,
          paragraphCount: null,
          headingCount: null,
          tableCount: null,
          textCharCount: 1800
        },
        warnings: []
      },
      isCurrentOutput: true
    };
    const lookupCalls: string[] = [];
    let inspectInput: Record<string, unknown> | null = null;
    let registerInput: Record<string, unknown> | null = null;
    const service = new RegisterChatAttachmentService(
      {
        assistantChat: {
          findFirst: async () => ({
            id: "chat-1",
            surface: "web",
            surfaceThreadKey: "web-thread-1"
          })
        }
      } as never,
      {
        create: async (input: Record<string, unknown>) => {
          createdInput = input;
          return {
            id: "attachment-auto-1",
            storagePath: input.storagePath,
            attachmentType: input.attachmentType,
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            processingStatus: input.processingStatus,
            metadata: input.metadata,
            createdAt: new Date("2026-07-02T00:00:00.000Z")
          };
        }
      } as never,
      {
        async get(input: { path: string }) {
          if (
            input.path === "/workspace/projects/report/project.json" ||
            input.path === "/workspace/projects/report/output/report.pdf"
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: "application/json",
              sizeBytes: BigInt(64),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        upsert: async () => {}
      } as never,
      {
        async findCurrentDocumentLinkByOutputPath(input: { outputPath: string }) {
          lookupCalls.push(input.outputPath);
          return lookupCalls.length === 1
            ? ({ status: "none" as const } as const)
            : ({ status: "ready" as const, link: documentLink } as const);
        }
      } as never,
      {
        async execute(input: Record<string, unknown>) {
          inspectInput = input;
          return {
            accepted: true,
            sourcePath: "/workspace/projects/report/output/report.pdf",
            inspectPath: "/workspace/projects/report/output/report.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 3,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: null,
              headingCount: null,
              tableCount: null,
              textCharCount: 1800
            },
            warnings: [],
            suggestedReadPaths: ["/workspace/projects/report/output/report.inspect.json"],
            comparison: null
          };
        }
      } as never,
      {
        async execute(input: Record<string, unknown>) {
          registerInput = input;
          return {
            accepted: true,
            docId: "doc-auto-1",
            versionId: "version-auto-1",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: "/workspace/projects/report/output/report.pdf",
            workspaceProjectPath: "/workspace/projects/report",
            sourceManifestPath: "/workspace/projects/report/extract/manifest.json",
            inspectionPath: "/workspace/projects/report/output/report.inspect.json"
          };
        }
      } as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: "/workspace/projects/report/output/report.pdf",
      attachmentType: "document",
      mimeType: "application/pdf",
      sizeBytes: 128,
      originalFilename: "report.pdf",
      kind: "files.attach"
    });

    assert.equal(result.attachmentId, "attachment-auto-1");
    assert.equal(lookupCalls.length, 2);
    assert.equal(inspectInput?.path, "/workspace/projects/report/output/report.pdf");
    assert.equal(registerInput?.workspaceProjectPath, "/workspace/projects/report");
    assert.equal(
      registerInput?.inspectionPath,
      "/workspace/projects/report/output/report.inspect.json"
    );
    assert.equal(
      (
        createdInput?.metadata as {
          documentLink?: { outputPath?: string; workspaceProjectPath?: string };
        }
      )?.documentLink?.outputPath,
      "/workspace/projects/report/output/report.pdf"
    );
    assert.equal(
      (
        createdInput?.metadata as {
          documentLink?: { outputPath?: string; workspaceProjectPath?: string };
        }
      )?.documentLink?.workspaceProjectPath,
      "/workspace/projects/report"
    );
  });
});
