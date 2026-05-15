import assert from "node:assert/strict";
import { EnqueueRuntimeDeferredDocumentJobService } from "../src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service";

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
    } as never
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
        requestedName: "persai-investor-deck"
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
    } as never
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
          docId: "doc-existing",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          documentType: "presentation" as const,
          currentVersionId: "version-3",
          currentVersionNumber: 3,
          currentSourceJson: {
            prompt: "Original deck",
            outputFormat: "pptx",
            requestedName: "deck-v1"
          }
        };
      },
      async enqueueRevision(input) {
        enqueueCalls += 1;
        capturedRevisionRequest = input as Record<string, unknown>;
        return {
          docId: "doc-existing",
          versionId: "version-4",
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
    } as never
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
        docId: "doc-existing",
        outputFormat: "pptx"
      }
    }
  });

  assert.deepEqual(result, {
    accepted: true,
    docId: "doc-existing",
    versionId: "version-4",
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
    } as never
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

async function run(): Promise<void> {
  await runAcceptedCase();
  await runLimitReachedCase();
  await runRevisionAcceptedCase();
  await runPdfTemplateAdmissionRejectCase();
}

void run();
