import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ConversationalPublishService } from "../src/modules/workspace-management/application/conversational-publish.service";
import { AssistantDocumentJobDeliveryService } from "../src/modules/workspace-management/application/assistant-document-job-delivery.service";
import { AssistantMediaJobCompletionDeliveryService } from "../src/modules/workspace-management/application/workspace-media-job-completion-delivery.service";
import { AssistantAsyncJobContinuationSchedulerService } from "../src/modules/workspace-management/application/assistant-async-job-continuation-scheduler.service";
import { StreamWebAsyncContinuationService } from "../src/modules/workspace-management/application/stream-web-async-continuation.service";

const noopRecordModelCostLedgerService = {
  async recordCompletionFramingUsageEvent() {
    return 0;
  }
} as never;

const noopAssistantRepository = {
  async findById() {
    return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
  }
} as never;

const noopTrackWorkspaceQuotaUsageService = {
  async markAssistantMonthlyMediaQuotaReconciliationRequired() {
    return undefined;
  },
  async consumeAssistantMonthlyToolQuotaSuccessOnly() {
    return undefined;
  },
  async releaseAssistantMonthlyMediaQuota() {
    return undefined;
  }
} as never;

describe("ADR-162 Phase 1 ConversationalPublish", () => {
  test("ordinary media completion: delivered + handle ready + zero chat message + null completionAssistantMessageId", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    let createMessageCalls = 0;
    let deliverCalls = 0;
    let settleWithoutDeliveryCalls = 0;
    let handleCompletionCalls = 0;

    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-ordinary-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw a cat",
                  sourceUserMessageCreatedAt: "2026-07-22T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "draw a cat",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: null,
                artifactsJson: [{ artifactId: "artifact-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: {
              update: async () => undefined
            }
          }),
        assistantAsyncJobHandle: {
          findUnique: async () => ({
            narrationOwner: "continuation",
            narrationDecision: "notify_subscribed"
          }),
          findMany: async () => []
        },
        assistantMediaJob: {
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return { id: "should-not-create" };
        },
        findMessageByIdForAssistant: async () => null,
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => {
          deliverCalls += 1;
          return { attachments: [] };
        },
        settleProducedArtifactsWithoutDelivery: async () => {
          settleWithoutDeliveryCalls += 1;
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram should not run");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve");
        }
      } as never,
      {
        async maybeFrame() {
          throw new Error("framing should not run for deferred ordinary");
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService,
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

    const processed = await service.processPendingBatch();
    assert.equal(processed, 1);
    assert.equal(createMessageCalls, 0);
    assert.equal(deliverCalls, 0);
    assert.equal(settleWithoutDeliveryCalls, 1);
    assert.equal(handleCompletionCalls, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    assert.equal(
      (finalUpdates.at(-1)?.data as { completionAssistantMessageId?: string | null })
        ?.completionAssistantMessageId,
      undefined
    );
  });

  test("catch-up publish creates one message + attachments; narration updates same id", async () => {
    const createdMessages: string[] = [];
    const deliveredMessageIds: string[] = [];
    const mediaPins: string[] = [];
    const handleStamps: string[] = [];
    const narrationUpdates: Array<{ id: string; content: string }> = [];

    const publish = new ConversationalPublishService(
      {
        assistantMediaJob: {
          findUnique: async () => ({
            id: "media-job-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1",
            surface: "web",
            artifactsJson: [{ artifactId: "a1", kind: "image" }],
            completionAssistantMessageId: null,
            status: "delivered"
          }),
          updateMany: async (input: { data: { completionAssistantMessageId?: string } }) => {
            if (typeof input.data.completionAssistantMessageId === "string") {
              mediaPins.push(input.data.completionAssistantMessageId);
            }
            return { count: 1 };
          }
        },
        assistantAsyncJobHandle: {
          updateMany: async (input: { data: { continuationAssistantMessageId?: string } }) => {
            if (typeof input.data.continuationAssistantMessageId === "string") {
              handleStamps.push(input.data.continuationAssistantMessageId);
            }
            return { count: 1 };
          }
        },
        assistantDocumentRenderJob: {
          findUnique: async () => null
        }
      } as never,
      {
        createMessage: async () => {
          createdMessages.push("publish-msg-1");
          return {
            id: "publish-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            content: "",
            createdAt: new Date()
          };
        }
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        deliver: async (input: { messageId: string; settleQuota?: boolean }) => {
          deliveredMessageIds.push(input.messageId);
          assert.equal(input.settleQuota, false);
          return {
            attachments: [{ id: "att-1", originalFilename: "cat.png", path: "/workspace/cat.png" }]
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("web path should not resolve telegram");
        }
      } as never
    );

    const publishedId = await publish.publishForCatchUp({
      handleId: "handle-1",
      kind: "media",
      canonicalJobId: "media-job-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      channel: "web"
    });
    assert.equal(publishedId, "publish-msg-1");
    assert.deepEqual(createdMessages, ["publish-msg-1"]);
    assert.deepEqual(deliveredMessageIds, ["publish-msg-1"]);
    assert.deepEqual(mediaPins, ["publish-msg-1"]);
    assert.ok(handleStamps.includes("publish-msg-1"));
    assert.equal(new Set(handleStamps).size, 1);

    const scheduler = new AssistantAsyncJobContinuationSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [{ messageId: "publish-msg-1" }],
            assistantMediaJob: {
              findUnique: async () => ({
                completionAssistantMessageId: "publish-msg-1"
              })
            },
            assistantDocumentRenderJob: {
              findUnique: async () => null
            },
            assistantChatMessage: {
              updateMany: async (input: { where: { id: string }; data: { content: string } }) => {
                narrationUpdates.push({
                  id: input.where.id,
                  content: input.data.content
                });
                return { count: 1 };
              },
              create: async () => {
                throw new Error("must not invent a second bubble");
              }
            },
            assistantAsyncJobHandle: {
              updateMany: async () => ({ count: 1 })
            }
          })
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { publishForCatchUp: async () => null } as never
    );

    const persisted = await (
      scheduler as unknown as {
        persistOutputOnce: (
          claim: { id: string; claimToken: string },
          context: {
            handle: {
              kind: "media";
              canonicalJobId: string;
              chatId: string;
              assistantId: string;
              continuationClientTurnId: string;
            };
            facts: Record<string, unknown>;
          },
          turnResult: { answerText: string }
        ) => Promise<{ outcome: string; messageId: string }>;
      }
    ).persistOutputOnce(
      { id: "handle-1", claimToken: "claim-1" },
      {
        handle: {
          kind: "media",
          canonicalJobId: "media-job-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          continuationClientTurnId: "async-cont:1"
        },
        facts: { jobRef: "jr1" }
      },
      { answerText: "Here is your cat." }
    );

    assert.deepEqual(persisted, { outcome: "existing", messageId: "publish-msg-1" });
    assert.deepEqual(narrationUpdates, [{ id: "publish-msg-1", content: "Here is your cat." }]);
  });

  test("inline await path still attaches into open bubble at delivery", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const delivered: Array<{ messageId: string }> = [];
    let createMessageCalls = 0;

    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-inline-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "await this image",
                  sourceUserMessageCreatedAt: "2026-07-22T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "await this image",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: null,
                artifactsJson: [{ artifactId: "artifact-inline", kind: "image" }],
                completionAssistantMessageId: null,
                assistantAcknowledgementMessageId: "open-bubble-1",
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: {
              update: async () => undefined
            }
          }),
        assistantAsyncJobHandle: {
          findUnique: async () => ({
            narrationOwner: "current_turn",
            narrationDecision: "current_turn_inline",
            continuationAssistantMessageId: null
          }),
          findMany: async () => []
        },
        assistantMediaJob: {
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return { id: "should-not-create" };
        },
        findMessageByIdForAssistant: async () => ({
          id: "open-bubble-1",
          content: "Working on it.",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async (input: { messageId: string }) => {
          delivered.push({ messageId: input.messageId });
          return {
            attachments: [{ id: "att-inline", originalFilename: "inline.png" }]
          };
        },
        settleProducedArtifactsWithoutDelivery: async () => {
          throw new Error("inline must deliver, not settle-without-delivery");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram should not run");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: null, usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService,
      {
        async prepareDelivery() {
          return "skip_legacy_frame";
        },
        async recordCanonicalCompletion() {
          return { decision: "skip_legacy_frame", state: "completed" };
        }
      } as never
    );

    const processed = await service.processPendingBatch();
    assert.equal(processed, 1);
    assert.equal(createMessageCalls, 0);
    assert.deepEqual(delivered, [{ messageId: "open-bubble-1" }]);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    assert.ok(
      finalUpdates.some(
        (update) =>
          (update.data as { completionAssistantMessageId?: string })
            ?.completionAssistantMessageId === "open-bubble-1"
      )
    );
  });

  test("document ordinary: no Preparing invent at worker", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    let createMessageCalls = 0;
    let deliverCalls = 0;
    let quotaConsumeCalls = 0;
    let handleCompletionCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantAsyncJobHandle: {
          findUnique: async () => ({
            narrationOwner: "continuation",
            narrationDecision: "notify_subscribed"
          })
        },
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
              updateMany: async () => ({ count: 0 })
            },
            assistantDocumentVersion: {
              findUnique: async () => ({ versionNumber: 1 }),
              update: async () => undefined,
              updateMany: async () => ({ count: 0 })
            },
            assistantDocument: {
              findUnique: async () => ({ currentVersionId: null }),
              update: async () => undefined
            },
            $queryRaw: async () => [{ currentVersionId: null }],
            $executeRaw: async () => 0
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return {
            id: "should-not-create",
            content: "Preparing your document..."
          };
        },
        findMessageByIdForAssistant: async () => null,
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1"
          };
        }
      } as never,
      {
        deliver: async () => {
          deliverCalls += 1;
          return { attachments: [] };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram should not resolve");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          quotaConsumeCalls += 1;
        }
      } as never,
      {
        async maybeFrame() {
          throw new Error("framing should not run");
        }
      } as never,
      {
        async recordPersistedBillingFactsEvent() {
          return 0;
        },
        async recordCompletionFramingUsageEvent() {
          return 0;
        }
      } as never,
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
      id: "doc-job-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      schedulerClaimToken: "claim-1",
      providerStatusJson: {
        artifacts: [{ artifactId: "doc-artifact-1", kind: "file" }],
        assistantText: null,
        sourceUserMessageText: "make a deck",
        sourceUserMessageId: "user-1",
        sourceUserMessageCreatedAt: "2026-07-22T09:00:00.000Z",
        descriptorMode: "create_presentation",
        outputFormat: "pdf"
      }
    });

    assert.equal(createMessageCalls, 0);
    assert.equal(deliverCalls, 0);
    assert.equal(quotaConsumeCalls, 1);
    assert.equal(handleCompletionCalls, 1);
    const terminal = renderJobUpdates.find(
      (update) => (update.data as { status?: string })?.status === "delivered"
    );
    assert.ok(terminal);
    const payload = (terminal?.data as { providerStatusJson?: Record<string, unknown> })
      ?.providerStatusJson;
    assert.equal(payload?.completionAssistantMessageId, null);
  });

  test("empty artifacts publish creates message, no throw, no attach", async () => {
    const created: string[] = [];
    let deliverCalls = 0;
    let pinnedId: string | null = null;

    const publish = new ConversationalPublishService(
      {
        assistantMediaJob: {
          findUnique: async () => ({
            id: "media-job-empty",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1",
            surface: "web",
            artifactsJson: [],
            completionAssistantMessageId: pinnedId,
            status: "failed"
          }),
          updateMany: async (input: { data: { completionAssistantMessageId?: string } }) => {
            if (typeof input.data.completionAssistantMessageId === "string") {
              pinnedId = input.data.completionAssistantMessageId;
            }
            return { count: 1 };
          }
        },
        assistantAsyncJobHandle: {
          updateMany: async () => ({ count: 1 })
        },
        assistantDocumentRenderJob: {
          findUnique: async () => null
        }
      } as never,
      {
        createMessage: async () => {
          created.push("empty-fail-msg");
          return {
            id: "empty-fail-msg",
            chatId: "chat-1",
            assistantId: "assistant-1",
            content: "",
            createdAt: new Date()
          };
        }
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        deliver: async () => {
          deliverCalls += 1;
          return { attachments: [] };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("web path should not resolve telegram");
        }
      } as never
    );

    const first = await publish.publishForCatchUp({
      handleId: "handle-empty",
      kind: "media",
      canonicalJobId: "media-job-empty",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      channel: "web"
    });
    assert.equal(first, "empty-fail-msg");
    assert.deepEqual(created, ["empty-fail-msg"]);
    assert.equal(deliverCalls, 0);
    assert.equal(pinnedId, "empty-fail-msg");

    const reused = await publish.publishForCatchUp({
      handleId: "handle-empty",
      kind: "media",
      canonicalJobId: "media-job-empty",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      channel: "web"
    });
    assert.equal(reused, "empty-fail-msg");
    assert.deepEqual(created, ["empty-fail-msg"]);
    assert.equal(deliverCalls, 0);
  });

  test("ordinary document failDelivery does not invent chat for owned deferred handle", async () => {
    const renderJobUpdates: Array<Record<string, unknown>> = [];
    let createMessageCalls = 0;
    let handleCompletionCalls = 0;

    const service = new AssistantDocumentJobDeliveryService(
      {
        assistantAsyncJobHandle: {
          findUnique: async () => ({
            narrationOwner: "continuation",
            narrationDecision: "notify_subscribed"
          })
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
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({ currentVersionId: null }),
              update: async () => undefined
            }
          })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return { id: "should-not-create", content: "failure invent" };
        },
        findMessageByIdForAssistant: async () => null,
        updateMessageContent: async () => null,
        deleteMessage: async () => true
      } as never,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram should not resolve");
        }
      } as never,
      {
        async consumeAssistantMonthlyToolQuotaSuccessOnly() {
          return undefined;
        }
      } as never,
      {
        async maybeFrame() {
          throw new Error("framing should not run");
        },
        async maybeFrameFailure() {
          throw new Error("failure framing should not invent for deferred");
        }
      } as never,
      {
        async recordPersistedBillingFactsEvent() {
          return 0;
        },
        async recordCompletionFramingUsageEvent() {
          return 0;
        }
      } as never,
      {
        async prepareDelivery() {
          return "skip_legacy_frame";
        },
        async recordCanonicalCompletion() {
          handleCompletionCalls += 1;
          return { decision: "skip_legacy_frame", state: "failed" };
        }
      } as never
    );

    await (
      service as unknown as {
        failDelivery: (
          job: Record<string, unknown>,
          code: string,
          message: string,
          payload: Record<string, unknown> | null,
          completionAssistantMessageId: string | null
        ) => Promise<void>;
      }
    ).failDelivery(
      {
        id: "doc-job-fail-ordinary",
        docId: "doc-1",
        versionId: "version-1",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        chatId: "chat-1",
        surface: "web",
        schedulerClaimToken: "claim-fail-1"
      },
      "document_delivery_failed",
      "Generated document could not be delivered to the chat.",
      {
        artifacts: [{ artifactId: "doc-artifact-fail", kind: "file" }],
        assistantText: null,
        sourceUserMessageText: "make a deck",
        completionAssistantMessageId: null
      },
      null
    );

    assert.equal(createMessageCalls, 0);
    assert.equal(handleCompletionCalls, 1);
    const terminal = renderJobUpdates.find(
      (update) => (update.data as { status?: string })?.status === "failed"
    );
    assert.ok(terminal);
    const payload = (terminal?.data as { providerStatusJson?: Record<string, unknown> })
      ?.providerStatusJson;
    assert.equal(payload?.completionAssistantMessageId, null);
  });

  test("ordinary media failDelivery does not createMessage for owned deferred handle", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    let createMessageCalls = 0;
    let handleCompletionCalls = 0;

    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-fail-ordinary",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw",
                  sourceUserMessageCreatedAt: "2026-07-22T09:00:00.000Z"
                },
                resultText: null,
                artifactsJson: [],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5,
                lastErrorCode: "provider_failed",
                lastErrorMessage: "provider failed"
              }
            ],
            assistantMediaJob: {
              update: async () => undefined
            }
          }),
        assistantAsyncJobHandle: {
          findUnique: async () => ({
            narrationOwner: "continuation",
            narrationDecision: "notify_subscribed"
          }),
          findMany: async () => []
        },
        assistantMediaJob: {
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return { id: "should-not-create" };
        },
        findMessageByIdForAssistant: async () => null,
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => ({ attachments: [] }),
        settleProducedArtifactsWithoutDelivery: async () => undefined
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram should not run");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: null, usage: null };
        },
        async maybeFrameFailure() {
          throw new Error("failure framing should not invent for deferred");
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService,
      {
        async prepareDelivery() {
          return "skip_legacy_frame";
        },
        async recordCanonicalCompletion() {
          handleCompletionCalls += 1;
          return { decision: "skip_legacy_frame", state: "failed" };
        }
      } as never
    );

    const processed = await service.processPendingBatch();
    assert.equal(processed, 1);
    assert.equal(createMessageCalls, 0);
    assert.equal(handleCompletionCalls, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.equal(
      (finalUpdates.at(-1)?.data as { completionAssistantMessageId?: string | null })
        ?.completionAssistantMessageId,
      undefined
    );
  });

  test("pinned id with 1 of 2 artifacts retries deliver for the remaining artifact", async () => {
    let createMessageCalls = 0;
    let deliverAttempts = 0;
    const deliveredArtifactPaths: string[] = [];
    let attached = [
      {
        id: "att-partial-1",
        storagePath: "/workspace/a1.png",
        originalFilename: "a1.png"
      }
    ];

    const publish = new ConversationalPublishService(
      {
        assistantMediaJob: {
          findUnique: async () => ({
            id: "media-job-partial",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1",
            surface: "web",
            artifactsJson: [
              {
                artifactId: "a1",
                kind: "image",
                storagePath: "/workspace/a1.png",
                mimeType: "image/png",
                filename: "a1.png",
                sizeBytes: 10,
                voiceNote: false
              },
              {
                artifactId: "a2",
                kind: "image",
                storagePath: "/workspace/a2.png",
                mimeType: "image/png",
                filename: "a2.png",
                sizeBytes: 12,
                voiceNote: false
              }
            ],
            completionAssistantMessageId: "pinned-partial-msg",
            status: "delivered"
          }),
          updateMany: async () => ({ count: 1 })
        },
        assistantAsyncJobHandle: {
          updateMany: async () => ({ count: 1 })
        },
        assistantDocumentRenderJob: {
          findUnique: async () => null
        }
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return {
            id: "should-not-create",
            chatId: "chat-1",
            assistantId: "assistant-1",
            content: "",
            createdAt: new Date()
          };
        }
      } as never,
      {
        listByMessageId: async () => attached
      } as never,
      {
        deliver: async (input: { messageId: string; artifacts: Array<{ objectKey?: string }> }) => {
          deliverAttempts += 1;
          assert.equal(input.messageId, "pinned-partial-msg");
          for (const artifact of input.artifacts) {
            if (typeof artifact.objectKey === "string") {
              deliveredArtifactPaths.push(artifact.objectKey);
            }
          }
          attached = [
            ...attached,
            {
              id: "att-partial-2",
              storagePath: "/workspace/a2.png",
              originalFilename: "a2.png"
            }
          ];
          return {
            attachments: [
              { id: "att-partial-2", originalFilename: "a2.png", path: "/workspace/a2.png" }
            ]
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("web path should not resolve telegram");
        }
      } as never
    );

    const publishedId = await publish.publishForCatchUp({
      handleId: "handle-partial",
      kind: "media",
      canonicalJobId: "media-job-partial",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      channel: "web"
    });
    assert.equal(publishedId, "pinned-partial-msg");
    assert.equal(createMessageCalls, 0);
    assert.equal(deliverAttempts, 1);
    assert.deepEqual(deliveredArtifactPaths, ["/workspace/a2.png"]);
    assert.equal(attached.length, 2);
  });

  test("retry after create+pin with failed attach reuses same messageId (no second create)", async () => {
    let pinnedId: string | null = null;
    let createMessageCalls = 0;
    let deliverAttempts = 0;

    const publish = new ConversationalPublishService(
      {
        assistantMediaJob: {
          findUnique: async () => ({
            id: "media-job-retry",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            chatId: "chat-1",
            surface: "web",
            artifactsJson: [{ artifactId: "a-retry", kind: "image" }],
            completionAssistantMessageId: pinnedId,
            status: "delivered"
          }),
          updateMany: async (input: { data: { completionAssistantMessageId?: string } }) => {
            if (typeof input.data.completionAssistantMessageId === "string") {
              pinnedId = input.data.completionAssistantMessageId;
            }
            return { count: 1 };
          }
        },
        assistantAsyncJobHandle: {
          updateMany: async () => ({ count: 1 })
        },
        assistantDocumentRenderJob: {
          findUnique: async () => null
        }
      } as never,
      {
        createMessage: async () => {
          createMessageCalls += 1;
          return {
            id: "pinned-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            content: "",
            createdAt: new Date()
          };
        }
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        deliver: async (input: { messageId: string }) => {
          deliverAttempts += 1;
          if (deliverAttempts === 1) {
            throw new Error("attach crashed after pin");
          }
          assert.equal(input.messageId, "pinned-msg-1");
          return {
            attachments: [
              { id: "att-retry", originalFilename: "retry.png", path: "/workspace/retry.png" }
            ]
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("web path should not resolve telegram");
        }
      } as never
    );

    await assert.rejects(
      () =>
        publish.publishForCatchUp({
          handleId: "handle-retry",
          kind: "media",
          canonicalJobId: "media-job-retry",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          chatId: "chat-1",
          channel: "web"
        }),
      /attach crashed after pin/
    );
    assert.equal(createMessageCalls, 1);
    assert.equal(pinnedId, "pinned-msg-1");

    const retriedId = await publish.publishForCatchUp({
      handleId: "handle-retry",
      kind: "media",
      canonicalJobId: "media-job-retry",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      channel: "web"
    });
    assert.equal(retriedId, "pinned-msg-1");
    assert.equal(createMessageCalls, 1);
    assert.equal(deliverAttempts, 2);
  });

  test("stream-web and telegram scheduler always call required ConversationalPublish", async () => {
    const streamPublishCalls: string[] = [];
    const tgPublishCalls: string[] = [];

    const streamService = new StreamWebAsyncContinuationService(
      {
        stream: async () => ({
          mode: "outcome",
          result: { outcome: "busy" }
        })
      } as never,
      {
        claim: async () => "claimed",
        markRunning: async () => undefined,
        abandonPreAcceptanceAttempt: async () => undefined,
        bindAssistantMessageId: async () => undefined
      } as never,
      {
        register: async () => undefined,
        releaseAsync: async () => undefined,
        touch: async () => undefined,
        publish: () => undefined
      } as never,
      {
        register: async () => undefined,
        release: () => undefined,
        wasUserStopped: () => false
      } as never,
      {
        publishForCatchUp: async (input: { canonicalJobId: string }) => {
          streamPublishCalls.push(input.canonicalJobId);
          return null;
        }
      } as never
    );

    await streamService.processWebClaim({
      claim: { id: "handle-stream-pub", claimToken: "claim-stream" },
      context: {
        handle: {
          id: "handle-stream-pub",
          kind: "sandbox",
          canonicalJobId: "sandbox-job-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          userId: "user-1",
          chatId: "chat-1",
          channel: "web",
          threadKey: "thread-1",
          continuationClientTurnId: "async-cont:stream-pub",
          sourceUserMessageId: "00000000-0000-4000-8000-000000000099",
          retryCount: 0
        },
        sourceUserMessage: { id: "00000000-0000-4000-8000-000000000099" },
        sessionId: "session-1"
      },
      request: { requestId: "req-stream-pub" } as never,
      timeoutMs: 1_000,
      callbacks: {
        persistOutputOnce: async () => ({ outcome: "persisted" as const, messageId: "x" }),
        finalizeContinuationChildren: async () => undefined,
        deliverContinuationArtifactsOnce: async () => undefined,
        failClaimVisibly: async () => undefined,
        settleDeliveredCatchUpFailure: async () => null,
        markDispatched: async () => true,
        releasePreDispatchBusy: async () => undefined,
        completeClaim: async () => true,
        deliveryAttemptsSettled: async () => true,
        retryAt: () => new Date()
      }
    });
    assert.deepEqual(streamPublishCalls, ["sandbox-job-1"]);

    let executeCalled = false;
    const tgService = new AssistantAsyncJobContinuationSchedulerService(
      {} as never,
      {
        releaseClaimToReady: async () => "released",
        markDispatched: async () => true
      } as never,
      {
        admitCatchUpAtBoundary: async () => ({ allowed: true as const }),
        claimReadyCatchUps: async () => [],
        releaseCatchUp: async () => undefined,
        heartbeatCatchUp: async () => true,
        catchUpHeartbeatIntervalMs: () => 20_000
      } as never,
      {
        execute: async () => {
          executeCalled = true;
          return { outcome: "busy" };
        }
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        publishForCatchUp: async (input: { canonicalJobId: string }) => {
          tgPublishCalls.push(input.canonicalJobId);
          return "tg-publish-msg";
        }
      } as never
    );
    const internal = tgService as unknown as {
      loadAndValidateContext: () => Promise<Record<string, unknown>>;
      buildRequest: () => Promise<{ request: Record<string, unknown>; timeoutMs: number }>;
      processClaim: (claim: { id: string; claimToken: string }) => Promise<void>;
    };
    internal.loadAndValidateContext = async () => ({
      handle: {
        id: "handle-tg-pub",
        kind: "media",
        canonicalJobId: "media-job-tg-pub",
        retryCount: 0,
        channel: "telegram",
        chatId: "chat-tg",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        threadKey: "telegram:1:session:main"
      },
      sourceUserMessage: { id: "user-msg-1" },
      session: { id: "session-tg" }
    });
    internal.buildRequest = async () => ({
      request: { requestId: "dispatch-tg-pub" },
      timeoutMs: 50
    });
    await internal.processClaim({ id: "handle-tg-pub", claimToken: "claim-tg-pub" });
    assert.deepEqual(tgPublishCalls, ["media-job-tg-pub"]);
    assert.equal(executeCalled, true);
  });
});
