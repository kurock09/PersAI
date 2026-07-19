import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantDocumentJobDeliveryService } from "../src/modules/workspace-management/application/assistant-document-job-delivery.service";

const WEB_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

const noopRecordModelCostLedgerService = {
  async recordCompletionFramingUsageEvent() {
    return 0;
  }
} as never;

describe("AssistantDocumentJobDeliveryService", () => {
  test("does not overwrite terminal truth when the ready_for_delivery claim is stale", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const deliveredFileCreates: Array<Record<string, unknown>> = [];
    let messageUpdateCalls = 0;
    let quotaConsumeCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 0 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 0 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Preparing your document...",
          createdAt: new Date("2026-05-15T16:00:00.000Z")
        }),
        updateMessageContent: async () => {
          messageUpdateCalls += 1;
          return null;
        },
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-1",
              path: `${WEB_SESSION_ROOT}/file-1.pdf`,
              mimeType: "application/pdf",
              originalFilename: "brief.pdf"
            }
          ]
        })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "stale-claim",
      providerStatusJson: {
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief.pdf", type: "document" }
        ],
        assistantText: "Your document is ready."
      }
    });

    assert.equal(deliveredFileCreates.length, 0);
    assert.equal(messageUpdateCalls, 0);
    assert.equal(quotaConsumeCalls, 0);
    assert.equal(
      renderJobUpdates.some((input) => input.data?.status === "delivered"),
      false
    );
  });

  test("writes presentation document metadata onto delivered chat attachments", async () => {
    const attachmentMetadataUpdates: Array<Record<string, unknown>> = [];
    let framingCalls = 0;
    let handleCompletionCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async () => ({ count: 1 })
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantChatMessageAttachment: {
              updateMany: async (input: Record<string, unknown>) => {
                attachmentMetadataUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-presentation-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Your presentation is ready.",
          createdAt: new Date("2026-05-18T11:00:00.000Z")
        }),
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-presentation-1",
              path: `${WEB_SESSION_ROOT}/file-presentation-1.pdf`,
              mimeType: "application/pdf",
              originalFilename: "board-deck.pdf"
            }
          ]
        })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {}
      } as never,
      {
        async maybeFrame() {
          framingCalls += 1;
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async prepareDelivery() {
          return "skip_legacy_frame";
        },
        async recordCanonicalCompletion() {
          handleCompletionCalls += 1;
          return { decision: "skip_legacy_frame", state: "ready" };
        }
      } as never
    );

    await service.deliverReadyJob({
      id: "job-presentation-1",
      docId: "doc-presentation-1",
      versionId: "version-presentation-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "claim-presentation-1",
      providerStatusJson: {
        artifacts: [
          {
            source: "runtime_url",
            url: "https://example.com/board-deck.pdf",
            type: "document"
          }
        ],
        assistantText: "Your presentation is ready.",
        descriptorMode: "create_presentation",
        outputFormat: "pdf",
        provider: "gamma"
      }
    });

    assert.equal(attachmentMetadataUpdates.length, 1);
    assert.deepEqual(attachmentMetadataUpdates[0]?.data?.metadata?.documentLink, {
      docId: "doc-presentation-1",
      versionId: "version-presentation-1",
      versionNumber: null,
      descriptorMode: "create_presentation",
      documentType: "presentation",
      outputFormat: "pdf",
      documentStatus: "ready",
      versionStatus: "ready",
      renderJobId: "job-presentation-1",
      outputPath: `${WEB_SESSION_ROOT}/file-presentation-1.pdf`,
      workspaceProjectPath: null,
      projectManifestPath: null,
      projectSourcePath: null,
      sourceKind: null,
      sourcePath: null,
      sourceFormat: null,
      sourceMimeType: null,
      sourceManifestPath: null,
      inspectionPath: null,
      inspectionSummary: null,
      isCurrentOutput: false
    });
    assert.equal(framingCalls, 0);
    assert.equal(handleCompletionCalls, 1);
  });

  test("writes presentation document metadata from nested providerStatus fallback", async () => {
    const attachmentMetadataUpdates: Array<Record<string, unknown>> = [];

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async () => ({ count: 1 })
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantChatMessageAttachment: {
              updateMany: async (input: Record<string, unknown>) => {
                attachmentMetadataUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-2"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-presentation-2",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Your presentation is ready.",
          createdAt: new Date("2026-05-18T11:30:00.000Z")
        }),
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-presentation-2",
              path: `${WEB_SESSION_ROOT}/file-presentation-2.pdf`,
              mimeType: "application/pdf",
              originalFilename: "school-deck.pdf"
            }
          ]
        })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {}
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-presentation-2",
      docId: "doc-presentation-2",
      versionId: "version-presentation-2",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "claim-presentation-2",
      providerStatusJson: {
        artifacts: [
          {
            source: "runtime_url",
            url: "https://example.com/school-deck.pdf",
            type: "document"
          }
        ],
        assistantText: "Your presentation is ready.",
        outputFormat: "pdf",
        providerStatus: {
          provider: "gamma"
        }
      }
    });

    assert.equal(attachmentMetadataUpdates.length, 1);
    assert.deepEqual(attachmentMetadataUpdates[0]?.data?.metadata?.documentLink, {
      docId: "doc-presentation-2",
      versionId: "version-presentation-2",
      versionNumber: null,
      descriptorMode: "create_presentation",
      documentType: "presentation",
      outputFormat: "pdf",
      documentStatus: "ready",
      versionStatus: "ready",
      renderJobId: "job-presentation-2",
      outputPath: `${WEB_SESSION_ROOT}/file-presentation-2.pdf`,
      workspaceProjectPath: null,
      projectManifestPath: null,
      projectSourcePath: null,
      sourceKind: null,
      sourcePath: null,
      sourceFormat: null,
      sourceMimeType: null,
      sourceManifestPath: null,
      inspectionPath: null,
      inspectionSummary: null,
      isCurrentOutput: false
    });
  });

  test("reuses already delivered attachments and only finalizes quota on recovery retry", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const deliveredFileCreates: Array<Record<string, unknown>> = [];
    const deliveredFileUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    let mediaDeliverCalls = 0;
    let quotaConsumeCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async (input: Record<string, unknown>) => {
                deliveredFileUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => [
          {
            id: "attachment-existing-1",
            messageId: "assistant-message-existing-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            attachmentType: "document",
            storagePath: "chat/brief.pdf",
            originalFilename: "brief.pdf",
            mimeType: "application/pdf",
            sizeBytes: BigInt(42),
            durationMs: null,
            width: null,
            height: null,
            processingStatus: "ready",
            transcription: null,
            metadata: null,
            createdAt: new Date("2026-05-15T16:00:00.000Z")
          }
        ]
      } as never,
      {
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        },
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => {
          mediaDeliverCalls += 1;
          return { attachments: [] };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-recovery-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "recovery-claim-1",
      providerStatusJson: {
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief.pdf", type: "document" }
        ],
        assistantText: "Your document is ready.",
        externalDeliveryCommitted: true,
        completionAssistantMessageId: "assistant-message-existing-1"
      }
    });

    assert.equal(mediaDeliverCalls, 0);
    assert.equal(deliveredFileCreates.length, 0);
    assert.equal(deliveredFileUpdates.length, 1);
    assert.equal(quotaConsumeCalls, 1);
    assert.equal(
      renderJobUpdates.some(
        (input) =>
          input.data?.status === "delivered" &&
          input.data?.providerStatusJson?.quotaConsumed === true
      ),
      true
    );
    assert.equal(messageUpdates.length, 0);
  });

  test("promotes a delivered revision to current version only after successful finalization", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const versionUpdates: Array<Record<string, unknown>> = [];
    const documentUpdates: Array<Record<string, unknown>> = [];
    const deliveredFileUpdateManyCalls: Array<Record<string, unknown>> = [];

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async (input: Record<string, unknown>) => {
                deliveredFileUpdateManyCalls.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async (input: Record<string, unknown>) => {
                versionUpdates.push(input);
                return undefined;
              },
              updateMany: async (input: Record<string, unknown>) => {
                versionUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-3"
              }),
              update: async (input: Record<string, unknown>) => {
                documentUpdates.push(input);
                return undefined;
              }
            }
          })
      } as never,
      {
        listByMessageId: async () => [
          {
            id: "attachment-revision-1",
            messageId: "assistant-message-revision-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            attachmentType: "document",
            storagePath: "chat/deck-v2.pptx",
            originalFilename: "deck-v2.pptx",
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            sizeBytes: BigInt(42),
            durationMs: null,
            width: null,
            height: null,
            processingStatus: "ready",
            transcription: null,
            metadata: null,
            createdAt: new Date("2026-05-15T16:00:00.000Z")
          }
        ]
      } as never,
      {
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {}
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-revision-1",
      docId: "doc-1",
      versionId: "version-4",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "claim-revision-1",
      providerStatusJson: {
        artifacts: [
          {
            source: "runtime_url",
            url: "https://example.com/deck-v2.pptx",
            type: "document"
          }
        ],
        assistantText: "Updated deck is ready.",
        externalDeliveryCommitted: true,
        completionAssistantMessageId: "assistant-message-revision-1"
      }
    });

    assert.equal(
      versionUpdates.some(
        (input) => input.where?.id === "version-4" && input.data?.status === "ready"
      ),
      true
    );
    assert.equal(
      versionUpdates.some(
        (input) =>
          input.where?.id === "version-3" ||
          (input.where?.id === undefined &&
            input.where?.status === "ready" &&
            input.data?.status === "superseded")
      ),
      true
    );
    assert.equal(
      documentUpdates.some(
        (input) =>
          input.where?.id === "doc-1" &&
          input.data?.currentVersionId === "version-4" &&
          input.data?.status === "ready"
      ),
      true
    );
    assert.equal(
      deliveredFileUpdateManyCalls.some(
        (input) =>
          input.where?.id !== undefined &&
          (input.data as { metadata?: { documentLink?: { isCurrentOutput?: boolean } } })?.metadata
            ?.documentLink?.isCurrentOutput === false
      ),
      true
    );
  });

  test("keeps the previous ready document current when a revision delivery fails", async () => {
    const documentUpdates: Array<Record<string, unknown>> = [];
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];

    const service = new AssistantDocumentJobDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-3"
              }),
              update: async (input: Record<string, unknown>) => {
                documentUpdates.push(input);
                return undefined;
              }
            }
          })
      } as never,
      {} as never,
      {
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        async maybeFrame() {
          return null;
        },
        async maybeFrameFailure() {
          return "Не удалось подготовить документ. Попробуйте запустить запрос еще раз.";
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await (
      service as unknown as {
        failDelivery: (
          job: Record<string, unknown>,
          code: string,
          message: string,
          payload: Record<string, unknown>,
          completionAssistantMessageId: string | null
        ) => Promise<void>;
      }
    ).failDelivery(
      {
        id: "job-revision-failed-1",
        docId: "doc-1",
        versionId: "version-4",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        surface: "web",
        schedulerClaimToken: "claim-failed-1"
      },
      "document_delivery_failed",
      "delivery failed",
      {
        descriptorMode: "revise_document",
        outputFormat: "pdf",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "Поправь документ",
        sourceUserMessageCreatedAt: "2026-05-16T20:00:00.000Z",
        completionAssistantMessageId: "assistant-message-failed-1"
      },
      "assistant-message-failed-1"
    );

    assert.equal(
      documentUpdates.some(
        (input) => input.where?.id === "doc-1" && input.data?.status === "ready"
      ),
      true
    );
    assert.equal(
      documentUpdates.some((input) => input.data?.status === "failed"),
      false
    );
    assert.equal(
      messageUpdates.some(
        (entry) =>
          entry.messageId === "assistant-message-failed-1" &&
          entry.content === "Не удалось подготовить документ. Попробуйте запустить запрос еще раз."
      ),
      true
    );
    assert.equal(
      renderJobUpdates.some(
        (input) =>
          input.data?.providerStatusJson?.completionAssistantMessageId ===
          "assistant-message-failed-1"
      ),
      true
    );
  });

  test("replaces the optimistic completion text with a user-visible failure message when web delivery fails", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        },
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {}
      } as never,
      {
        async maybeFrame() {
          return null;
        },
        async maybeFrameFailure(input: Record<string, unknown>) {
          return `LLM failure: ${String(input.failure?.message ?? "unknown failure")}`;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-failure-followup-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "claim-failure-followup-1",
      providerStatusJson: {
        descriptorMode: "create_presentation",
        outputFormat: "pdf",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "Сделай PDF отчет",
        sourceUserMessageCreatedAt: "2026-05-16T20:10:00.000Z",
        artifacts: [
          {
            kind: "file",
            path: `${WEB_SESSION_ROOT}/file-1.pdf`,
            mimeType: "application/pdf",
            filename: "report.pdf"
          }
        ],
        assistantText: "Preparing your document...",
        completionAssistantMessageId: "assistant-message-failure-followup-1"
      }
    });

    assert.equal(
      messageUpdates.some(
        (entry) =>
          entry.messageId === "assistant-message-failure-followup-1" &&
          entry.content === "LLM failure: Generated document could not be delivered to the chat."
      ),
      true
    );
    assert.equal(
      renderJobUpdates.some(
        (input) =>
          input.data?.status === "failed" &&
          input.data?.providerStatusJson?.completionAssistantMessageId ===
            "assistant-message-failure-followup-1"
      ),
      true
    );
  });

  test("recovers from already persisted attachments even before externalDeliveryCommitted was marked", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    let mediaDeliverCalls = 0;
    let quotaConsumeCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => [
          {
            id: "attachment-existing-early-1",
            messageId: "assistant-message-early-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            attachmentType: "document",
            storagePath: "chat/brief.pdf",
            originalFilename: "brief.pdf",
            mimeType: "application/pdf",
            sizeBytes: BigInt(42),
            durationMs: null,
            width: null,
            height: null,
            processingStatus: "ready",
            transcription: null,
            metadata: null,
            createdAt: new Date("2026-05-15T16:00:00.000Z")
          }
        ]
      } as never,
      {
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => {
          mediaDeliverCalls += 1;
          return { attachments: [] };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-recovery-early-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "recovery-early-claim-1",
      providerStatusJson: {
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief.pdf", type: "document" }
        ],
        assistantText: "Your document is ready.",
        completionAssistantMessageId: "assistant-message-early-1"
      }
    });

    assert.equal(mediaDeliverCalls, 0);
    assert.equal(quotaConsumeCalls, 1);
    assert.equal(
      renderJobUpdates.some((input) => input.data?.status === "delivered"),
      true
    );
  });

  test("does not finalize delivered status when only part of the expected artifacts were recovered", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    let quotaConsumeCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => [
          {
            id: "attachment-partial-1",
            messageId: "assistant-message-partial-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            attachmentType: "document",
            storagePath: "chat/brief-1.pdf",
            originalFilename: "brief-1.pdf",
            mimeType: "application/pdf",
            sizeBytes: BigInt(42),
            durationMs: null,
            width: null,
            height: null,
            processingStatus: "ready",
            transcription: null,
            metadata: null,
            createdAt: new Date("2026-05-15T16:00:00.000Z")
          }
        ]
      } as never,
      {
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-partial-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "partial-claim-1",
      providerStatusJson: {
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief-1.pdf", type: "document" },
          { source: "runtime_url", url: "https://example.com/brief-2.pdf", type: "document" }
        ],
        assistantText: "Your documents are ready.",
        completionAssistantMessageId: "assistant-message-partial-1"
      }
    });

    assert.equal(quotaConsumeCalls, 0);
    assert.equal(
      renderJobUpdates.some((input) => input.data?.status === "delivered"),
      false
    );
    assert.equal(
      renderJobUpdates.some(
        (input) => input.data?.lastErrorCode === "document_delivery_partial_recovery_pending"
      ),
      true
    );
  });

  test("does not retry quota consumption after quota settlement becomes ambiguous", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const deliveredFileUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    let quotaConsumeCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async (input: Record<string, unknown>) => {
                deliveredFileUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => [
          {
            id: "attachment-existing-1",
            messageId: "assistant-message-existing-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            attachmentType: "document",
            storagePath: "chat/brief.pdf",
            originalFilename: "brief.pdf",
            mimeType: "application/pdf",
            sizeBytes: BigInt(42),
            durationMs: null,
            width: null,
            height: null,
            processingStatus: "ready",
            transcription: null,
            metadata: null,
            createdAt: new Date("2026-05-15T16:00:00.000Z")
          }
        ]
      } as never,
      {
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        },
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-ambiguous-quota-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "ambiguous-claim-1",
      providerStatusJson: {
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief.pdf", type: "document" }
        ],
        assistantText: "Your document is ready.",
        externalDeliveryCommitted: true,
        completionAssistantMessageId: "assistant-message-existing-1",
        quotaSettlementPending: true
      }
    });

    assert.equal(quotaConsumeCalls, 0);
    assert.equal(messageUpdates.length, 0);
    assert.equal(
      renderJobUpdates.some((input) => input.data?.status === "delivered"),
      false
    );
    assert.equal(
      renderJobUpdates.some(
        (input) => input.data?.lastErrorCode === "document_quota_settlement_ambiguous"
      ),
      true
    );
  });

  test("skip_legacy_frame preserves current-turn and continuation model narration", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    let quotaConsumeCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantChatMessage: {
          findFirst: async () => null
        },
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-llm-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Model-owned narration remains byte-identical.",
          createdAt: new Date("2026-05-15T16:00:00.000Z")
        }),
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Model-owned narration remains byte-identical.",
          createdAt: new Date("2026-05-15T16:00:00.000Z")
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        },
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-llm-1",
              path: `${WEB_SESSION_ROOT}/file-llm-1.pdf`,
              mimeType: "application/pdf",
              originalFilename: "brief.pdf"
            }
          ]
        })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          throw new Error("skip_legacy_frame must not frame");
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        prepareDelivery: async () => "skip_legacy_frame",
        recordCanonicalCompletion: async () => ({
          decision: "skip_legacy_frame",
          state: "completed"
        })
      } as never
    );

    await service.deliverReadyJob({
      id: "job-llm-framing-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "llm-claim-1",
      providerStatusJson: {
        descriptorMode: "create_presentation",
        outputFormat: "pdf",
        sourceUserMessageId: "message-1",
        sourceUserMessageText: "Create a PDF brief",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z",
        artifacts: [
          {
            kind: "file",
            objectKey: `${WEB_SESSION_ROOT}/file-llm-1.pdf`,
            mimeType: "application/pdf",
            filename: "brief.pdf"
          }
        ],
        assistantText: "Your document is ready.",
        completionAssistantMessageId: "assistant-message-current-turn"
      }
    });

    assert.equal(quotaConsumeCalls, 1);
    assert.deepEqual(messageUpdates, []);

    await service.deliverReadyJob({
      id: "job-continuation-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "llm-claim-1",
      providerStatusJson: {
        descriptorMode: "create_presentation",
        outputFormat: "pdf",
        sourceUserMessageId: "message-1",
        sourceUserMessageText: "Create a PDF brief",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z",
        completionAssistantMessageId: "assistant-message-continuation",
        artifacts: [
          {
            kind: "file",
            objectKey: `${WEB_SESSION_ROOT}/file-llm-1.pdf`,
            mimeType: "application/pdf",
            filename: "brief.pdf"
          }
        ]
      }
    });
    assert.deepEqual(messageUpdates, []);
  });

  test("skips provider framing call when payload already carries a cached completionAssistantText (defer-retry safe)", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    const deliveredFileUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    let maybeFrameCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantChatMessage: {
          findFirst: async () => null
        },
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async (input: Record<string, unknown>) => {
                deliveredFileUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({ currentVersionId: "version-1" }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => [
          {
            id: "attachment-cache-1",
            storagePath: `${WEB_SESSION_ROOT}/file-cache-1.pdf`,
            mimeType: "application/pdf"
          }
        ]
      } as never,
      {
        createMessage: async () => {
          throw new Error(
            "createMessage must not be called when completionAssistantMessageId exists"
          );
        },
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Preparing your document...",
          createdAt: new Date("2026-05-15T16:00:00.000Z")
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        },
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => {
          throw new Error(
            "mediaDeliveryService.deliver must not be called when attachments already exist"
          );
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {}
      } as never,
      {
        async maybeFrame() {
          maybeFrameCalls += 1;
          return { text: "Fresh LLM completion framing (should NOT run on retry).", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-cache-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "cache-claim-1",
      providerStatusJson: {
        descriptorMode: "create_presentation",
        outputFormat: "pdf",
        sourceUserMessageId: "user-message-cache-1",
        sourceUserMessageText: "Render a brief.",
        sourceUserMessageCreatedAt: "2026-05-15T15:55:00.000Z",
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief.pdf", type: "document" }
        ],
        assistantText: "Your document is ready.",
        externalDeliveryCommitted: true,
        completionAssistantMessageId: "assistant-message-cache-1",
        completionAssistantText: "CACHED: Готово. Документ прилетел."
      }
    });

    assert.equal(
      maybeFrameCalls,
      0,
      "framing model must NOT be called when cached text is present"
    );
    assert.equal(
      messageUpdates.some((entry) => entry.content === "CACHED: Готово. Документ прилетел."),
      true,
      "final message content must equal the cached framed text"
    );
  });

  test("persists framed completionAssistantText into providerStatusJson after the first framing call", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    let maybeFrameCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantChatMessage: {
          findFirst: async () => null
        },
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            renderJobUpdates.push(input);
            return { count: 1 };
          }
        },
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                renderJobUpdates.push(input);
                return { count: 1 };
              }
            },
            assistantChatMessageAttachment: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({ currentVersionId: "version-1" }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-cache-2",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Preparing your document...",
          createdAt: new Date("2026-05-15T16:00:00.000Z")
        }),
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Preparing your document...",
          createdAt: new Date("2026-05-15T16:00:00.000Z")
        }),
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-cache-2",
              path: `${WEB_SESSION_ROOT}/file-cache-2.pdf`,
              mimeType: "application/pdf",
              originalFilename: "brief.pdf"
            }
          ]
        })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram resolution should not run for web jobs");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {}
      } as never,
      {
        async maybeFrame() {
          maybeFrameCalls += 1;
          return { text: "Готово. Документ собран.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    await service.deliverReadyJob({
      id: "job-cache-persist-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "cache-persist-claim-1",
      providerStatusJson: {
        descriptorMode: "create_presentation",
        outputFormat: "pdf",
        sourceUserMessageId: "user-message-cache-2",
        sourceUserMessageText: "Render a brief.",
        sourceUserMessageCreatedAt: "2026-05-15T15:55:00.000Z",
        artifacts: [
          { source: "runtime_url", url: "https://example.com/brief.pdf", type: "document" }
        ],
        assistantText: "Your document is ready."
      }
    });

    assert.equal(maybeFrameCalls, 1, "framing model must run exactly once on the first delivery");
    const cachedPersisted = renderJobUpdates.some((update) => {
      const data = update.data as Record<string, unknown> | undefined;
      const payload = data?.providerStatusJson as Record<string, unknown> | undefined;
      return payload?.completionAssistantText === "Готово. Документ собран.";
    });
    assert.equal(
      cachedPersisted,
      true,
      "framed completion text must be persisted into providerStatusJson so a deferred retry can reuse it"
    );
  });

  test("serializes revision promotion by durable version number and is retry-idempotent", async () => {
    const document = { currentVersionId: "version-3", status: "ready" };
    const versions = new Map([
      ["version-3", { versionNumber: 3, status: "ready" }],
      ["version-4", { versionNumber: 4, status: "ready" }],
      ["version-5", { versionNumber: 5, status: "ready" }]
    ]);
    const jobs = new Map([
      ["job-5", "ready_for_delivery"],
      ["job-4", "ready_for_delivery"]
    ]);
    const lockCalls: unknown[] = [];
    const versionUpdates: Array<Record<string, unknown>> = [];
    const supersessionCalls: Array<Record<string, unknown>> = [];
    const attachmentCurrentnessUpdates: unknown[][] = [];
    const transaction = {
      assistantDocumentRenderJob: {
        updateMany: async (input: {
          where: { id: string; status: string };
          data: { status: string };
        }) => {
          if (jobs.get(input.where.id) !== input.where.status) {
            return { count: 0 };
          }
          jobs.set(input.where.id, input.data.status);
          return { count: 1 };
        }
      },
      assistantDocumentVersion: {
        findUnique: async (input: { where: { id: string } }) => {
          const version = versions.get(input.where.id);
          return version === undefined ? null : { versionNumber: version.versionNumber };
        },
        update: async (input: {
          where: { id: string };
          data: { status: "ready" | "superseded" };
        }) => {
          versionUpdates.push(input);
          const version = versions.get(input.where.id);
          assert.notEqual(version, undefined);
          version!.status = input.data.status;
        },
        updateMany: async (input: {
          where: { id: string; status: "ready" };
          data: { status: "superseded" };
        }) => {
          supersessionCalls.push(input);
          const version = versions.get(input.where.id);
          if (version?.status !== input.where.status) return { count: 0 };
          version.status = input.data.status;
          return { count: 1 };
        }
      },
      assistantDocument: {
        update: async (input: { data: { currentVersionId: string; status: string } }) => {
          document.currentVersionId = input.data.currentVersionId;
          document.status = input.data.status;
        }
      },
      $queryRaw: async (query: unknown) => {
        lockCalls.push(query);
        return [{ currentVersionId: document.currentVersionId }];
      },
      $executeRaw: async (query: { values?: unknown[] }) => {
        attachmentCurrentnessUpdates.push(query.values ?? []);
        return 1;
      }
    };
    const prisma = {
      $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction)
    };
    const service = new AssistantDocumentJobDeliveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noopRecordModelCostLedgerService,
      {
        async prepareDelivery() {
          return "legacy_frame" as const;
        },
        async recordCanonicalCompletion() {
          return { decision: "legacy_frame" as const, state: "completed" as const };
        }
      }
    );
    const finalize = (jobId: string, versionId: string) =>
      (
        service as unknown as {
          finalizeDelivery: (
            job: Record<string, unknown>,
            payload: Record<string, unknown>
          ) => Promise<boolean>;
        }
      ).finalizeDelivery(
        {
          id: jobId,
          docId: "doc-1",
          versionId,
          schedulerClaimToken: `${jobId}-claim`
        },
        {},
        [`attachment-${versionId}`]
      );

    assert.equal(await finalize("job-5", "version-5"), true);
    assert.equal(document.currentVersionId, "version-5");
    assert.equal(versions.get("version-3")?.status, "superseded");

    assert.equal(await finalize("job-4", "version-4"), true);
    assert.equal(document.currentVersionId, "version-5", "late v4 must not regress current v5");
    assert.equal(versions.get("version-4")?.status, "superseded");
    assert.equal(versions.get("version-5")?.status, "ready");
    assert.deepEqual(
      attachmentCurrentnessUpdates.map((values) => values.slice(0, 4)),
      [
        ["superseded", false, "doc-1", "version-3"],
        ["ready", true, "doc-1", "version-5"],
        ["superseded", false, "doc-1", "version-4"]
      ],
      "attachment metadata follows the locked promotion outcome, not delivery order"
    );
    assert.deepEqual(
      supersessionCalls.map((input) => input.where?.id),
      ["version-3"],
      "only the exact prior current version is superseded, once"
    );

    assert.equal(await finalize("job-5", "version-5"), false, "same job retry is idempotent");
    assert.equal(lockCalls.length, 2, "each accepted finalizer locks the document row");
  });
});
