import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantDocumentJobDeliveryService } from "../src/modules/workspace-management/application/assistant-document-job-delivery.service";

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
            assistantDocumentDeliveredFile: {
              updateMany: async () => ({ count: 0 }),
              findMany: async () => [],
              update: async () => undefined,
              create: async (input: Record<string, unknown>) => {
                deliveredFileCreates.push(input);
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
              fileRef: "file-1",
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
      } as never
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
            assistantDocumentDeliveredFile: {
              updateMany: async () => ({ count: 0 }),
              findMany: async () => [
                {
                  id: "delivered-file-1",
                  assistantFileId: "file-existing-1"
                }
              ],
              update: async (input: Record<string, unknown>) => {
                deliveredFileUpdates.push(input);
              },
              create: async (input: Record<string, unknown>) => {
                deliveredFileCreates.push(input);
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
            assistantFileId: "file-existing-1",
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
      } as never
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
            assistantDocumentDeliveredFile: {
              updateMany: async (input: Record<string, unknown>) => {
                deliveredFileUpdateManyCalls.push(input);
                return { count: 1 };
              },
              findMany: async () => [
                {
                  id: "delivered-file-2",
                  assistantFileId: "file-revision-1"
                }
              ],
              update: async () => undefined,
              create: async () => undefined
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
            assistantFileId: "file-revision-1",
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
      } as never
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
        (input) => input.where?.versionId === "version-3" && input.data?.isCurrentOutput === false
      ),
      true
    );
  });

  test("keeps the previous ready document current when a revision delivery fails", async () => {
    const documentUpdates: Array<Record<string, unknown>> = [];

    const service = new AssistantDocumentJobDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await (
      service as unknown as {
        failJob: (job: Record<string, unknown>, code: string, message: string) => Promise<void>;
      }
    ).failJob(
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
      "delivery failed"
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
            assistantDocumentDeliveredFile: {
              updateMany: async () => ({ count: 0 }),
              findMany: async () => [],
              update: async () => undefined,
              create: async () => undefined
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
            assistantFileId: "file-existing-early-1",
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
      } as never
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
            assistantDocumentDeliveredFile: {
              updateMany: async () => ({ count: 0 }),
              findMany: async () => [],
              update: async () => undefined,
              create: async () => undefined
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
            assistantFileId: "file-partial-1",
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
      } as never
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
            assistantDocumentDeliveredFile: {
              updateMany: async () => ({ count: 0 }),
              findMany: async () => [
                {
                  id: "delivered-file-1",
                  assistantFileId: "file-existing-1"
                }
              ],
              update: async () => undefined,
              create: async () => undefined
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
            assistantFileId: "file-existing-1",
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
      } as never
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
});
