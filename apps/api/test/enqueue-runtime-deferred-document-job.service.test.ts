import assert from "node:assert/strict";
import { EnqueueRuntimeDeferredDocumentJobService } from "../src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service";

function noopGammaThemePickerMock() {
  return {
    async pickTheme() {
      return { themeId: null, reason: null };
    }
  } as never;
}

async function runAcceptedCase(): Promise<void> {
  let enqueueCalls = 0;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-15T12:00:00.000Z")
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
        enqueueCalls += 1;
        return {
          docId: "doc-1",
          versionId: "version-1",
          renderJobId: "render-1",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
            periodSource: "subscription_period" as const,
            tools: [
              {
                toolCode: "document",
                displayName: "Document",
                usedUnits: 2,
                reservedUnits: 0,
                settledUnits: 2,
                releasedUnits: 0,
                reconciliationRequiredUnits: 0,
                limitUnits: 10,
                effectiveLimitUnits: 10,
                remainingUnits: 8,
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сделай презентацию по PersAI",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_presentation",
      request: {
        prompt: "Investor deck about PersAI",
        outputFormat: "pptx",
        requestedName: "persai-investor-deck",
        visualStyle: "bold_editorial",
        imagePolicy: "web_free_to_use",
        visualDensity: "visual_heavy"
      }
    }
  });

  assert.deepEqual(result, {
    accepted: true,
    docId: "doc-1",
    versionId: "version-1",
    renderJobId: "render-1",
    documentType: "presentation"
  });
  assert.equal(enqueueCalls, 1);
}

async function runPresentationDefaultsToPdfCase(): Promise<void> {
  let capturedEnqueueInput: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-18T11:00:00.000Z")
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
      async enqueue(input) {
        capturedEnqueueInput = input as Record<string, unknown>;
        return {
          docId: "doc-default-pdf-1",
          versionId: "version-default-pdf-1",
          renderJobId: "render-default-pdf-1",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сделай презентацию для совета директоров",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_presentation",
      request: {
        prompt: "Board presentation about PersAI",
        requestedName: "board-deck"
      }
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(
    (capturedEnqueueInput as { outputFormat: string } | null)?.outputFormat,
    "pdf",
    "presentations should default to PDF delivery unless the tool explicitly asked for PPTX"
  );
  assert.equal(
    (
      capturedEnqueueInput as {
        request: { sourceJson: { outputFormat: string } };
      }
    ).request.sourceJson.outputFormat,
    "pdf",
    "persisted sourceJson should carry the default PDF output format so later revisions/exports stay consistent"
  );
}

async function runLimitReachedCase(): Promise<void> {
  let enqueueCalls = 0;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-15T12:00:00.000Z")
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
        enqueueCalls += 1;
        return {
          docId: "doc-1",
          versionId: "version-1",
          renderJobId: "render-1",
          status: "queued" as const
        };
      }
    } as never,
    {
      async build() {
        return {
          message:
            "Document is exhausted for the current monthly period. It resets at 6/1/2026, 12:00:00 AM.",
          guidance:
            "Use a request that does not need document generation. You can also upgrade to Pro."
        };
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "starter",
          monthlyToolQuotas: {
            planCode: "starter",
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
            periodSource: "subscription_period" as const,
            tools: [
              {
                toolCode: "document",
                displayName: "Document",
                usedUnits: 3,
                reservedUnits: 0,
                settledUnits: 3,
                releasedUnits: 0,
                reconciliationRequiredUnits: 0,
                limitUnits: 3,
                effectiveLimitUnits: 3,
                remainingUnits: 0,
                usageAvailable: true,
                status: "limit_reached" as const
              }
            ]
          }
        };
      }
    } as never,
    {
      async execute() {
        return {
          planCode: "starter",
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return null;
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сделай PDF отчет",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_pdf_document",
      request: {
        prompt: "Quarterly report"
      }
    }
  });

  assert.deepEqual(result, {
    accepted: false,
    code: "monthly_tool_quota_exceeded",
    message:
      "Document is exhausted for the current monthly period. It resets at 6/1/2026, 12:00:00 AM.",
    guidance: "Use a request that does not need document generation. You can also upgrade to Pro."
  });
  assert.equal(enqueueCalls, 0);
}

async function runRevisionAcceptedCase(): Promise<void> {
  let enqueueCalls = 0;
  let capturedRevisionRequest: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-15T12:00:00.000Z")
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
        throw new Error("plain enqueue should not run for revision");
      },
      async findRevisionContext() {
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "presentation" as const,
          currentVersionId: "22345678-1234-4234-9234-1234567890ab",
          currentVersionNumber: 3,
          currentSourceJson: {
            prompt: "Original deck",
            outputFormat: "pptx",
            requestedName: "deck-v1"
          }
        };
      },
      async findLatestRevisionContextForChat() {
        throw new Error("latest revision fallback should not run when docId is already valid");
      },
      async enqueueRevision(input) {
        enqueueCalls += 1;
        capturedRevisionRequest = input as Record<string, unknown>;
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          versionId: "32345678-1234-4234-9234-1234567890ab",
          renderJobId: "render-4",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сократи третий слайд",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Shorten slide 3",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pptx"
      }
    }
  });

  assert.deepEqual(result, {
    accepted: true,
    docId: "12345678-1234-4234-9234-1234567890ab",
    versionId: "32345678-1234-4234-9234-1234567890ab",
    renderJobId: "render-4",
    documentType: "presentation"
  });
  assert.equal(enqueueCalls, 1);
  assert.equal(
    (
      capturedRevisionRequest as {
        request: {
          sourceJson: {
            prompt: string;
            outputFormat: string;
            requestedName: string;
          };
        };
      }
    ).request.sourceJson.prompt,
    "Shorten slide 3"
  );
  assert.equal(
    (
      capturedRevisionRequest as {
        request: {
          sourceJson: {
            outputFormat: string;
          };
        };
      }
    ).request.sourceJson.outputFormat,
    "pptx"
  );
}

async function runRevisionFallsBackToLatestChatDocumentWhenDocIdIsNotUuid(): Promise<void> {
  let enqueueCalls = 0;
  let findRevisionContextCalls = 0;
  let findLatestRevisionContextCalls = 0;

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-16T12:00:00.000Z")
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
        throw new Error("plain enqueue should not run for revision");
      },
      async findRevisionContext() {
        findRevisionContextCalls += 1;
        return null;
      },
      async findLatestRevisionContextForChat() {
        findLatestRevisionContextCalls += 1;
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "pdf_document" as const,
          currentVersionId: "version-1",
          currentVersionNumber: 1,
          currentSourceJson: {
            prompt: "Original document",
            outputFormat: "pdf",
            requestedName: "PersAI overview"
          }
        };
      },
      async enqueueRevision() {
        enqueueCalls += 1;
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          versionId: "version-2",
          renderJobId: "render-2",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Обнови документ",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Refresh the overview section",
        docId: "PersAI_overview_and_competitor_comparison.pdf.pdf",
        outputFormat: "pdf"
      }
    }
  });

  assert.deepEqual(result, {
    accepted: true,
    docId: "12345678-1234-4234-9234-1234567890ab",
    versionId: "version-2",
    renderJobId: "render-2",
    documentType: "pdf_document"
  });
  assert.equal(findRevisionContextCalls, 0);
  assert.equal(findLatestRevisionContextCalls, 1);
  assert.equal(enqueueCalls, 1);
}

async function runPdfTemplateAdmissionRejectCase(): Promise<void> {
  let enqueueCalls = 0;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-15T12:00:00.000Z")
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
        enqueueCalls += 1;
        return {
          docId: "doc-1",
          versionId: "version-1",
          renderJobId: "render-1",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return null;
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сделай PDF отчет",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_pdf_document",
      request: {
        prompt: "Quarterly report"
      }
    }
  });

  assert.deepEqual(result, {
    accepted: false,
    code: "document_template_not_configured",
    message:
      'Document provider "pdfmonkey" requires an operator-configured template before this request can be accepted.',
    guidance:
      "Configure the PDFMonkey template for the document tool first, then retry the document request."
  });
  assert.equal(enqueueCalls, 0);
}

async function runPdfCreateSkipsThemePickerCase(): Promise<void> {
  let pickThemeCalls = 0;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-15T12:00:00.000Z")
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
        return {
          docId: "doc-pdf",
          versionId: "version-pdf",
          renderJobId: "render-pdf",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    {
      async pickTheme() {
        pickThemeCalls += 1;
        return { themeId: "theme-ocean", reason: "should not run for pdf" };
      }
    } as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сделай PDF отчёт",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_pdf_document",
      request: {
        prompt: "Quarterly report"
      }
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(pickThemeCalls, 0);
}

async function runPresentationThemePickerPersistenceCase(): Promise<void> {
  let capturedSourceJson: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-15T12:00:00.000Z")
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
      async enqueue(input) {
        capturedSourceJson = input.request.sourceJson as Record<string, unknown>;
        return {
          docId: "doc-theme",
          versionId: "version-theme",
          renderJobId: "render-theme",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    {
      async pickTheme() {
        return { themeId: "theme-ocean", reason: "calm educational deck" };
      }
    } as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Сделай спокойную презентацию для школы",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_presentation",
      request: {
        prompt: "School lesson deck",
        outputFormat: "pptx"
      }
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(capturedSourceJson?.gammaThemeId, "theme-ocean");
}

async function runPresentationRevisionDefaultsToPdfWhenOutputFormatOmitted(): Promise<void> {
  let capturedRevisionRequest: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-18T12:00:00.000Z")
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
        throw new Error("plain enqueue should not run for revision");
      },
      async findRevisionContext() {
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "presentation" as const,
          currentVersionId: "22345678-1234-4234-9234-1234567890ab",
          currentVersionNumber: 3,
          currentSourceJson: {
            prompt: "Original deck",
            // Previous version was rendered as PPTX, but the new revision
            // request omits outputFormat. We must not inherit pptx from the
            // previous version — chat delivery is PDF-first by default.
            outputFormat: "pptx",
            requestedName: "deck-v1"
          }
        };
      },
      async findLatestRevisionContextForChat() {
        throw new Error("latest revision fallback should not run when docId is already valid");
      },
      async enqueueRevision(input) {
        capturedRevisionRequest = input as Record<string, unknown>;
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          versionId: "32345678-1234-4234-9234-1234567890ab",
          renderJobId: "render-revision-pdf",
          status: "queued" as const
        };
      }
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
            periodStartedAt: "2026-05-01T00:00:00.000Z",
            periodEndsAt: "2026-06-01T00:00:00.000Z",
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
          tools: [
            {
              toolCode: "document",
              activationStatus: "active" as const
            }
          ]
        };
      }
    } as never,
    {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Добавь схемы и сделай 7 слайдов",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Add diagrams",
        docId: "12345678-1234-4234-9234-1234567890ab",
        targetSlideCount: 7
      }
    }
  });

  assert.equal(result.accepted, true);
  const captured = capturedRevisionRequest as {
    outputFormat: "pdf" | "pptx";
    request: { sourceJson: { outputFormat: string; targetSlideCount: number | null } };
  } | null;
  assert.equal(captured?.outputFormat, "pdf");
  assert.equal(captured?.request.sourceJson.outputFormat, "pdf");
  assert.equal(captured?.request.sourceJson.targetSlideCount, 7);
}

async function run(): Promise<void> {
  await runAcceptedCase();
  await runPresentationDefaultsToPdfCase();
  await runLimitReachedCase();
  await runRevisionAcceptedCase();
  await runRevisionFallsBackToLatestChatDocumentWhenDocIdIsNotUuid();
  await runPresentationRevisionDefaultsToPdfWhenOutputFormatOmitted();
  await runPdfTemplateAdmissionRejectCase();
  await runPdfCreateSkipsThemePickerCase();
  await runPresentationThemePickerPersistenceCase();
}

void run();
