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

function createDeliverOnceService(createdInputs: Record<string, unknown>[]) {
  return {
    execute: async (input: Record<string, unknown>) => {
      createdInputs.push(input);
      const attachmentId = `attachment-${createdInputs.length}`;
      return {
        alreadyDelivered: false,
        attachment: {
          id: attachmentId,
          storagePath: input.storagePath as string,
          metadata: (input.metadata as Record<string, unknown> | null) ?? null
        },
        delivery: {
          kind: "new" as const,
          canonicalKey: `media:workspace:${String(input.storagePath)}`
        }
      };
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

function createLiveTurnPresentService(
  overrides: {
    findOpenOrdinaryUserTurnAttemptForChat?: () => Promise<{
      assistantId: string;
      userId: string;
      chatId: string;
      surfaceThreadKey: string;
      clientTurnId: string;
      userMessageId: string;
      assistantMessageId: string | null;
    } | null>;
    ensureOpenTurnAssistantMessage?: (input: {
      attempt: { assistantMessageId: string | null };
    }) => Promise<string>;
  } = {}
) {
  return {
    findOpenOrdinaryUserTurnAttemptForChat:
      overrides.findOpenOrdinaryUserTurnAttemptForChat ?? (async () => null),
    ensureOpenTurnAssistantMessage:
      overrides.ensureOpenTurnAssistantMessage ??
      (async (input: { attempt: { assistantMessageId: string | null } }) => {
        if (
          typeof input.attempt.assistantMessageId === "string" &&
          input.attempt.assistantMessageId.trim().length > 0
        ) {
          return input.attempt.assistantMessageId;
        }
        throw new Error("Open web turn no longer accepts an assistant message binding.");
      })
  };
}

function createRegisterService(input: {
  prisma?: unknown;
  metadata?: ReturnType<typeof createWorkspaceFileMetadataService>;
  documents?: ReturnType<typeof createAssistantDocumentJobService>;
  micro?: ReturnType<typeof createMicroDescriptionJobService>;
  deliverOnce: ReturnType<typeof createDeliverOnceService> | { execute: () => Promise<never> };
  liveTurnPresent?: ReturnType<typeof createLiveTurnPresentService>;
}) {
  return new RegisterChatAttachmentService(
    (input.prisma ?? { assistantChat: { findFirst: async () => null } }) as never,
    (input.metadata ?? createWorkspaceFileMetadataService()) as never,
    (input.documents ?? createAssistantDocumentJobService()) as never,
    (input.micro ?? createMicroDescriptionJobService()) as never,
    input.deliverOnce as never,
    (input.liveTurnPresent ?? createLiveTurnPresentService()) as never
  );
}

describe("register-chat-attachment.service", () => {
  test("rejects storage paths outside the active hierarchical workspace roots", async () => {
    const service = createRegisterService({
      deliverOnce: {
        execute: async () => {
          throw new Error("should not create");
        }
      }
    });

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
    const createdInputs: Record<string, unknown>[] = [];
    let upsertInput: Record<string, unknown> | null = null;

    const service = createRegisterService({
      metadata: createWorkspaceFileMetadataService({
        upsert: async (input: Record<string, unknown>) => {
          upsertInput = input;
        }
      }),
      deliverOnce: createDeliverOnceService(createdInputs)
    });

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
    assert.equal(result.alreadyDelivered, false);
    assert.equal(createdInputs[0]?.storagePath, `${SESSION_ROOT}/report.csv`);
    assert.deepEqual((createdInputs[0]?.metadata as Record<string, unknown>)?.kind, "user_upload");
    assert.equal(upsertInput?.path, `${SESSION_ROOT}/report.csv`);
    assert.equal(upsertInput?.originChatId, "chat-1");
    assert.equal(upsertInput?.originAssistantId, "assistant-1");
    assert.equal(upsertInput?.shortDescription, "Quarterly report");
  });

  test("passes thumbnail and poster storage paths to attachment create", async () => {
    const createdInputs: Record<string, unknown>[] = [];

    const service = createRegisterService({
      deliverOnce: createDeliverOnceService(createdInputs)
    });

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

    assert.equal(createdInputs[0]?.thumbnailStoragePath, `${SESSION_ROOT}/photo.jpg.thumb.webp`);
    assert.equal(createdInputs[0]?.posterStoragePath, `${SESSION_ROOT}/clip.mp4.poster.jpg`);
  });
  test("runtime attachment with null messageId binds open ordinary USER_TURN assistant message", async () => {
    const createdInputs: Record<string, unknown>[] = [];
    const service = createRegisterService({
      prisma: {
        assistantChat: {
          findFirst: async () => ({ id: "chat-1" })
        },
        assistantChatMessage: {
          findFirst: async (args: { where: { id: string } }) =>
            args.where.id === "assistant-message-1" ? { id: "assistant-message-1" } : null
        }
      },
      deliverOnce: createDeliverOnceService(createdInputs),
      liveTurnPresent: createLiveTurnPresentService({
        findOpenOrdinaryUserTurnAttemptForChat: async () => ({
          assistantId: "assistant-1",
          userId: "user-1",
          chatId: "chat-1",
          surfaceThreadKey: "web-thread-1",
          clientTurnId: "client-turn-1",
          userMessageId: "user-message-1",
          assistantMessageId: "assistant-message-1"
        })
      })
    });

    const result = await service.executeFromRuntime({
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
    });

    assert.equal(result.attachmentId, "attachment-1");
    assert.equal(createdInputs[0]?.messageId, "assistant-message-1");
    assert.notEqual(createdInputs[0]?.messageId, "user-message-1");
  });

  test("runtime attachment with null messageId fails closed when no open USER_TURN exists", async () => {
    const service = createRegisterService({
      prisma: {
        assistantChat: {
          findFirst: async () => ({ id: "chat-1" })
        }
      },
      deliverOnce: {
        execute: async () => {
          throw new Error("should not create");
        }
      },
      liveTurnPresent: createLiveTurnPresentService({
        findOpenOrdinaryUserTurnAttemptForChat: async () => null
      })
    });

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
        error instanceof NotFoundException && error.message === "open_assistant_message_not_found"
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
      const readyLink = createDocumentLink({
        path: testCase.path,
        format: testCase.format,
        versionNumber: 1
      });

      const service = createRegisterService({
        metadata: createWorkspaceFileMetadataService({
          get: async (input: { path: string }) =>
            input.path === testCase.path
              ? createWorkspaceMetadata(input.path, testCase.mimeType)
              : null,
          upsert: async () => {}
        }),
        documents: createAssistantDocumentJobService({
          findCurrentDocumentLinkByOutputPath: async () =>
            ({ status: "ready" as const, link: readyLink }) as const
        }),
        deliverOnce: createDeliverOnceService(createdInputs)
      });

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
        (createdInputs[0]?.metadata as { documentLink?: { outputFormat?: string } } | undefined)
          ?.documentLink?.outputFormat,
        testCase.format
      );
      assert.equal(
        (createdInputs[0]?.metadata as { documentLink?: { outputPath?: string } } | undefined)
          ?.documentLink?.outputPath,
        testCase.path
      );
      assert.equal(
        (createdInputs[0]?.deliveryIdentity as { kind?: string } | undefined)?.kind,
        "document"
      );
    }
  });

  test("re-attaching the same document path reuses the current version", async () => {
    const createdInputs: Record<string, unknown>[] = [];
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

    const service = createRegisterService({
      metadata: createWorkspaceFileMetadataService({
        get: async (input: { path: string }) =>
          input.path === `${SESSION_ROOT}/report.pdf`
            ? createWorkspaceMetadata(`${SESSION_ROOT}/report.pdf`)
            : null,
        upsert: async () => {}
      }),
      documents: createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => {
          const next = links.shift();
          if (next === undefined) {
            throw new Error("unexpected link lookup");
          }
          return next;
        }
      }),
      deliverOnce: createDeliverOnceService(createdInputs)
    });

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
      (createdInputs[1]?.metadata as { documentLink?: { versionNumber?: number } } | undefined)
        ?.documentLink?.versionNumber,
      1
    );
  });

  test("files.attach reflects the current version after shell rewrites bytes", async () => {
    const createdInputs: Record<string, unknown>[] = [];
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

    const service = createRegisterService({
      metadata: createWorkspaceFileMetadataService({
        get: async (input: { path: string }) =>
          input.path === `${SESSION_ROOT}/report.xlsx`
            ? createWorkspaceMetadata(
                `${SESSION_ROOT}/report.xlsx`,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              )
            : null,
        upsert: async () => {}
      }),
      documents: createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => {
          const next = links.shift();
          if (next === undefined) {
            throw new Error("unexpected link lookup");
          }
          return next;
        }
      }),
      deliverOnce: createDeliverOnceService(createdInputs)
    });

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
      (createdInputs[1]?.metadata as { documentLink?: { versionNumber?: number } } | undefined)
        ?.documentLink?.versionNumber,
      2
    );
    assert.equal(
      (createdInputs[1]?.metadata as { documentLink?: { outputPath?: string } } | undefined)
        ?.documentLink?.outputPath,
      `${SESSION_ROOT}/report.xlsx`
    );
  });

  test("files.attach still creates an attachment row when document enrichment fails", async () => {
    const createdInputs: Record<string, unknown>[] = [];

    const service = createRegisterService({
      metadata: createWorkspaceFileMetadataService({
        get: async (input: { path: string }) =>
          input.path === `${SESSION_ROOT}/test.pdf`
            ? createWorkspaceMetadata(`${SESSION_ROOT}/test.pdf`)
            : null,
        upsert: async () => {}
      }),
      documents: createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const })
      }),
      deliverOnce: createDeliverOnceService(createdInputs)
    });

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
    const service = createRegisterService({
      metadata: createWorkspaceFileMetadataService({
        get: async () => null,
        upsert: async () => {}
      }),
      documents: createAssistantDocumentJobService({
        findCurrentDocumentLinkByOutputPath: async () => ({ status: "none" as const })
      }),
      deliverOnce: createDeliverOnceService([])
    });

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
      const service = createRegisterService({
        documents: createAssistantDocumentJobService({
          findCurrentDocumentLinkByOutputPath: async () => {
            lookupCount += 1;
            return { status: "none" as const };
          }
        }),
        deliverOnce: createDeliverOnceService(createdInputs)
      });

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
