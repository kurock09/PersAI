import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RegisterChatAttachmentService } from "../src/modules/workspace-management/application/register-chat-attachment.service";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

function createWorkspaceMetadata(
  path: string,
  mimeType = "application/pdf",
  contentHash: string | null = null
) {
  return {
    workspaceId: "workspace-1",
    path,
    mimeType,
    sizeBytes: BigInt(64),
    contentHash,
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
    workspaceProjectPath: input.workspaceProjectPath ?? SESSION_ROOT,
    projectManifestPath: `${input.workspaceProjectPath ?? SESSION_ROOT}/project.json`,
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

function createAttachmentMetadataUpdater(updatedMetadata: Record<string, unknown>[]) {
  return {
    assistantChatMessageAttachment: {
      update: async (input: { data: { metadata: Record<string, unknown> } }) => {
        updatedMetadata.push(input.data.metadata);
        return {
          id: "attachment-updated",
          metadata: input.data.metadata
        };
      }
    }
  };
}

function createWorkspaceFileMetadataService(
  overrides: {
    get?: (input: { workspaceId: string; path: string }) => Promise<unknown>;
    upsert?: (input: Record<string, unknown>) => Promise<void>;
  } = {}
) {
  return {
    get: overrides.get ?? (async () => null),
    upsert: overrides.upsert ?? (async () => {})
  };
}

function createMicroDescriptionJobService() {
  return {
    enqueueIfNeeded: async () => {}
  };
}

function createAssistantDocumentJobService(
  overrides: {
    findCurrentDocumentLinkByOutputPath?: () => Promise<
      { status: "none" } | { status: "ready"; link: unknown }
    >;
  } = {}
) {
  return {
    findCurrentDocumentLinkByOutputPath:
      overrides.findCurrentDocumentLinkByOutputPath ?? (async () => ({ status: "none" as const }))
  };
}

describe("register-chat-attachment.service", () => {
  test("rejects storage paths outside the active hierarchical workspace roots", async () => {
    const service = new RegisterChatAttachmentService(
      { assistantChat: { findFirst: async () => null } } as never,
      {
        create: async () => {
          throw new Error("should not create");
        }
      } as never,
      createWorkspaceFileMetadataService() as never,
      createAssistantDocumentJobService() as never,
      createMicroDescriptionJobService() as never
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
      createWorkspaceFileMetadataService({
        upsert: async (input: Record<string, unknown>) => {
          upsertInput = input;
        }
      }) as never,
      createAssistantDocumentJobService() as never,
      createMicroDescriptionJobService() as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: `${SESSION_ROOT}/report.csv`,
      attachmentType: "document",
      mimeType: "text/csv",
      sizeBytes: 12,
      originalFilename: "report.csv",
      kind: "user_upload",
      shortDescription: "Quarterly report"
    });

    assert.equal(result.attachmentId, "attachment-1");
    assert.equal(result.storagePath, `${SESSION_ROOT}/report.csv`);
    assert.equal(createdInput?.storagePath, `${SESSION_ROOT}/report.csv`);
    assert.equal(createdInput?.processingStatus, "ready");
    assert.deepEqual((createdInput?.metadata as Record<string, unknown>)?.kind, "user_upload");
    assert.equal(upsertInput?.path, `${SESSION_ROOT}/report.csv`);
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
      createWorkspaceFileMetadataService() as never,
      createAssistantDocumentJobService() as never,
      createMicroDescriptionJobService() as never
    );

    await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: `${SESSION_ROOT}/clip.mp4`,
      attachmentType: "video",
      mimeType: "video/mp4",
      sizeBytes: 1024,
      originalFilename: "clip.mp4",
      kind: "user_upload",
      thumbnailStoragePath: `${SESSION_ROOT}/photo.jpg.thumb.webp`,
      posterStoragePath: `${SESSION_ROOT}/clip.mp4.poster.jpg`
    });

    assert.equal(createdInput?.thumbnailStoragePath, `${SESSION_ROOT}/photo.jpg.thumb.webp`);
    assert.equal(createdInput?.posterStoragePath, `${SESSION_ROOT}/clip.mp4.poster.jpg`);
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
      createWorkspaceFileMetadataService() as never,
      createAssistantDocumentJobService() as never,
      createMicroDescriptionJobService() as never
    );

    await assert.rejects(
      () =>
        service.executeFromRuntime({
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          channel: "web",
          externalThreadKey: "web-thread-1",
          messageId: null,
          storagePath: `${SESSION_ROOT}/report.csv`,
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

  test("attaches the current documentLink for visible workspace outputs when one exists", async () => {
    const cases = [
      {
        format: "pdf" as const,
        path: `${SESSION_ROOT}/report.pdf`,
        mimeType: "application/pdf"
      },
      {
        format: "docx" as const,
        path: `${SESSION_ROOT}/report.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      {
        format: "xlsx" as const,
        path: `${SESSION_ROOT}/report.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ];

    for (const testCase of cases) {
      const createdInputs: Record<string, unknown>[] = [];
      const updatedMetadata: Record<string, unknown>[] = [];
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
          },
          ...createAttachmentMetadataUpdater(updatedMetadata)
        } as never,
        createAttachmentRepository(createdInputs) as never,
        createWorkspaceFileMetadataService({
          get: async (input: { path: string }) =>
            input.path === testCase.path
              ? createWorkspaceMetadata(input.path, testCase.mimeType)
              : null,
          upsert: async () => {}
        }) as never,
        createAssistantDocumentJobService({
          findCurrentDocumentLinkByOutputPath: async () =>
            ({ status: "ready" as const, link: readyLink }) as const
        }) as never,
        createMicroDescriptionJobService() as never
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
      assert.equal(
        (updatedMetadata[0] as { documentLink?: { outputFormat?: string } })?.documentLink
          ?.outputFormat,
        testCase.format
      );
      assert.equal(
        (updatedMetadata[0] as { documentLink?: { outputPath?: string } })?.documentLink
          ?.outputPath,
        testCase.path
      );
    }
  });

  test("re-attaching the same document path reuses the current version", async () => {
    const createdInputs: Record<string, unknown>[] = [];
    const updatedMetadata: Record<string, unknown>[] = [];
    const links = [
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: `${SESSION_ROOT}/report.pdf`,
          format: "pdf",
          versionNumber: 1
        })
      },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: `${SESSION_ROOT}/report.pdf`,
          format: "pdf",
          versionNumber: 1
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
        },
        ...createAttachmentMetadataUpdater(updatedMetadata)
      } as never,
      createAttachmentRepository(createdInputs) as never,
      createWorkspaceFileMetadataService({
        get: async (input: { path: string }) =>
          input.path === `${SESSION_ROOT}/report.pdf`
            ? createWorkspaceMetadata(`${SESSION_ROOT}/report.pdf`)
            : null,
        upsert: async () => {}
      }) as never,
      createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => {
          const next = links.shift();
          if (next === undefined) {
            throw new Error("unexpected link lookup");
          }
          return next;
        }
      }) as never,
      createMicroDescriptionJobService() as never
    );

    const input = {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: `${SESSION_ROOT}/report.pdf`,
      attachmentType: "document" as const,
      mimeType: "application/pdf",
      sizeBytes: 128,
      originalFilename: "report.pdf",
      kind: "files.attach" as const
    };
    await service.execute(input);
    await service.execute({ ...input, messageId: "message-2" });

    assert.equal(
      (updatedMetadata[1] as { documentLink?: { versionNumber?: number; descriptorMode?: string } })
        ?.documentLink?.versionNumber,
      1
    );
  });

  test("files.attach reflects the current version after shell rewrites bytes", async () => {
    const createdInputs: Record<string, unknown>[] = [];
    const updatedMetadata: Record<string, unknown>[] = [];
    const links = [
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: `${SESSION_ROOT}/report.xlsx`,
          format: "xlsx",
          versionNumber: 1
        })
      },
      {
        status: "ready" as const,
        link: createDocumentLink({
          path: `${SESSION_ROOT}/report.xlsx`,
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
        },
        ...createAttachmentMetadataUpdater(updatedMetadata)
      } as never,
      createAttachmentRepository(createdInputs) as never,
      createWorkspaceFileMetadataService({
        get: async (input: { path: string }) =>
          input.path === `${SESSION_ROOT}/report.xlsx`
            ? createWorkspaceMetadata(
                `${SESSION_ROOT}/report.xlsx`,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              )
            : null,
        upsert: async () => {}
      }) as never,
      createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => {
          const next = links.shift();
          if (next === undefined) {
            throw new Error("unexpected link lookup");
          }
          return next;
        }
      }) as never,
      createMicroDescriptionJobService() as never
    );

    const input = {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      storagePath: `${SESSION_ROOT}/report.xlsx`,
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
    assert.equal(first.storagePath, `${SESSION_ROOT}/report.xlsx`);
    assert.equal(second.storagePath, `${SESSION_ROOT}/report.xlsx`);
    assert.equal(
      (
        updatedMetadata[1] as {
          documentLink?: { versionNumber?: number; descriptorMode?: string; outputPath?: string };
        }
      )?.documentLink?.versionNumber,
      2
    );
    assert.equal(
      (
        updatedMetadata[1] as {
          documentLink?: { versionNumber?: number; descriptorMode?: string; outputPath?: string };
        }
      )?.documentLink?.outputPath,
      `${SESSION_ROOT}/report.xlsx`
    );
  });

  test("files.attach still creates an attachment row when document enrichment fails", async () => {
    const createdInputs: Record<string, unknown>[] = [];

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
        },
        assistantChatMessageAttachment: {
          update: async () => {
            throw new Error("metadata update should not run when enrichment fails");
          }
        }
      } as never,
      createAttachmentRepository(createdInputs) as never,
      createWorkspaceFileMetadataService({
        get: async (input: { path: string }) =>
          input.path === `${SESSION_ROOT}/test.pdf`
            ? createWorkspaceMetadata(`${SESSION_ROOT}/test.pdf`)
            : null,
        upsert: async () => {}
      }) as never,
      createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const })
      }) as never,
      createMicroDescriptionJobService() as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      messageId: "message-1",
      storagePath: `${SESSION_ROOT}/test.pdf`,
      attachmentType: "document",
      mimeType: "application/pdf",
      sizeBytes: 64,
      originalFilename: "test.pdf",
      kind: "files.attach"
    });

    assert.equal(result.attachmentId, "attachment-1");
    assert.equal(createdInputs.length, 1);
    assert.equal(
      ((createdInputs[0]?.metadata as Record<string, unknown> | null) ?? {})["documentLink"],
      undefined
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
      createWorkspaceFileMetadataService({
        get: async () => null,
        upsert: async () => {}
      }) as never,
      createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const })
      }) as never,
      createMicroDescriptionJobService() as never
    );

    await assert.rejects(
      () =>
        service.execute({
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          messageId: "message-1",
          storagePath: `${SESSION_ROOT}/missing.pdf`,
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
      { path: `${SESSION_ROOT}/notes.txt`, mimeType: "text/plain" },
      { path: `${SESSION_ROOT}/image.png`, mimeType: "image/png" }
    ];

    for (const testCase of cases) {
      const createdInputs: Record<string, unknown>[] = [];
      let lookupCount = 0;
      const service = new RegisterChatAttachmentService(
        { assistantChat: { findFirst: async () => null } } as never,
        createAttachmentRepository(createdInputs) as never,
        createWorkspaceFileMetadataService() as never,
        createAssistantDocumentJobService({
          findCurrentDocumentLinkByOutputPath: async () => {
            lookupCount += 1;
            return { status: "none" as const };
          }
        }) as never,
        createMicroDescriptionJobService() as never
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
      assert.equal(lookupCount, 0);
      assert.equal(
        (createdInputs[0]?.metadata as { documentLink?: unknown } | undefined)?.documentLink,
        undefined
      );
    }
  });
});
