import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RegisterChatAttachmentService } from "../src/modules/workspace-management/application/register-chat-attachment.service";

function createWorkspaceMetadata(path: string, mimeType = "application/pdf") {
  return {
    workspaceId: "workspace-1",
    path,
    mimeType,
    sizeBytes: BigInt(64),
    contentHash: null,
    shortDescription: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function createDocumentLink(input: {
  path: string;
  format: "pdf" | "docx" | "xlsx";
  versionNumber: number;
  docId?: string;
  versionId?: string;
  workspaceProjectPath?: string;
}) {
  const basePath = input.path.replace(/\.(pdf|docx|xlsx)$/i, "");
  return {
    docId: input.docId ?? "doc-auto-1",
    versionId: input.versionId ?? `version-${input.versionNumber}`,
    versionNumber: input.versionNumber,
    descriptorMode: input.versionNumber === 1 ? "create_document" : "revise_document",
    documentType: "workspace_document",
    outputFormat: input.format,
    documentStatus: "ready",
    versionStatus: "ready",
    outputPath: input.path,
    workspaceProjectPath: input.workspaceProjectPath ?? "/workspace",
    projectManifestPath: `${input.workspaceProjectPath ?? "/workspace"}/project.json`,
    projectSourcePath: null,
    sourceKind: "authored_workspace_project",
    sourcePath: `${basePath}.md`,
    sourceFormat: "md",
    sourceMimeType: "text/markdown",
    sourceManifestPath: null,
    inspectionPath: `${basePath}.inspect.json`,
    inspectionSummary: {
      format: input.format,
      counts: {
        pageCount: input.format === "pdf" ? 1 : null,
        sheetCount: input.format === "xlsx" ? 1 : null,
        formulaCount: input.format === "xlsx" ? 0 : null,
        blankSheetCount: input.format === "xlsx" ? 0 : null,
        paragraphCount: input.format === "docx" ? 1 : null,
        headingCount: input.format === "docx" ? 1 : null,
        tableCount: null,
        textCharCount: input.format === "pdf" || input.format === "docx" ? 120 : null
      },
      warnings: []
    },
    isCurrentOutput: true
  };
}

function createAttachmentRepository(createdInputs: Record<string, unknown>[]) {
  return {
    create: async (input: Record<string, unknown>) => {
      createdInputs.push(input);
      return {
        id: `attachment-${createdInputs.length}`,
        storagePath: input.storagePath,
        thumbnailStoragePath: input.thumbnailStoragePath,
        posterStoragePath: input.posterStoragePath,
        attachmentType: input.attachmentType,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        processingStatus: input.processingStatus,
        metadata: input.metadata,
        createdAt: new Date("2026-07-02T00:00:00.000Z")
      };
    }
  };
}

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

  test("auto-registers files.attach for pdf, docx, and xlsx without an existing document row", async () => {
    const cases = [
      {
        format: "pdf" as const,
        path: "/workspace/report.pdf",
        mimeType: "application/pdf"
      },
      {
        format: "docx" as const,
        path: "/workspace/report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      {
        format: "xlsx" as const,
        path: "/workspace/report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ];

    for (const testCase of cases) {
      const createdInputs: Record<string, unknown>[] = [];
      let inspectInput: Record<string, unknown> | null = null;
      let registerInput: Record<string, unknown> | null = null;
      let lookupCount = 0;
      const readyLink = createDocumentLink({
        path: testCase.path,
        format: testCase.format,
        versionNumber: 1
      });

      const service = new RegisterChatAttachmentService(
        {
          assistantChat: {
            findFirst: async () => ({
              id: "chat-1",
              surface: "web",
              surfaceThreadKey: "web-thread-1"
            })
          },
          assistantDocument: {
            findFirst: async () => null
          }
        } as never,
        createAttachmentRepository(createdInputs) as never,
        {
          async get(input: { path: string }) {
            return input.path === testCase.path
              ? createWorkspaceMetadata(input.path, testCase.mimeType)
              : null;
          },
          upsert: async () => {}
        } as never,
        {
          async findCurrentDocumentLinkByOutputPath() {
            lookupCount += 1;
            return lookupCount === 1
              ? ({ status: "none" as const } as const)
              : ({ status: "ready" as const, link: readyLink } as const);
          }
        } as never,
        {
          async execute(input: Record<string, unknown>) {
            inspectInput = input;
            return {
              accepted: true,
              sourcePath: testCase.path,
              inspectPath: testCase.path.replace(/\.(pdf|docx|xlsx)$/i, ".inspect.json"),
              format: testCase.format,
              counts: {
                pageCount: testCase.format === "pdf" ? 1 : null,
                sheetCount: testCase.format === "xlsx" ? 1 : null,
                formulaCount: testCase.format === "xlsx" ? 0 : null,
                blankSheetCount: testCase.format === "xlsx" ? 0 : null,
                paragraphCount: testCase.format === "docx" ? 1 : null,
                headingCount: testCase.format === "docx" ? 1 : null,
                tableCount: null,
                textCharCount: testCase.format === "pdf" || testCase.format === "docx" ? 120 : null
              },
              warnings: [],
              suggestedReadPaths: [],
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
              outputFormat: testCase.format,
              outputPath: testCase.path,
              workspaceProjectPath: "/workspace",
              sourceManifestPath: null,
              inspectionPath: testCase.path.replace(/\.(pdf|docx|xlsx)$/i, ".inspect.json")
            };
          }
        } as never
      );

      const result = await service.execute({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        messageId: "message-1",
        storagePath: testCase.path,
        attachmentType: "document",
        mimeType: testCase.mimeType,
        sizeBytes: 128,
        originalFilename: testCase.path.split("/").pop() ?? "report",
        kind: "files.attach"
      });

      assert.equal(result.attachmentId, "attachment-1");
      assert.equal(lookupCount, 2);
      assert.equal(inspectInput?.path, testCase.path);
      assert.equal(registerInput?.workspaceProjectPath, "/workspace");
      assert.equal(
        (createdInputs[0]?.metadata as { documentLink?: { outputFormat?: string } })?.documentLink
          ?.outputFormat,
        testCase.format
      );
      assert.equal(
        (createdInputs[0]?.metadata as { documentLink?: { outputPath?: string } })?.documentLink
          ?.outputPath,
        testCase.path
      );
    }
  });

  test("re-attaching the same document path auto-registers a new version", async () => {
    const createdInputs: Record<string, unknown>[] = [];
    const registerInputs: Record<string, unknown>[] = [];
    const links = [
      { status: "none" as const },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: "/workspace/report.pdf",
          format: "pdf",
          versionNumber: 1
        })
      },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: "/workspace/report.pdf",
          format: "pdf",
          versionNumber: 1
        })
      },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: "/workspace/report.pdf",
          format: "pdf",
          versionNumber: 2
        })
      }
    ];

    const service = new RegisterChatAttachmentService(
      {
        assistantChat: {
          findFirst: async () => ({
            id: "chat-1",
            surface: "web",
            surfaceThreadKey: "web-thread-1"
          })
        },
        assistantDocument: {
          findFirst: async () => null
        }
      } as never,
      createAttachmentRepository(createdInputs) as never,
      {
        async get(input: { path: string }) {
          return input.path === "/workspace/report.pdf"
            ? createWorkspaceMetadata("/workspace/report.pdf")
            : null;
        },
        upsert: async () => {}
      } as never,
      {
        async findCurrentDocumentLinkByOutputPath() {
          const next = links.shift();
          if (next === undefined) {
            throw new Error("unexpected link lookup");
          }
          return next;
        }
      } as never,
      {
        async execute() {
          return {
            accepted: true,
            sourcePath: "/workspace/report.pdf",
            inspectPath: "/workspace/report.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: null,
              headingCount: null,
              tableCount: null,
              textCharCount: 120
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        }
      } as never,
      {
        async execute(input: Record<string, unknown>) {
          registerInputs.push(input);
          const versionNumber = registerInputs.length;
          return {
            accepted: true,
            docId: "doc-auto-1",
            versionId: `version-auto-${versionNumber}`,
            versionNumber,
            descriptorMode:
              versionNumber === 1 ? ("create_document" as const) : ("revise_document" as const),
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: "/workspace/report.pdf",
            workspaceProjectPath: "/workspace",
            sourceManifestPath: null,
            inspectionPath: "/workspace/report.inspect.json"
          };
        }
      } as never
    );

    const input = {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: "/workspace/report.pdf",
      attachmentType: "document" as const,
      mimeType: "application/pdf",
      sizeBytes: 128,
      originalFilename: "report.pdf",
      kind: "files.attach" as const
    };
    await service.execute(input);
    await service.execute({ ...input, messageId: "message-2" });

    assert.equal(registerInputs.length, 2);
    assert.equal(registerInputs[0]?.docId, null);
    assert.equal(registerInputs[1]?.docId, "doc-auto-1");
    assert.equal(registerInputs[1]?.descriptorMode, "revise_document");
    assert.equal(
      (
        createdInputs[1]?.metadata as {
          documentLink?: { versionNumber?: number; descriptorMode?: string };
        }
      )?.documentLink?.versionNumber,
      2
    );
  });

  test("Case B: shell rewrites file bytes and files.attach records a new version", async () => {
    const createdInputs: Record<string, unknown>[] = [];
    const registerInputs: Record<string, unknown>[] = [];
    const links = [
      { status: "none" as const },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: "/workspace/report.xlsx",
          format: "xlsx",
          versionNumber: 1
        })
      },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: "/workspace/report.xlsx",
          format: "xlsx",
          versionNumber: 1
        })
      },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: "/workspace/report.xlsx",
          format: "xlsx",
          versionNumber: 2
        })
      }
    ];

    const service = new RegisterChatAttachmentService(
      {
        assistantChat: {
          findFirst: async () => ({
            id: "chat-1",
            surface: "web",
            surfaceThreadKey: "web-thread-1"
          })
        },
        assistantDocument: {
          findFirst: async () => null
        }
      } as never,
      createAttachmentRepository(createdInputs) as never,
      {
        async get(input: { path: string }) {
          return input.path === "/workspace/report.xlsx"
            ? createWorkspaceMetadata(
                "/workspace/report.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              )
            : null;
        },
        upsert: async () => {}
      } as never,
      {
        async findCurrentDocumentLinkByOutputPath() {
          const next = links.shift();
          if (next === undefined) {
            throw new Error("unexpected link lookup");
          }
          return next;
        }
      } as never,
      {
        async execute() {
          return {
            accepted: true,
            sourcePath: "/workspace/report.xlsx",
            inspectPath: "/workspace/report.inspect.json",
            format: "xlsx" as const,
            counts: {
              pageCount: null,
              sheetCount: 1,
              formulaCount: 3,
              blankSheetCount: 0,
              paragraphCount: null,
              headingCount: null,
              tableCount: null,
              textCharCount: null
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        }
      } as never,
      {
        async execute(input: Record<string, unknown>) {
          registerInputs.push(input);
          const versionNumber = registerInputs.length;
          return {
            accepted: true,
            docId: "doc-auto-xlsx-1",
            versionId: `version-auto-xlsx-${versionNumber}`,
            versionNumber,
            descriptorMode:
              versionNumber === 1 ? ("create_document" as const) : ("revise_document" as const),
            documentType: "workspace_document" as const,
            outputFormat: "xlsx" as const,
            outputPath: "/workspace/report.xlsx",
            workspaceProjectPath: "/workspace",
            sourceManifestPath: null,
            inspectionPath: "/workspace/report.inspect.json"
          };
        }
      } as never
    );

    const input = {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      storagePath: "/workspace/report.xlsx",
      attachmentType: "document" as const,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 512,
      originalFilename: "report.xlsx",
      kind: "files.attach" as const
    };

    const first = await service.execute({
      ...input,
      messageId: "message-case-b-1"
    });
    const second = await service.execute({
      ...input,
      messageId: "message-case-b-2"
    });

    assert.equal(first.attachmentId, "attachment-1");
    assert.equal(second.attachmentId, "attachment-2");
    assert.equal(first.storagePath, "/workspace/report.xlsx");
    assert.equal(second.storagePath, "/workspace/report.xlsx");
    assert.equal(registerInputs.length, 2);
    assert.equal(registerInputs[0]?.docId, null);
    assert.equal(registerInputs[1]?.docId, "doc-auto-1");
    assert.equal(registerInputs[1]?.descriptorMode, "revise_document");
    assert.equal(
      (
        createdInputs[1]?.metadata as {
          documentLink?: { versionNumber?: number; descriptorMode?: string; outputPath?: string };
        }
      )?.documentLink?.versionNumber,
      2
    );
    assert.equal(
      (
        createdInputs[1]?.metadata as {
          documentLink?: { versionNumber?: number; descriptorMode?: string; outputPath?: string };
        }
      )?.documentLink?.descriptorMode,
      "revise_document"
    );
    assert.equal(
      (
        createdInputs[1]?.metadata as {
          documentLink?: { versionNumber?: number; descriptorMode?: string; outputPath?: string };
        }
      )?.documentLink?.outputPath,
      "/workspace/report.xlsx"
    );
  });

  test("missing workspace document output fails honestly without provenance-wall wording", async () => {
    const service = new RegisterChatAttachmentService(
      {
        assistantChat: {
          findFirst: async () => ({
            id: "chat-1",
            surface: "web",
            surfaceThreadKey: "web-thread-1"
          })
        },
        assistantDocument: {
          findFirst: async () => null
        }
      } as never,
      createAttachmentRepository([]) as never,
      {
        async get() {
          return null;
        },
        upsert: async () => {}
      } as never,
      {
        async findCurrentDocumentLinkByOutputPath() {
          return { status: "none" as const };
        }
      } as never,
      {
        async execute() {
          throw new Error("inspect should not run");
        }
      } as never,
      {
        async execute() {
          throw new Error("register should not run");
        }
      } as never
    );

    await assert.rejects(
      () =>
        service.execute({
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          messageId: "message-1",
          storagePath: "/workspace/missing.pdf",
          attachmentType: "document",
          mimeType: "application/pdf",
          sizeBytes: 64,
          originalFilename: "missing.pdf",
          kind: "files.attach"
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("workspace file does not exist") &&
        !/provenance|register_version|document\.inspect/i.test(error.message)
    );
  });

  test("non-document files pass through files.attach without document registration", async () => {
    const cases = [
      { path: "/workspace/notes.txt", mimeType: "text/plain" },
      { path: "/workspace/image.png", mimeType: "image/png" }
    ];

    for (const testCase of cases) {
      const createdInputs: Record<string, unknown>[] = [];
      let lookupCount = 0;
      const service = new RegisterChatAttachmentService(
        { assistantChat: { findFirst: async () => null } } as never,
        createAttachmentRepository(createdInputs) as never,
        { upsert: async () => {} } as never,
        {
          async findCurrentDocumentLinkByOutputPath() {
            lookupCount += 1;
            return { status: "none" as const };
          }
        } as never
      );

      const result = await service.execute({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        messageId: "message-1",
        storagePath: testCase.path,
        attachmentType: "document",
        mimeType: testCase.mimeType,
        sizeBytes: 12,
        originalFilename: testCase.path.split("/").pop() ?? "file",
        kind: "files.attach"
      });

      assert.equal(result.attachmentId, "attachment-1");
      assert.equal(lookupCount, 1);
      assert.equal(
        (createdInputs[0]?.metadata as { documentLink?: unknown } | undefined)?.documentLink,
        undefined
      );
    }
  });
});
