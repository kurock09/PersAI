import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { EnqueueRuntimeDeferredDocumentJobService } from "../src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service";

const PRESENTATION_DOC_ID = "12345678-1234-4234-9234-1234567890ab";
const PRESENTATION_VERSION_ID = "22345678-1234-4234-9234-1234567890ab";
const PRESENTATION_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

function noopGammaThemePickerMock() {
  return {
    async pickTheme() {
      return { themeId: null, reason: null };
    }
  } as never;
}

function buildService(
  overrides: {
    docJobService?: Record<string, unknown>;
    sourceUserMessageText?: string;
  } = {}
) {
  return new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-06-29T12:00:00.000Z")
        };
      },
      async findChatById(chatId: string) {
        return {
          id: chatId,
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "web" as const
        };
      }
    } as never,
    {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("enqueue override missing");
      },
      async findRevisionContext() {
        return null;
      },
      async findLatestRevisionContextForChat() {
        return null;
      },
      async findExportOrRedeliverContext() {
        return null;
      },
      ...overrides.docJobService
    } as never,
    {
      async build() {
        return null;
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "pro",
          monthlyToolQuotas: {
            planCode: "pro",
            periodStartedAt: "2026-06-01T00:00:00.000Z",
            periodEndsAt: "2026-07-01T00:00:00.000Z",
            periodSource: "subscription_period" as const,
            tools: [
              {
                toolCode: "document",
                displayName: "Document",
                usedUnits: 0,
                reservedUnits: 0,
                settledUnits: 0,
                releasedUnits: 0,
                reconciliationRequiredUnits: 0,
                limitUnits: 10,
                effectiveLimitUnits: 10,
                remainingUnits: 10,
                usageAvailable: true,
                status: "ok" as const
              }
            ]
          }
        };
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "pro",
          tools: [{ toolCode: "document", activationStatus: "active" as const }]
        };
      }
    } as never,
    {} as never,
    noopGammaThemePickerMock()
  );
}

function baseInput(
  descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver"
) {
  return {
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Create a board deck",
    runtimeSessionId: "runtime-session-1",
    directToolExecution: {
      toolCode: "document" as const,
      descriptorMode,
      request: {
        prompt: "Board deck",
        outputFormat: "pptx" as const,
        docId: descriptorMode === "create_presentation" ? null : PRESENTATION_DOC_ID
      }
    }
  };
}

async function runCreatePresentationDefaultsToPdf(): Promise<void> {
  let captured: Record<string, unknown> | null = null;
  const service = buildService({
    docJobService: {
      async enqueue(input: unknown) {
        captured = input as Record<string, unknown>;
        return {
          docId: PRESENTATION_DOC_ID,
          versionId: PRESENTATION_VERSION_ID,
          renderJobId: "render-1",
          status: "queued" as const
        };
      }
    }
  });

  const result = await service.execute(baseInput("create_presentation"));

  assert.deepEqual(result, {
    accepted: true,
    docId: PRESENTATION_DOC_ID,
    versionId: PRESENTATION_VERSION_ID,
    renderJobId: "render-1",
    documentType: "presentation"
  });
  assert.equal(captured?.documentType, "presentation");
  assert.equal(captured?.provider, "gamma");
  assert.equal(captured?.outputFormat, "pdf");
}

function runRetiredDescriptorRejectedInParse(): void {
  const service = buildService();
  assert.throws(
    () =>
      service.parseInput({
        assistantId: "assistant-1",
        sourceUserMessageId: "message-1",
        sourceUserMessageText: "Make a workbook",
        runtimeSessionId: "runtime-session-1",
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_data_document",
          request: {
            prompt: "Revenue model",
            outputFormat: "xlsx"
          }
        }
      }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "descriptor_mode_retired"
  );
}

async function runPresentationRevisionAccepted(): Promise<void> {
  let captured: Record<string, unknown> | null = null;
  const service = buildService({
    docJobService: {
      async findRevisionContext() {
        return {
          docId: PRESENTATION_DOC_ID,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "presentation" as const,
          currentVersionId: PRESENTATION_VERSION_ID,
          currentVersionNumber: 2,
          currentSourceJson: { prompt: "Original deck", outputFormat: "pdf" as const }
        };
      },
      async enqueueRevision(input: unknown) {
        captured = input as Record<string, unknown>;
        return {
          docId: PRESENTATION_DOC_ID,
          versionId: "32345678-1234-4234-9234-1234567890ab",
          renderJobId: "render-revision-1",
          status: "queued" as const
        };
      }
    }
  });

  const result = await service.execute(baseInput("revise_document"));

  assert.equal(result.accepted, true);
  assert.equal(result.accepted ? result.documentType : null, "presentation");
  assert.equal(captured?.provider, "gamma");
  assert.equal(captured?.outputFormat, "pdf");
  assert.equal(
    (captured?.request as { sourceJson?: { outputFormat?: string } }).sourceJson?.outputFormat,
    "pdf"
  );
  assert.equal("previousVersionRenderedHtml" in (captured ?? {}), false);
}

async function runHistoricalRevisionRejected(): Promise<void> {
  let enqueueRevisionCalls = 0;
  const service = buildService({
    docJobService: {
      async findRevisionContext() {
        return {
          docId: PRESENTATION_DOC_ID,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "pdf_document" as const,
          currentVersionId: PRESENTATION_VERSION_ID,
          currentVersionNumber: 1,
          currentSourceJson: { prompt: "Historical PDF", outputFormat: "pdf" as const }
        };
      },
      async enqueueRevision() {
        enqueueRevisionCalls += 1;
        throw new Error("historical rows must not enqueue");
      }
    }
  });

  const result = await service.execute(baseInput("revise_document"));

  assert.equal(result.accepted, false);
  assert.equal(
    result.accepted === false ? result.code : null,
    "revise_document_requires_presentation"
  );
  assert.equal(enqueueRevisionCalls, 0);
}

async function runRevisionByStoragePathSteersBackToVisibleWorkflow(): Promise<void> {
  const service = buildService({
    docJobService: {
      async findRevisionContextByStoragePath() {
        return { ok: false, reason: "not_found" as const };
      }
    }
  });

  const result = await service.execute({
    ...baseInput("revise_document"),
    directToolExecution: {
      ...baseInput("revise_document").directToolExecution,
      path: "/workspace/assistants/assistant-1/sessions/runtime-session-1/Карнаух_Федор_Отчет (1).docx",
      request: {
        prompt: "Rebuild this DOCX in a premium style",
        outputFormat: "pdf" as const,
        docId: null
      }
    }
  });

  assert.equal(result.accepted, false);
  assert.equal(result.accepted === false ? result.code : null, "revise_document_path_not_found");
  assert.match(
    result.accepted === false ? result.message : "",
    /Uploaded DOCX\/PDF\/XLSX workspace files are not revise_document targets/i
  );
  assert.match(
    result.accepted === false ? (result.guidance ?? "") : "",
    /Do not ask the user to re-upload.*document\.inspect.*document\.render.*document\.convert.*files\.attach/is
  );
}

async function runExplicitPptxExportQueuesGammaRender(): Promise<void> {
  let captured: Record<string, unknown> | null = null;
  const service = buildService({
    docJobService: {
      async findExportOrRedeliverContext() {
        return {
          docId: PRESENTATION_DOC_ID,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "presentation" as const,
          currentVersionId: PRESENTATION_VERSION_ID,
          currentVersionNumber: 1,
          currentSourceJson: { prompt: "Original deck", outputFormat: "pdf" as const },
          currentVersionStatus: "ready" as const,
          currentOutputFormat: "pdf" as const,
          latestDeliveredFile: {
            attachmentId: "attachment-1",
            storagePath: `${PRESENTATION_SESSION_ROOT}/deck.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 1000,
            originalFilename: "deck.pdf"
          }
        };
      },
      async enqueueExportRender(input: unknown) {
        captured = input as Record<string, unknown>;
        return {
          docId: PRESENTATION_DOC_ID,
          versionId: PRESENTATION_VERSION_ID,
          renderJobId: "render-pptx-1",
          status: "queued" as const
        };
      }
    }
  });

  const result = await service.execute({
    ...baseInput("export_or_redeliver"),
    sourceUserMessageText: "Prepare PPTX",
    directToolExecution: {
      ...baseInput("export_or_redeliver").directToolExecution,
      request: {
        prompt: "Prepare PPTX",
        docId: PRESENTATION_DOC_ID,
        outputFormat: "pptx" as const
      }
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(captured?.provider, "gamma");
  assert.equal(captured?.outputFormat, "pptx");
  assert.equal(captured?.preserveCurrentVersionStatus, true);
}

async function runHistoricalExportRejected(): Promise<void> {
  const service = buildService({
    docJobService: {
      async findExportOrRedeliverContext() {
        return {
          docId: PRESENTATION_DOC_ID,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "data_document" as const,
          currentVersionId: PRESENTATION_VERSION_ID,
          currentVersionNumber: 1,
          currentSourceJson: { prompt: "Historical workbook", outputFormat: "pdf" as const },
          currentVersionStatus: "ready" as const,
          currentOutputFormat: "pdf" as const,
          latestDeliveredFile: null
        };
      }
    }
  });

  const result = await service.execute(baseInput("export_or_redeliver"));

  assert.equal(result.accepted, false);
  assert.equal(
    result.accepted === false ? result.code : null,
    "export_or_redeliver_requires_presentation"
  );
}

async function run(): Promise<void> {
  await runCreatePresentationDefaultsToPdf();
  runRetiredDescriptorRejectedInParse();
  await runPresentationRevisionAccepted();
  await runHistoricalRevisionRejected();
  await runRevisionByStoragePathSteersBackToVisibleWorkflow();
  await runExplicitPptxExportQueuesGammaRender();
  await runHistoricalExportRejected();
}

void run();
