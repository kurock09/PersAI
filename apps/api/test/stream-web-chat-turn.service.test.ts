import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StreamWebChatTurnService } from "../src/modules/workspace-management/application/stream-web-chat-turn.service";
import { PrismaAssistantChatRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository";

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

describe("StreamWebChatTurnService", () => {
  test("findOrCreateChatBySurfaceThread falls back to existing chat on unique race", async () => {
    const existingChat = {
      id: "chat-1",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surface: "web" as const,
      surfaceThreadKey: "thread-1",
      title: "Chat",
      archivedAt: null,
      lastMessageAt: null,
      createdAt: new Date("2026-04-05T12:00:00.000Z"),
      updatedAt: new Date("2026-04-05T12:00:00.000Z")
    };
    const createError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      clientVersion: "test"
    });
    const repository = new PrismaAssistantChatRepository({
      assistantChat: {
        create: async () => {
          throw createError;
        },
        findUnique: async () => ({
          ...existingChat
        })
      }
    } as never);

    const chat = await repository.findOrCreateChatBySurfaceThread({
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surface: "web",
      surfaceThreadKey: "thread-1",
      title: "Chat"
    });

    assert.equal(chat.id, "chat-1");
    assert.equal(chat.surfaceThreadKey, "thread-1");
  });

  test("completes media-only runtime turns without leaking placeholder text", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    const memoryWrites: Array<Record<string, unknown>> = [];
    const quotaWrites: Array<Record<string, unknown>> = [];

    const service = new StreamWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => {
          createdMessages.push(input);
          return {
            id: "assistant-msg-1",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            createdAt: new Date("2026-04-05T12:00:00.000Z")
          };
        },
        findChatById: async (chatId: string) => ({
          id: chatId,
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:00.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:00.000Z")
        })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        releaseWebTurnProcessing: async () => undefined,
        completeWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async function* () {
          yield {
            type: "media",
            media: [
              {
                source: "runtime_url",
                url: "/tmp/reply.ogg",
                type: "audio",
                audioAsVoice: true
              }
            ]
          };
          yield { type: "done", respondedAt: "2026-04-05T12:00:01.000Z" };
        }
      } as never,
      {
        execute: async () => {
          throw new Error("prepare should not be called in this test");
        }
      } as never,
      {
        resolveByUserId: async () => {
          throw new Error("resolve should not be called in this test");
        }
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
        deliver: async () => ({
          attachments: [
            {
              id: "att-1",
              attachmentType: "audio",
              originalFilename: "reply.ogg",
              mimeType: "audio/ogg",
              sizeBytes: 1234,
              processingStatus: "ready",
              createdAt: "2026-04-05T12:00:00.000Z"
            }
          ]
        })
      } as never,
      createOverviewLatencyTraceServiceMock() as never
    );

    const outcome = await service.streamToCompletion(
      {
        chat: {
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web_chat",
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
        publishedVersionId: "pub-1",
        runtimeTier: "paid_shared",
        quotaDegradeModelOverride: null,
        quotaDegradeReason: null,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceTimezone: "UTC"
      } as never,
      {
        isClientAborted: () => false,
        onDelta: () => undefined,
        onThinking: () => undefined,
        onDone: () => undefined
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(createdMessages.length, 1);
    assert.equal(createdMessages[0]?.content, "");
    assert.equal(memoryWrites.length, 1);
    assert.equal(memoryWrites[0]?.assistantContent, "");
    assert.equal(quotaWrites.length, 1);
    assert.equal(quotaWrites[0]?.assistantContent, "");
    const transport = (
      outcome as { transport: { assistantMessage: { content: string; attachments: unknown[] } } }
    ).transport.assistantMessage;
    assert.equal(transport.content, "");
    assert.ok(Array.isArray(transport.attachments));
    assert.equal((transport.attachments[0] as Record<string, unknown>)?.id, "att-1");
    assert.equal((transport.attachments[0] as Record<string, unknown>)?.attachmentType, "audio");
    assert.equal(
      (transport.attachments[0] as Record<string, unknown>)?.originalFilename,
      "reply.ogg"
    );
  });

  test("routes stream web turns through the native runtime service", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    const toolEvents: Array<Record<string, unknown>> = [];
    const callbackOrder: string[] = [];
    let nativeRuntimeCalls = 0;
    let capturedNativeUserMessage = "";

    const service = new StreamWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => {
          createdMessages.push(input);
          return {
            id: "assistant-msg-1",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
            createdAt: new Date("2026-04-05T12:00:00.000Z")
          };
        },
        findChatById: async (chatId: string) => ({
          id: chatId,
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:00.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:00.000Z")
        })
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        releaseWebTurnProcessing: async () => undefined,
        completeWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async function* (input: { userMessage: string }) {
          nativeRuntimeCalls += 1;
          capturedNativeUserMessage = input.userMessage;
          yield { type: "delta", delta: "native", accumulated: "native" };
          yield {
            type: "tool",
            toolPhase: "start",
            toolName: "summarize_context",
            toolCallId: "tool-1"
          };
          yield {
            type: "tool",
            toolPhase: "end",
            toolName: "summarize_context",
            toolCallId: "tool-1",
            isError: false
          };
          yield { type: "done", respondedAt: "2026-04-05T12:00:01.000Z" };
        }
      } as never,
      {
        execute: async () => {
          throw new Error("prepare should not be called in this test");
        }
      } as never,
      {
        resolveByUserId: async () => {
          throw new Error("resolve should not be called in this test");
        }
      } as never,
      {
        execute: async () => undefined
      } as never,
      {
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        deliver: async () => ({
          attachments: []
        })
      } as never,
      createOverviewLatencyTraceServiceMock() as never
    );

    const outcome = await service.streamToCompletion(
      {
        chat: {
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web_chat",
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
        publishedVersionId: "pub-1",
        runtimeTier: "paid_shared",
        quotaDegradeModelOverride: null,
        quotaDegradeReason: null,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceTimezone: "UTC"
      } as never,
      {
        isClientAborted: () => false,
        onDelta: (delta: string) => {
          callbackOrder.push(`delta:${delta}`);
        },
        onThinking: () => undefined,
        onTool: (payload: Record<string, unknown>) => {
          callbackOrder.push(`tool:${String(payload.phase)}:${String(payload.toolName)}`);
          toolEvents.push(payload);
        },
        onDone: (respondedAt: string) => {
          callbackOrder.push(`done:${respondedAt}`);
        }
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(nativeRuntimeCalls, 1);
    assert.equal(capturedNativeUserMessage, "hello");
    assert.equal(createdMessages.length, 1);
    assert.equal(createdMessages[0]?.content, "native");
    assert.deepEqual(callbackOrder, [
      "delta:native",
      "tool:start:summarize_context",
      "tool:end:summarize_context",
      "done:2026-04-05T12:00:01.000Z"
    ]);
    assert.deepEqual(toolEvents, [
      {
        phase: "start",
        toolName: "summarize_context",
        toolCallId: "tool-1",
        isError: false
      },
      {
        phase: "end",
        toolName: "summarize_context",
        toolCallId: "tool-1",
        isError: false
      }
    ]);
  });

  test("replays duplicate clientTurnId without starting a second runtime stream", async () => {
    const completedState = {
      clientTurnId: "turn-1",
      chatId: "chat-1",
      userMessageId: "user-msg-1",
      assistantMessageId: "assistant-msg-1",
      respondedAt: "2026-04-05T12:00:01.000Z",
      degradedByQuotaFallback: false,
      quotaFallbackReason: null,
      quotaFallbackModel: null,
      completedAt: "2026-04-05T12:00:02.000Z"
    };
    const service = new StreamWebChatTurnService(
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
          throw new Error("native runtime stream should not be used for replay");
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

    const preparation = await service.prepare("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello",
      clientTurnId: "turn-1"
    });

    assert.equal(preparation.mode, "replayed");
    if (preparation.mode === "replayed") {
      assert.equal(preparation.transport.userMessage.id, "user-msg-1");
      assert.equal(preparation.transport.assistantMessage.id, "assistant-msg-1");
      assert.equal(preparation.transport.assistantMessage.content, "hi back");
    }
  });
});
