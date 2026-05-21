import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantMediaJobCompletionDeliveryService } from "../src/modules/workspace-management/application/assistant-media-job-completion-delivery.service";

const noopRecordModelCostLedgerService = {
  async recordCompletionFramingUsageEvent() {
    return 0;
  }
} as never;

describe("AssistantMediaJobCompletionDeliveryService", () => {
  test("delivers completion_pending web jobs and marks them delivered", async () => {
    const txUpdates: Array<Record<string, unknown>> = [];
    const finalUpdates: Array<Record<string, unknown>> = [];
    const messageUpdates: Array<Record<string, unknown>> = [];
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
        async sendAssistantTurnReply() {
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
        }
      } as never,
      noopRecordModelCostLedgerService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(txUpdates.length, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    assert.equal(finalUpdates.at(-1)?.data?.completionAssistantMessageId, undefined);
    assert.deepEqual(messageUpdates, []);
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
          skillCadenceState: null,
          archivedAt: null,
          lastMessageAt: null,
          createdAt: new Date("2026-05-05T09:00:00.000Z"),
          updatedAt: new Date("2026-05-05T09:00:00.000Z")
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
        async sendAssistantTurnReply(input: Record<string, unknown>) {
          sendReplyCalls.push(input);
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
      noopRecordModelCostLedgerService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "delivered");
    assert.equal(sendReplyCalls.length, 1);
    assert.equal(sendReplyCalls[0]?.chatId, "telegram-chat-42");
    assert.equal(sendReplyCalls[0]?.mediaAlreadyDelivered, true);
    assert.equal(sendReplyCalls[0]?.turnResult?.assistantMessage, "Fresh Telegram framing.");
  });

  test("reuses the existing completion message on retry instead of reframing again", async () => {
    const finalUpdates: Array<Record<string, unknown>> = [];
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
          content: "Existing framed completion text.",
          createdAt: new Date("2026-05-05T09:10:00.000Z")
        }),
        updateMessageContent: async () => null
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
        async sendAssistantTurnReply() {
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
      noopRecordModelCostLedgerService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(maybeFrameCalls, 0);
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
        async sendAssistantTurnReply() {
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
      noopRecordModelCostLedgerService
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
        async sendAssistantTurnReply() {
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
      noopRecordModelCostLedgerService
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
        async sendAssistantTurnReply() {
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
      noopRecordModelCostLedgerService
    );

    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(finalUpdates.at(-1)?.data?.status, "failed");
    assert.match(String(messageUpdates.at(-1)?.content), /couldn't finish the image request/i);
  });
});
