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
  let capturedEnqueueInput: Record<string, unknown> | null = null;
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
        enqueueCalls += 1;
        capturedEnqueueInput = input as Record<string, unknown>;
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
  assert.equal(
    (capturedEnqueueInput as { outputFormat: string } | null)?.outputFormat,
    "pdf",
    "create_presentation must stay PDF even if the model emits outputFormat=pptx"
  );
  assert.equal(
    (
      capturedEnqueueInput as {
        request: { sourceJson: { outputFormat: string } };
      }
    ).request.sourceJson.outputFormat,
    "pdf",
    "persisted sourceJson must reflect backend-resolved PDF, not model-emitted PPTX"
  );
}

async function runCreateDataDocumentCase(): Promise<void> {
  let capturedEnqueueInput: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-06-21T12:00:00.000Z")
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
          docId: "doc-data-1",
          versionId: "version-data-1",
          renderJobId: "render-data-1",
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
    sourceUserMessageText: "Сделай Excel с выручкой по месяцам",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_data_document",
      request: {
        prompt: "Monthly revenue spreadsheet",
        outputFormat: "xlsx",
        requestedName: "revenue"
      }
    }
  });

  assert.equal(result.accepted, false);
  if (result.accepted) {
    return;
  }
  assert.equal(result.code, "descriptor_mode_retired");
  assert.match(result.guidance ?? "", /document\.render|files\.attach/i);
  assert.equal(capturedEnqueueInput, null);
}

async function runCreateDataDocumentDefaultsToXlsxCase(): Promise<void> {
  let capturedEnqueueInput: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-06-21T12:30:00.000Z")
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
          docId: "doc-data-2",
          versionId: "version-data-2",
          renderJobId: "render-data-2",
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
    sourceUserMessageText: "Собери таблицу",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_data_document",
      request: {
        prompt: "Build a data table"
      }
    }
  });

  assert.equal(result.accepted, false);
  if (result.accepted) {
    return;
  }
  assert.equal(result.code, "descriptor_mode_retired");
  assert.equal(capturedEnqueueInput, null);
}

async function runCreateDataDocumentDocxCase(): Promise<void> {
  let capturedEnqueueInput: Record<string, unknown> | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-06-21T13:00:00.000Z")
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
          docId: "doc-data-3",
          versionId: "version-data-3",
          renderJobId: "render-data-3",
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
    sourceUserMessageText: "Сделай Word документ",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_data_document",
      request: {
        prompt: "Build a Word report",
        outputFormat: "docx"
      }
    }
  });

  assert.equal(result.accepted, false);
  if (result.accepted) {
    return;
  }
  assert.equal(result.code, "descriptor_mode_retired");
  assert.equal(capturedEnqueueInput, null);
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

  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.code, "descriptor_mode_retired");
  }
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
  // Even though the new revision request explicitly asked for outputFormat=pptx,
  // chat delivery for presentations is PDF-only by system contract. Editable
  // PPTX is a separate explicit user action, never the ordinary in-chat
  // artifact. The persisted sourceJson.outputFormat must reflect the resolved
  // PDF, not the model-requested PPTX.
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
    "pdf"
  );
  assert.equal((capturedRevisionRequest as { outputFormat: "pdf" | "pptx" }).outputFormat, "pdf");
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
          currentVersionRenderedHtml:
            "<!DOCTYPE html><html><head></head><body><h1>PersAI Overview</h1></body></html>",
          currentVersionStructureJson: null,
          currentVersionStyleProfileJson: null,
          currentVersionEditStrategy: null,
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

  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.code, "descriptor_mode_retired");
  }
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

async function runPresentationPdfToPptxExportQueuesPptxRender(): Promise<void> {
  let exportRenderCalls = 0;
  let capturedExportRender: {
    outputFormat: "pdf" | "pptx";
    preserveCurrentVersionStatus?: boolean;
    request: { sourceJson: { outputFormat?: string | null; docId?: string | null } };
  } | null = null;
  const service = new EnqueueRuntimeDeferredDocumentJobService(
    {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-19T09:00:00.000Z")
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
      async findExportOrRedeliverContext() {
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "presentation" as const,
          currentVersionId: "version-1",
          currentVersionNumber: 1,
          currentVersionStatus: "ready" as const,
          currentSourceJson: {
            prompt: "Create a deck",
            outputFormat: "pdf"
          },
          currentOutputFormat: "pdf" as const,
          latestDeliveredFile: {
            attachmentId: "attachment-pdf-1",
            storagePath: "/workspace/deck.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1000,
            originalFilename: "deck.pdf"
          }
        };
      },
      async enqueuePersistedFileRedelivery() {
        throw new Error("secondary PPTX preparation must not reuse the existing PDF file");
      },
      async enqueueExportRender(input) {
        exportRenderCalls += 1;
        capturedExportRender = input as typeof capturedExportRender;
        return {
          docId: "12345678-1234-4234-9234-1234567890ab",
          versionId: "version-1",
          renderJobId: "render-pptx-1",
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
    sourceUserMessageText: "Prepare PPTX",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "export_or_redeliver",
      request: {
        prompt: "Prepare PPTX",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pptx"
      }
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(exportRenderCalls, 1);
  assert.equal(capturedExportRender?.outputFormat, "pptx");
  assert.equal(capturedExportRender?.preserveCurrentVersionStatus, true);
  assert.equal(capturedExportRender?.request.sourceJson.outputFormat, "pptx");

  const implicitResult = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Redeliver the presentation",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "export_or_redeliver",
      request: {
        prompt: "Send the presentation again",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pptx"
      }
    }
  });

  assert.equal(implicitResult.accepted, false);
  assert.equal(
    implicitResult.accepted === false ? implicitResult.code : null,
    "presentation_pptx_requires_explicit_request"
  );
  assert.equal(
    exportRenderCalls,
    1,
    "model-emitted PPTX must not start a render without explicit user intent"
  );
}

// ─── ADR-097 Slice 2 — patch-revise enqueue tests ─────────────────────────

function buildStandardServiceMocks(overrides: {
  findRevisionContext?: () => Promise<unknown>;
  findLatestRevisionContextForChat?: () => Promise<unknown>;
  enqueueRevision?: (input: unknown) => Promise<unknown>;
}) {
  return {
    chatRepo: {
      async findMessageByIdForAssistant(messageId: string, assistantId: string) {
        return {
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "user" as const,
          createdAt: new Date("2026-05-24T10:00:00.000Z")
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
    docJobService: {
      async countOpenJobsForChat() {
        return 0;
      },
      async enqueue() {
        throw new Error("plain enqueue should not run for revision");
      },
      async findRevisionContext() {
        return overrides.findRevisionContext ? overrides.findRevisionContext() : null;
      },
      async findLatestRevisionContextForChat() {
        return overrides.findLatestRevisionContextForChat
          ? overrides.findLatestRevisionContextForChat()
          : null;
      },
      async enqueueRevision(input: unknown) {
        return overrides.enqueueRevision
          ? overrides.enqueueRevision(input)
          : {
              docId: "doc-1",
              versionId: "version-1",
              renderJobId: "render-1",
              status: "queued" as const
            };
      }
    } as never,
    quotaCopy: {
      async build() {
        return null;
      }
    } as never,
    quotaStatus: {
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
    dailyPolicy: {
      async execute() {
        return {
          planCode: "pro",
          tools: [{ toolCode: "document", activationStatus: "active" as const }]
        };
      }
    } as never,
    secretStore: {
      async resolveSecretValueByProviderKey() {
        return "template-123";
      }
    } as never
  };
}

async function runFindLatestRevisionContextSurfacesRenderedHtmlPresence(): Promise<void> {
  let capturedEnqueueInput: Record<string, unknown> | null = null;
  const previousHtml = "<!DOCTYPE html><html><head></head><body><h1>Latest Doc</h1></body></html>";

  const mocks = buildStandardServiceMocks({
    async findLatestRevisionContextForChat() {
      return {
        docId: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        documentType: "pdf_document" as const,
        currentVersionId: "version-3",
        currentVersionNumber: 3,
        currentVersionRenderedHtml: previousHtml,
        currentVersionStructureJson: null,
        currentVersionStyleProfileJson: null,
        currentVersionEditStrategy: null,
        currentSourceJson: {
          prompt: "Latest version",
          outputFormat: "pdf",
          requestedName: "Report"
        }
      };
    },
    async enqueueRevision(input: unknown) {
      capturedEnqueueInput = input as Record<string, unknown>;
      return {
        docId: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
        versionId: "version-4",
        renderJobId: "render-4",
        status: "queued" as const
      };
    }
  });

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    mocks.chatRepo,
    mocks.docJobService,
    mocks.quotaCopy,
    mocks.quotaStatus,
    mocks.dailyPolicy,
    mocks.secretStore,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-latest",
    sourceUserMessageText: "Add a summary",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Add an executive summary section",
        outputFormat: "pdf"
        // docId omitted → should resolve via findLatestRevisionContextForChat
      }
    }
  });

  assert.equal(result.accepted, true, "latest-context revision must be accepted");
  assert.ok(capturedEnqueueInput !== null, "enqueueRevision must have been called");
  assert.equal(
    (capturedEnqueueInput as { previousVersionRenderedHtml: string }).previousVersionRenderedHtml,
    previousHtml,
    "renderedHtml from findLatestRevisionContextForChat must flow through to enqueueRevision"
  );
}

async function runEnqueueRevisionRejectsLegacyVersionWithNullRenderedHtml(): Promise<void> {
  const mocks = buildStandardServiceMocks({
    async findRevisionContext() {
      return {
        docId: "12345678-1234-4234-9234-1234567890ab",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        documentType: "pdf_document" as const,
        currentVersionId: "version-legacy-1",
        currentVersionNumber: 1,
        currentVersionRenderedHtml: null, // legacy version — no rendered HTML
        currentVersionStructureJson: null,
        currentVersionStyleProfileJson: null,
        currentVersionEditStrategy: null,
        currentSourceJson: { prompt: "Original PDF", outputFormat: "pdf", requestedName: "Report" }
      };
    }
  });

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    mocks.chatRepo,
    mocks.docJobService,
    mocks.quotaCopy,
    mocks.quotaStatus,
    mocks.dailyPolicy,
    mocks.secretStore,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Update the document",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Update the title",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pdf"
      }
    }
  });

  assert.equal(result.accepted, false, "legacy version must be rejected");
  assert.equal(
    result.accepted === false ? result.code : null,
    "document_revise_unsupported_legacy_version",
    "error code must be document_revise_unsupported_legacy_version"
  );
}

async function runEnqueueRevisionRejectsVisibleWorkspacePdfAndGuidesVisibleWorkflow(): Promise<void> {
  let enqueueRevisionCalls = 0;
  const mocks = buildStandardServiceMocks({
    async findRevisionContext() {
      return {
        docId: "12345678-1234-4234-9234-1234567890ab",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        documentType: "pdf_document" as const,
        currentVersionId: "version-visible-1",
        currentVersionNumber: 2,
        currentVersionRenderedHtml: "<html><body><h1>Workspace-backed PDF</h1></body></html>",
        currentVersionStructureJson: null,
        currentVersionStyleProfileJson: null,
        currentVersionEditStrategy: null,
        currentSourceJson: {
          prompt: "Original PDF",
          outputFormat: "pdf",
          requestedName: "Report",
          metadata: {
            documentWorkspace: {
              workspaceProjectPath: "/workspace/report",
              outputPath: "/workspace/report/report.pdf",
              inspectionPath: "/workspace/report/report.inspect.json"
            }
          }
        }
      };
    },
    async enqueueRevision() {
      enqueueRevisionCalls += 1;
      return {
        docId: "12345678-1234-4234-9234-1234567890ab",
        versionId: "version-should-not-happen",
        renderJobId: "render-should-not-happen",
        status: "queued" as const
      };
    }
  });

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    mocks.chatRepo,
    mocks.docJobService,
    mocks.quotaCopy,
    mocks.quotaStatus,
    mocks.dailyPolicy,
    mocks.secretStore,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-visible-workspace",
    sourceUserMessageText: "Update the executive summary",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Update the executive summary",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pdf"
      }
    }
  });

  assert.equal(result.accepted, false, "visible-workspace PDF revise must not queue hidden revise");
  assert.equal(
    result.accepted === false ? result.code : null,
    "revise_document_requires_visible_workspace_workflow"
  );
  assert.match(
    result.accepted === false ? (result.guidance ?? "") : "",
    /\/workspace\/report|document\.render|document\.inspect|document\.register_version|files\.attach/i
  );
  assert.equal(
    enqueueRevisionCalls,
    0,
    "hidden enqueueRevision must not run for workspace-backed PDF"
  );
}

async function runEnqueueRevisionAttachesPreviousRenderedHtmlToRuntimeRequest(): Promise<void> {
  const previousHtml =
    "<!DOCTYPE html><html><head></head><body><h1>Report</h1><p>Full body content.</p></body></html>";
  let capturedEnqueueInput: Record<string, unknown> | null = null;

  const mocks = buildStandardServiceMocks({
    async findRevisionContext() {
      return {
        docId: "12345678-1234-4234-9234-1234567890ab",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        documentType: "pdf_document" as const,
        currentVersionId: "version-1",
        currentVersionNumber: 1,
        currentVersionRenderedHtml: previousHtml,
        currentVersionStructureJson: null,
        currentVersionStyleProfileJson: null,
        currentVersionEditStrategy: null,
        currentSourceJson: { prompt: "Original PDF", outputFormat: "pdf", requestedName: "Report" }
      };
    },
    async enqueueRevision(input: unknown) {
      capturedEnqueueInput = input as Record<string, unknown>;
      return {
        docId: "12345678-1234-4234-9234-1234567890ab",
        versionId: "version-2",
        renderJobId: "render-2",
        status: "queued" as const
      };
    }
  });

  const service = new EnqueueRuntimeDeferredDocumentJobService(
    mocks.chatRepo,
    mocks.docJobService,
    mocks.quotaCopy,
    mocks.quotaStatus,
    mocks.dailyPolicy,
    mocks.secretStore,
    noopGammaThemePickerMock()
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    sourceUserMessageId: "message-1",
    sourceUserMessageText: "Fix the conclusion",
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "Fix the conclusion section",
        docId: "12345678-1234-4234-9234-1234567890ab",
        outputFormat: "pdf"
      }
    }
  });

  assert.equal(result.accepted, true, "revision with renderedHtml must be accepted");
  assert.ok(capturedEnqueueInput !== null, "enqueueRevision must have been called");
  assert.equal(
    (capturedEnqueueInput as { previousVersionRenderedHtml: string }).previousVersionRenderedHtml,
    previousHtml,
    "previousVersionRenderedHtml must be forwarded verbatim to enqueueRevision"
  );
}

async function run(): Promise<void> {
  await runAcceptedCase();
  await runCreateDataDocumentCase();
  await runCreateDataDocumentDefaultsToXlsxCase();
  await runCreateDataDocumentDocxCase();
  await runPresentationDefaultsToPdfCase();
  await runLimitReachedCase();
  await runRevisionAcceptedCase();
  await runRevisionFallsBackToLatestChatDocumentWhenDocIdIsNotUuid();
  await runPresentationRevisionDefaultsToPdfWhenOutputFormatOmitted();
  await runPdfCreateSkipsThemePickerCase();
  await runPresentationThemePickerPersistenceCase();
  await runPresentationPdfToPptxExportQueuesPptxRender();
  await runFindLatestRevisionContextSurfacesRenderedHtmlPresence();
  await runEnqueueRevisionRejectsLegacyVersionWithNullRenderedHtml();
  await runEnqueueRevisionRejectsVisibleWorkspacePdfAndGuidesVisibleWorkflow();
  await runEnqueueRevisionAttachesPreviousRenderedHtmlToRuntimeRequest();
}

void run();
