import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantMediaJobCompletionDeliveryService } from "../src/modules/workspace-management/application/workspace-media-job-completion-delivery.service";

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
  }
} as never;

describe("AssistantMediaJobCompletionDeliveryService", () => {
  test("delivers completion_pending web jobs and marks them delivered", async () => {
    const txUpdates: Array<Record<string, unknown>> = [];
    const finalUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    let framingCalls = 0;
    let handleCompletionCalls = 0;
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw a sunset",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "draw a sunset",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: {
              update: async (input: Record<string, unknown>) => {
                txUpdates.push(input);
              }
            }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "Your image is ready.",
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-1",
              originalFilename: "image.png"
            }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          framingCalls += 1;
          return { text: "Fresh current-context framing.", usage: null };
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
    assert.equal(txUpdates.length, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    assert.equal(finalUpdates.at(-1)?.data?.completionAssistantMessageId, undefined);
    assert.deepEqual(messageUpdates, []);
    assert.equal(framingCalls, 0);
    assert.equal(handleCompletionCalls, 1);
  });

  test("delivers completion_pending telegram jobs asynchronously and marks them delivered", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const sendReplyCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-2",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-telegram-1",
                surface: "telegram",
                kind: "image",
                sourceUserMessageId: "user-message-2",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw the skyline",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "draw the skyline",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-2", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: {
              update: async () => undefined
            }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-2",
          chatId: "chat-telegram-1",
          assistantId: "assistant-1",
          content: "Your image is ready.",
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        }),
        findChatById: async () => ({
          id: "chat-telegram-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "telegram",
          surfaceThreadKey: "telegram:telegram-chat-42:session:session-2",
          title: null,
          deepModeEnabled: false,
          skillDecisionState: null,
          archivedAt: null,
          lastMessageAt: null,
          createdAt: new Date("2026-05-05T09:00:00.000Z"),
          updatedAt: new Date("2026-05-05T09:00:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-2",
              originalFilename: "image.png"
            }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort(input: Record<string, unknown>) {
          sendReplyCalls.push(input);
          return { status: "delivered" };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            locale: "en",
            botToken: "bot-token",
            botUserId: 1,
            botUsername: "persai_bot",
            inbound: true,
            outbound: true,
            groupReplyMode: "mention_reply",
            parseMode: "plain_text",
            defaultDeepModeEnabled: false,
            accessMode: "owner_only",
            ownerClaimStatus: "claimed",
            ownerClaimCode: null,
            ownerClaimCodeExpiresAt: null,
            ownerTelegramUserId: 42,
            ownerTelegramUsername: "alex",
            ownerTelegramChatId: "telegram-chat-42",
            runtimeHealth: "ok",
            webhookSecret: "secret"
          };
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Fresh Telegram framing.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    assert.equal(sendReplyCalls.length, 1);
    assert.equal(sendReplyCalls[0]?.assistantMessageId, "assistant-message-2");
    assert.equal(sendReplyCalls[0]?.mediaAlreadyDelivered, true);
    // ADR-157: image success skips ghostwriter maybeFrame; stored resultText is kept.
    assert.equal(sendReplyCalls[0]?.text, "Your image is ready.");
  });

  test("does not refresh image completion with ghostwriter framing when an acknowledgement already exists", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    let maybeFrameCalls = 0;
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-retry-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-retry-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw mountains",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z"
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-retry-1", kind: "image" }],
                completionAssistantMessageId: "assistant-message-existing-1",
                attemptCount: 2,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: {
              update: async () => undefined
            }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          throw new Error("createMessage should not run when completion message already exists");
        },
        findMessageByIdForAssistant: async () => ({
          id: "assistant-message-existing-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content:
            "Request accepted. I am generating the image and will send it separately when it is ready.",
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            {
              id: "attachment-retry-1",
              originalFilename: "image.png"
            }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          maybeFrameCalls += 1;
          return { text: "Fresh current-context framing.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(maybeFrameCalls, 0, "ADR-157: image success must not call maybeFrame");
    assert.deepEqual(messageUpdates, [
      {
        messageId: "assistant-message-existing-1",
        assistantId: "assistant-1",
        content: "Your image is ready."
      }
    ]);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
  });

  test("replaces the optimistic completion text with a user-visible failure message when web delivery fails", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-3",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-3",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "make explicit image",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "make explicit image",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-3", kind: "image" }],
                completionAssistantMessageId: "assistant-message-3",
                attemptCount: 5,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: {
              update: async () => undefined
            }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          throw new Error("createMessage should not run when completion message already exists");
        },
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => {
          throw new Error("Blocked by provider safety policy.");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Fresh current-context framing.", usage: null };
        },
        async maybeFrameFailure() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.equal(finalUpdates.at(-1)?.data?.completionAssistantMessageId, "assistant-message-3");
    assert.match(String(messageUpdates.at(-1)?.content), /couldn't finish the image request/i);
  });

  test("uses LLM-authored failure copy when delivery fails and the framing call succeeds", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    const failureFrameCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-llm-fail-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-llm-fail-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "make a sunset",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "make a sunset",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-llm-1", kind: "image" }],
                completionAssistantMessageId: "assistant-message-llm-1",
                attemptCount: 5,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          throw new Error("createMessage should not run when completion message already exists");
        },
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => {
          throw new Error("Network blip while delivering.");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Fresh current-context framing.", usage: null };
        },
        async maybeFrameFailure(input: Record<string, unknown>) {
          failureFrameCalls.push(input);
          return "LLM-authored: this run hit a temporary problem; please try again.";
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.equal(failureFrameCalls.length, 1);
    assert.equal(
      (failureFrameCalls[0]?.failure as Record<string, unknown> | undefined)?.stage,
      "delivery"
    );
    assert.equal(failureFrameCalls[0]?.sourceUserMessageText, "make a sunset");
    assert.equal(
      String(messageUpdates.at(-1)?.content),
      "LLM-authored: this run hit a temporary problem; please try again."
    );
  });

  test("falls back to hardcoded failure copy when LLM framing returns null", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-llm-fallback-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-fallback-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw something explicit",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "draw something explicit",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-fb-1", kind: "image" }],
                completionAssistantMessageId: "assistant-message-fb-1",
                attemptCount: 5,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          throw new Error("createMessage should not run when completion message already exists");
        },
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => {
          throw new Error("Blocked by provider safety policy.");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Fresh current-context framing.", usage: null };
        },
        async maybeFrameFailure() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.match(String(messageUpdates.at(-1)?.content), /couldn't finish the image request/i);
  });

  test("reconciles the full reserved count once on a pre-delivery completion_request_missing failure", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const reconcileCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-reconcile-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-reconcile-1",
                // Missing sourceUserMessageText/CreatedAt -> parseRequestPayload
                // returns null -> completion_request_missing (before the
                // delivery loop). directToolExecution still carries the reserved
                // count so we can reconcile exactly N.
                requestJson: {
                  attachments: [],
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "draw two sunsets",
                      count: 2,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-reconcile-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-reconcile-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "failed",
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => {
          throw new Error("delivery loop must not run for completion_request_missing");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Fresh current-context framing.", usage: null };
        },
        async maybeFrameFailure() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async markAssistantMonthlyMediaQuotaReconciliationRequired(input: Record<string, unknown>) {
          reconcileCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.equal(finalUpdates.at(-1)?.data?.lastErrorCode, "completion_request_missing");
    // ADR-105 §5: pre-delivery-loop terminal failure reconciles the full
    // reserved N (= count = 2) exactly once (provider cost incurred, nothing
    // delivered).
    assert.equal(reconcileCalls.length, 1);
    assert.deepEqual(reconcileCalls[0], {
      assistant: { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" },
      toolCode: "image_generate",
      units: 2
    });
  });

  test("releases remainder units when provider produces M < N artifacts (partial under-delivery)", async () => {
    // Reserved N=4 (image_edit, count=4), worker produced M=1 artifact.
    // Delivery loop resolves 1 unit (the produced artifact).
    // Remainder N−M = 3 must be released exactly once.
    const finalUpdates: Array<Record<string, unknown>> = [];
    const releaseCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-partial-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-partial-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "edit this image 4 ways",
                  sourceUserMessageCreatedAt: "2026-05-31T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_edit",
                    request: {
                      toolCode: "image_edit",
                      prompt: "edit this image 4 ways",
                      count: 4,
                      size: "1024x1024",
                      background: "opaque"
                    }
                  }
                },
                resultText: "Here is your edited image.",
                artifactsJson: [{ artifactId: "artifact-partial-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-partial-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "Here is your edited image.",
          createdAt: new Date("2026-05-31T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => ({
          attachments: [{ id: "att-partial-1", originalFilename: "edited.png" }]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Here is your edited image.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async releaseAssistantMonthlyMediaQuota(input: Record<string, unknown>) {
          releaseCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    // ADR-105 §5: delivery loop resolved 1 produced artifact; remainder N−M = 4−1 = 3
    // must be released exactly once.
    assert.equal(releaseCalls.length, 1);
    assert.deepEqual(releaseCalls[0], {
      assistant: { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" },
      toolCode: "image_edit",
      units: 3
    });
  });

  test("does not release remainder when provider produces all N artifacts (full delivery)", async () => {
    // Reserved N=2, worker produced M=2 — full delivery, remainder = 0, no release.
    const finalUpdates: Array<Record<string, unknown>> = [];
    const releaseCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-full-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-full-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "generate 2 edits",
                  sourceUserMessageCreatedAt: "2026-05-31T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_edit",
                    request: {
                      toolCode: "image_edit",
                      prompt: "generate 2 edits",
                      count: 2,
                      size: "1024x1024",
                      background: "opaque"
                    }
                  }
                },
                resultText: "Here are your 2 edited images.",
                artifactsJson: [
                  { artifactId: "artifact-full-1", kind: "image" },
                  { artifactId: "artifact-full-2", kind: "image" }
                ],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-full-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "Here are your 2 edited images.",
          createdAt: new Date("2026-05-31T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => ({
          attachments: [
            { id: "att-full-1", originalFilename: "edit1.png" },
            { id: "att-full-2", originalFilename: "edit2.png" }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Here are your 2 edited images.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async releaseAssistantMonthlyMediaQuota(input: Record<string, unknown>) {
          releaseCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    // Full delivery: N=2, M=2 → remainder=0 → release must NOT be called.
    assert.equal(releaseCalls.length, 0);
  });

  test("pre-delivery failDelivery does not also trigger remainder-release (no double-count)", async () => {
    // Reserved N=3, worker produced 1 artifact, but requestJson is missing →
    // pre-delivery failDelivery calls reconcile exactly once; remainder-release must NOT run.
    const reconcileCalls: Array<Record<string, unknown>> = [];
    const releaseCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-fail-no-release-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-fail-1",
                requestJson: null,
                resultText: null,
                artifactsJson: [{ artifactId: "artifact-fail-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-fail-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "failed",
          createdAt: new Date("2026-05-31T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => {
          throw new Error("deliver should not be called for pre-delivery failure");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run");
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
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async markAssistantMonthlyMediaQuotaReconciliationRequired(input: Record<string, unknown>) {
          reconcileCalls.push(input);
        },
        async releaseAssistantMonthlyMediaQuota(input: Record<string, unknown>) {
          releaseCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    // Pre-delivery failDelivery: requestJson is null → reconcile skipped (can't resolve toolCode),
    // and remainder-release must also NOT run (delivery loop never ran).
    assert.equal(reconcileCalls.length, 0);
    assert.equal(releaseCalls.length, 0);
  });

  test("appends EN shortfall line when provider produces M < N (partial under-delivery, web)", async () => {
    // N=4 requested, M=3 produced, M=3 delivered — honest shortfall line must appear in EN.
    const messageUpdates: Array<Record<string, unknown>> = [];
    const releaseCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-shortfall-en-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-shortfall-en-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "generate 4 images",
                  sourceUserMessageCreatedAt: "2026-05-31T10:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "generate 4 images",
                      count: 4,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Here are your images.",
                artifactsJson: [
                  { artifactId: "artifact-shen-1", kind: "image" },
                  { artifactId: "artifact-shen-2", kind: "image" },
                  { artifactId: "artifact-shen-3", kind: "image" }
                ],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-shen-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "Here are your images.",
          createdAt: new Date("2026-05-31T10:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            { id: "att-shen-1", originalFilename: "img1.png" },
            { id: "att-shen-2", originalFilename: "img2.png" },
            { id: "att-shen-3", originalFilename: "img3.png" }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Here are your images.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async releaseAssistantMonthlyMediaQuota(input: Record<string, unknown>) {
          releaseCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    // Remainder N−M = 4−3 = 1 released
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0]?.units, 1);
    // Shortfall line appended in EN (source text is English)
    const finalContent = String(messageUpdates.at(-1)?.content ?? "");
    assert.match(
      finalContent,
      /Requested 4, delivered 3 — the rest could not be generated\./,
      "EN shortfall line must be appended for partial under-delivery (N=4, M=3)"
    );
  });

  test("appends RU shortfall line when provider produces M < N (partial under-delivery, telegram ru)", async () => {
    // N=4 requested, M=3 produced — telegram surface with locale="ru".
    const messageUpdates: Array<Record<string, unknown>> = [];
    const releaseCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-shortfall-ru-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-tg-ru-1",
                surface: "telegram",
                kind: "image",
                sourceUserMessageId: "user-message-shortfall-ru-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "сгенерируй 4 изображения",
                  sourceUserMessageCreatedAt: "2026-05-31T10:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "сгенерируй 4 изображения",
                      count: 4,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Вот ваши изображения.",
                artifactsJson: [
                  { artifactId: "artifact-shru-1", kind: "image" },
                  { artifactId: "artifact-shru-2", kind: "image" },
                  { artifactId: "artifact-shru-3", kind: "image" }
                ],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-shru-1",
          chatId: "chat-tg-ru-1",
          assistantId: "assistant-1",
          content: "Вот ваши изображения.",
          createdAt: new Date("2026-05-31T10:10:00.000Z")
        }),
        findChatById: async () => ({
          id: "chat-tg-ru-1",
          assistantId: "assistant-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          surface: "telegram",
          surfaceThreadKey: "telegram:tg-ru-chat-1:session:session-ru",
          title: null,
          deepModeEnabled: false,
          skillDecisionState: null,
          archivedAt: null,
          lastMessageAt: null,
          createdAt: new Date("2026-05-31T10:00:00.000Z"),
          updatedAt: new Date("2026-05-31T10:00:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            { id: "att-shru-1", originalFilename: "img1.png" },
            { id: "att-shru-2", originalFilename: "img2.png" },
            { id: "att-shru-3", originalFilename: "img3.png" }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          return { status: "delivered" };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            locale: "ru",
            botToken: "bot-token-ru",
            botUserId: 2,
            botUsername: "persai_bot_ru",
            inbound: true,
            outbound: true,
            groupReplyMode: "mention_reply",
            parseMode: "plain_text",
            defaultDeepModeEnabled: false,
            accessMode: "owner_only",
            ownerClaimStatus: "claimed",
            ownerClaimCode: null,
            ownerClaimCodeExpiresAt: null,
            ownerTelegramUserId: 43,
            ownerTelegramUsername: "alex_ru",
            ownerTelegramChatId: "tg-ru-chat-1",
            runtimeHealth: "ok",
            webhookSecret: "secret-ru"
          };
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Вот ваши изображения.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async releaseAssistantMonthlyMediaQuota(input: Record<string, unknown>) {
          releaseCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    // Remainder N−M = 4−3 = 1 released
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0]?.units, 1);
    // Shortfall line appended in RU (locale="ru" from telegram config)
    const finalContent = String(messageUpdates.at(-1)?.content ?? "");
    assert.match(
      finalContent,
      /Запросили 4, готово 3 — остальные не удалось создать\./,
      "RU shortfall line must be appended for partial under-delivery (N=4, M=3, locale=ru)"
    );
  });

  test("does not append shortfall line when M === N (full delivery)", async () => {
    // N=2, M=2 — full delivery, no shortfall line.
    const messageUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-noshortfall-full-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-noshortfall-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "generate 2 images",
                  sourceUserMessageCreatedAt: "2026-05-31T10:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "generate 2 images",
                      count: 2,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Here are 2 images.",
                artifactsJson: [
                  { artifactId: "artifact-nf-1", kind: "image" },
                  { artifactId: "artifact-nf-2", kind: "image" }
                ],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-nf-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "Here are 2 images.",
          createdAt: new Date("2026-05-31T10:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => ({
          attachments: [
            { id: "att-nf-1", originalFilename: "img1.png" },
            { id: "att-nf-2", originalFilename: "img2.png" }
          ]
        })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Here are 2 images.", usage: null };
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    // Full delivery: M=N=2, no shortfall line in any message update
    for (const update of messageUpdates) {
      assert.doesNotMatch(
        String(update.content ?? ""),
        /Requested|Запросили/,
        "No shortfall line must appear when M === N"
      );
    }
  });

  test("does not append shortfall line on pre-delivery failure (M=0 path)", async () => {
    // requestJson invalid → pre-delivery failure → no shortfall line.
    const messageUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-noshortfall-pre-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-pre-1",
                requestJson: null,
                resultText: null,
                artifactsJson: [{ artifactId: "artifact-pre-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-pre-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "failed",
          createdAt: new Date("2026-05-31T10:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => {
          throw new Error("delivery must not run for pre-delivery failure");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run");
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
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    for (const update of messageUpdates) {
      assert.doesNotMatch(
        String(update.content ?? ""),
        /Requested|Запросили/,
        "No shortfall line must appear for pre-delivery failures (M=0 path)"
      );
    }
  });

  test("does not reconcile again when the delivery loop already resolved the reservation", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const reconcileCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-loop-resolved-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-1",
                surface: "web",
                kind: "image",
                sourceUserMessageId: "user-message-loop-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "draw a sunset",
                  sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z",
                  directToolExecution: {
                    toolCode: "image_generate",
                    request: {
                      toolCode: "image_generate",
                      prompt: "draw a sunset",
                      count: 1,
                      filename: null,
                      size: "1024x1024",
                      background: "auto"
                    }
                  }
                },
                resultText: "Your image is ready.",
                artifactsJson: [{ artifactId: "artifact-loop-1", kind: "image" }],
                completionAssistantMessageId: null,
                attemptCount: 5,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-loop-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          content: "Your image is ready.",
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        // deliver() RETURNS (loop ran and resolved all N per-artifact). Zero
        // delivered attachments -> finalizeJob marks the job failed, but the
        // reservation was already resolved by the loop, so the completion
        // service must NOT reconcile again.
        deliver: async () => ({ attachments: [] })
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort() {
          throw new Error("telegram reply should not run for web jobs");
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for web jobs");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: "Fresh current-context framing.", usage: null };
        },
        async maybeFrameFailure() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      {
        async findById() {
          return { id: "assistant-1", userId: "user-1", workspaceId: "workspace-1" };
        }
      } as never,
      {
        async markAssistantMonthlyMediaQuotaReconciliationRequired(input: Record<string, unknown>) {
          reconcileCalls.push(input);
        }
      } as never
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    // ADR-105 §5: the delivery loop already resolved all N units per-artifact;
    // the completion service must NOT double-count by reconciling again.
    assert.equal(reconcileCalls.length, 0);
  });

  test("pushes telegram failure notice when pre-delivery failDelivery runs on telegram surface", async () => {
    const outboundCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-tg-predelivery-fail-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-tg-predelivery-fail-1",
                surface: "telegram",
                kind: "video",
                sourceUserMessageId: "user-message-tg-predelivery-fail-1",
                requestJson: null,
                resultText: null,
                artifactsJson: [{ artifactId: "artifact-tg-fail-1", kind: "video" }],
                completionAssistantMessageId: null,
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        createMessage: async () => ({
          id: "assistant-message-tg-predelivery-fail-1",
          chatId: "chat-tg-predelivery-fail-1",
          assistantId: "assistant-1",
          content: "failed",
          createdAt: new Date("2026-06-13T09:10:00.000Z")
        }),
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async () => null
      } as never,
      {
        deliver: async () => {
          throw new Error("deliver should not be called for pre-delivery failure");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort(input: Record<string, unknown>) {
          outboundCalls.push(input);
          return { status: "delivered" };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for outbound mock");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: null, usage: null };
        },
        async maybeFrameFailure() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0]?.assistantMessageId, "assistant-message-tg-predelivery-fail-1");
    assert.equal(outboundCalls[0]?.chatId, "chat-tg-predelivery-fail-1");
    assert.match(String(outboundCalls[0]?.text), /видео|video|couldn't|не удалось/i);
  });

  test("delivers scheduler-authored telegram safety rejection before closing the job", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
    const outboundCalls: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantMediaJobCompletionDeliveryService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [
              {
                id: "job-tg-safety-1",
                assistantId: "assistant-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                chatId: "chat-tg-safety-1",
                surface: "telegram",
                kind: "image",
                sourceUserMessageId: "user-message-tg-safety-1",
                requestJson: {
                  attachments: [],
                  sourceUserMessageText: "сделай голову в форме яйца",
                  sourceUserMessageCreatedAt: "2026-06-26T18:40:00.000Z"
                },
                resultText:
                  "Провайдер отклонил запрос по safety policy. Попробуйте переформулировать.",
                artifactsJson: [],
                completionAssistantMessageId: "assistant-message-tg-safety-1",
                lastErrorCode: "image_provider_safety_rejected",
                lastErrorMessage:
                  "The provider rejected the original image prompt under its safety system.",
                attemptCount: 1,
                maxAttempts: 5
              }
            ],
            assistantMediaJob: { update: async () => undefined }
          }),
        assistantMediaJob: {
          findFirst: async () => null,
          updateMany: async (input: Record<string, unknown>) => {
            finalUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        createMessage: async () => {
          throw new Error("createMessage should not run when completion message already exists");
        },
        findMessageByIdForAssistant: async () => ({
          id: "msg",
          content: "",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          createdAt: new Date()
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => {
          messageUpdates.push({ messageId, assistantId, content });
          return null;
        }
      } as never,
      {
        deliver: async () => {
          throw new Error("media delivery should not run for terminal safety failure");
        }
      } as never,
      {
        async deliverPersistedAssistantMessageBestEffort(input: Record<string, unknown>) {
          outboundCalls.push(input);
          return { status: "delivered" };
        }
      } as never,
      {
        async resolveByAssistantId() {
          throw new Error("telegram config should not resolve for terminal failure notice");
        }
      } as never,
      {
        async maybeFrame() {
          return { text: null, usage: null };
        },
        async maybeFrameFailure() {
          return null;
        }
      } as never,
      noopRecordModelCostLedgerService,
      noopAssistantRepository,
      noopTrackWorkspaceQuotaUsageService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(outboundCalls.length, 1);
    assert.equal(outboundCalls[0]?.assistantMessageId, "assistant-message-tg-safety-1");
    assert.equal(outboundCalls[0]?.chatId, "chat-tg-safety-1");
    assert.match(String(outboundCalls[0]?.text), /safety|безопас/i);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.equal(finalUpdates.at(-1)?.data?.lastErrorCode, "image_provider_safety_rejected");
    assert.ok(finalUpdates.at(-1)?.data?.deliveredAt instanceof Date);
    assert.equal(messageUpdates.length, 1);
  });
});
