import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SendWebChatTurnService } from "../src/modules/workspace-management/application/send-web-chat-turn.service";

function createOverviewLatencyTraceServiceMock() {
  return {
    start() {
      return {
        stage() {
          return undefined;
        },
        isEnabled() {
          return false;
        },
        getTraceId() {
          return "trace-test";
        },
        attachExternalTrace() {
          return undefined;
        },
        finish() {
          return undefined;
        }
      };
    }
  };
}

describe("SendWebChatTurnService", () => {
  test("replays duplicate clientTurnId without starting a second sync runtime turn", async () => {
    let nativeRuntimeCalls = 0;
    const completedState = {
      clientTurnId: "turn-1",
      chatId: "chat-1",
      userMessageId: "user-msg-1",
      assistantMessageId: "assistant-msg-1",
      respondedAt: "2026-04-05T12:00:01.000Z",
      degradedByQuotaFallback: false,
      quotaFallbackReason: null,
      quotaFallbackModel: null,
      turnRouting: {
        mode: "shadow",
        executionMode: "reasoning",
        source: "precheck"
      },
      completedAt: "2026-04-05T12:00:02.000Z"
    };

    const service = new SendWebChatTurnService(
      {
        findChatById: async () => ({
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:02.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:02.000Z")
        }),
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: messageId === "user-msg-1" ? "user" : "assistant",
          content: messageId === "user-msg-1" ? "hello" : "hi back",
          createdAt: new Date("2026-04-05T12:00:00.000Z")
        })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        claimWebTurnProcessing: async () => "duplicate_handled",
        getCompletedWebTurnProcessing: async () => completedState
      } as never,
      {
        execute: async () => {
          nativeRuntimeCalls += 1;
          return {
            assistantMessage: "native",
            respondedAt: "2026-04-05T12:00:01.000Z",
            media: []
          };
        }
      } as never,
      {
        execute: async () => {
          throw new Error("prepare should not be called for replay");
        }
      } as never,
      {
        resolveByUserId: async () => ({
          assistantId: "assistant-1"
        })
      } as never,
      {} as never,
      {} as never,
      {} as never,
      createOverviewLatencyTraceServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello",
      clientTurnId: "turn-1"
    });

    assert.equal(nativeRuntimeCalls, 0);
    assert.equal(result.userMessage.id, "user-msg-1");
    assert.equal(result.assistantMessage.id, "assistant-msg-1");
    assert.equal(result.assistantMessage.content, "hi back");
    assert.deepEqual(result.runtime.turnRouting, {
      mode: "shadow",
      executionMode: "reasoning",
      source: "precheck"
    });
  });

  test("routes sync web turns through the native runtime service", async () => {
    let nativeRuntimeCalls = 0;
    let capturedNativeUserMessage = "";

    const service = new SendWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => ({
          id: "assistant-msg-1",
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: input.author,
          content: input.content,
          createdAt: new Date("2026-04-05T12:00:02.000Z")
        })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        completeWebTurnProcessing: async () => undefined,
        releaseWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async (input: { userMessage: string }) => {
          nativeRuntimeCalls += 1;
          capturedNativeUserMessage = input.userMessage;
          return {
            assistantMessage: "native",
            respondedAt: "2026-04-05T12:00:01.000Z",
            media: [],
            turnRouting: {
              mode: "shadow",
              executionMode: "premium",
              source: "llm"
            }
          };
        }
      } as never,
      {
        execute: async () => ({
          chat: {
            id: "chat-1",
            assistantId: "assistant-1",
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: "Chat",
            archivedAt: null,
            lastMessageAt: null,
            createdAt: "2026-04-05T12:00:00.000Z",
            updatedAt: "2026-04-05T12:00:00.000Z"
          },
          userMessage: {
            id: "user-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "hello",
            attachments: [],
            createdAt: "2026-04-05T12:00:00.000Z"
          },
          assistant: {
            id: "assistant-1",
            workspaceId: "workspace-1"
          },
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          quotaDegradeModelOverride: null,
          quotaDegradeReason: null,
          userId: "user-1",
          workspaceId: "workspace-1",
          workspaceTimezone: "UTC"
        })
      } as never,
      {
        resolveByUserId: async () => ({
          assistantId: "assistant-1"
        })
      } as never,
      {
        execute: async () => undefined
      } as never,
      {
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello"
    });

    assert.equal(nativeRuntimeCalls, 1);
    assert.equal(capturedNativeUserMessage, "hello");
    assert.equal(result.assistantMessage.content, "native");
    assert.deepEqual(result.runtime.turnRouting, {
      mode: "shadow",
      executionMode: "premium",
      source: "llm"
    });
  });

  test("uses the admin-managed onboarding prompt for welcome sync turns", async () => {
    let capturedNativeUserMessage = "";
    const memoryWrites: Array<Record<string, unknown>> = [];
    const quotaWrites: Array<Record<string, unknown>> = [];

    const service = new SendWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => ({
          id: "assistant-msg-1",
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: input.author,
          content: input.content,
          createdAt: new Date("2026-04-05T12:00:02.000Z")
        })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        completeWebTurnProcessing: async () => undefined,
        releaseWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async (input: { userMessage: string }) => {
          capturedNativeUserMessage = input.userMessage;
          return {
            assistantMessage: "native",
            respondedAt: "2026-04-05T12:00:01.000Z",
            media: []
          };
        }
      } as never,
      {
        execute: async () => ({
          chat: {
            id: "chat-1",
            assistantId: "assistant-1",
            surface: "web",
            surfaceThreadKey: "welcome",
            title: "Welcome",
            archivedAt: null,
            lastMessageAt: null,
            createdAt: "2026-04-05T12:00:00.000Z",
            updatedAt: "2026-04-05T12:00:00.000Z"
          },
          userMessage: {
            id: "user-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "__welcome_init__",
            attachments: [],
            createdAt: "2026-04-05T12:00:00.000Z"
          },
          assistant: {
            id: "assistant-1",
            workspaceId: "workspace-1"
          },
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          quotaDegradeModelOverride: null,
          quotaDegradeReason: null,
          welcomeFirstTurnPrompt: "You just came online. Introduce yourself warmly to Alex.",
          userId: "user-1",
          workspaceId: "workspace-1",
          workspaceTimezone: "UTC"
        })
      } as never,
      {
        resolveByUserId: async () => ({
          assistantId: "assistant-1"
        })
      } as never,
      {
        execute: async (input: Record<string, unknown>) => {
          memoryWrites.push(input);
        }
      } as never,
      {
        recordWebChatTurnUsage: async (input: Record<string, unknown>) => {
          quotaWrites.push(input);
        }
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never
    );

    await service.execute("user-1", {
      surfaceThreadKey: "welcome",
      message: "__welcome_init__",
      welcomeTurn: true,
      welcomeLocale: "ru"
    });

    assert.equal(
      capturedNativeUserMessage,
      "You just came online. Introduce yourself warmly to Alex."
    );
    assert.equal(
      memoryWrites[0]?.userContent,
      "You just came online. Introduce yourself warmly to Alex."
    );
    assert.equal(
      quotaWrites[0]?.userContent,
      "You just came online. Introduce yourself warmly to Alex."
    );
  });
});
