import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StreamWebChatTurnService } from "../src/modules/workspace-management/application/stream-web-chat-turn.service";
import { PrismaAssistantChatRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository";

function createOverviewLatencyTraceServiceMock(options?: { enabled?: boolean }) {
  const enabled = options?.enabled === true;
  return {
    start() {
      return {
        stage() {
          return undefined;
        },
        isEnabled() {
          return enabled;
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

function createAttachmentObjectAvailabilityServiceMock() {
  return {
    assertRuntimeReadable: async () => undefined
  };
}

function captureProcessStdoutSync<T>(action: () => Promise<T>): Promise<{
  result: T;
  captured: string;
}> {
  const original = process.stdout.write.bind(process.stdout);
  let captured = "";
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return original(chunk as never, ...(rest as never[]));
  }) as typeof process.stdout.write;
  return action()
    .then((result) => {
      process.stdout.write = original;
      return { result, captured };
    })
    .catch((error) => {
      process.stdout.write = original;
      throw error;
    });
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
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            turnRouting: {
              mode: "shadow",
              executionMode: "premium",
              source: "llm"
            }
          };
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
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never
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

  test("corrects streamed assistant text when runtime queued media but final web delivery produced no attachments", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    const updatedContents: string[] = [];
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
        updateMessageContent: async (_messageId: string, _assistantId: string, content: string) => {
          updatedContents.push(content);
          return {
            id: "assistant-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content,
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
            type: "delta",
            delta: "Отправляю hello.txt",
            accumulated: "Отправляю hello.txt"
          };
          yield {
            type: "media",
            media: [
              {
                source: "persai_object_storage",
                objectKey: "assistant-media/sandbox/jobs/job-1/hello.txt",
                type: "document",
                mimeType: "text/plain",
                filename: "hello.txt",
                sizeBytes: 29
              }
            ]
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z"
          };
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
          attachments: []
        })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never
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
          content: "send it",
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
    assert.equal(createdMessages[0]?.content, "Отправляю hello.txt");
    assert.equal(updatedContents.length, 1);
    assert.match(updatedContents[0] ?? "", /Поправка: файл не был реально доставлен в этот чат/);
    const transport = (
      outcome as { transport: { assistantMessage: { content: string; attachments: unknown[] } } }
    ).transport.assistantMessage;
    assert.equal(transport.attachments.length, 0);
    assert.match(transport.content, /Поправка: файл не был реально доставлен в этот чат/);
    assert.match(
      String(memoryWrites[0]?.assistantContent ?? ""),
      /Поправка: файл не был реально доставлен в этот чат/
    );
    assert.match(
      String(quotaWrites[0]?.assistantContent ?? ""),
      /Поправка: файл не был реально доставлен в этот чат/
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
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            turnRouting: {
              mode: "shadow",
              executionMode: "premium",
              source: "llm"
            }
          };
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
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never
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
    assert.deepEqual(
      (outcome as { transport: { runtime: { turnRouting: unknown } } }).transport.runtime
        .turnRouting,
      {
        mode: "shadow",
        executionMode: "premium",
        source: "llm"
      }
    );
  });

  test("uses the admin-managed onboarding prompt for welcome stream turns", async () => {
    let capturedNativeUserMessage = "";
    const memoryWrites: Array<Record<string, unknown>> = [];

    const service = new StreamWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => ({
          id: "assistant-msg-1",
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: input.author,
          content: input.content,
          createdAt: new Date("2026-04-05T12:00:00.000Z")
        }),
        findChatById: async (chatId: string) => ({
          id: chatId,
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "welcome",
          title: "Welcome",
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
          capturedNativeUserMessage = input.userMessage;
          yield { type: "delta", delta: "Hi Alex", accumulated: "Hi Alex" };
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never
    );

    const outcome = await service.streamToCompletion(
      {
        chat: {
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web_chat",
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
        publishedVersionId: "pub-1",
        runtimeTier: "paid_shared",
        quotaDegradeModelOverride: null,
        quotaDegradeReason: null,
        welcomeFirstTurnPrompt: "You just came online. Introduce yourself warmly to Alex.",
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceTimezone: "UTC",
        welcomeTurn: true,
        welcomeLocale: "ru"
      } as never,
      {
        isClientAborted: () => false,
        onDelta: () => undefined,
        onThinking: () => undefined,
        onDone: () => undefined
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(
      capturedNativeUserMessage,
      "You just came online. Introduce yourself warmly to Alex."
    );
    assert.equal(
      memoryWrites[0]?.userContent,
      "You just came online. Introduce yourself warmly to Alex."
    );
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
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never
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

  test("emits extended web_stream_timing fields when admin trace toggle is enabled", async () => {
    const service = buildToolStreamingServiceForTraceTest({ traceEnabled: true });
    const { captured } = await captureProcessStdoutSync(async () => {
      const outcome = await service.streamToCompletion(
        buildToolStreamingPreparedFixture({ traceEnabled: true }) as never,
        {
          isClientAborted: () => false,
          onDelta: () => undefined,
          onThinking: () => undefined,
          onTool: () => undefined,
          onDone: () => undefined,
          getSseWriterStatsSummary: () =>
            "writes=4 backpressureWrites=0 backpressureMaxDrainMs=0 backpressureTotalDrainMs=0"
        }
      );
      assert.equal(outcome.status, "completed");
    });

    const matched = captured.match(/web_stream_timing assistantId=[^\n]*/);
    assert.ok(matched, `expected web_stream_timing log line in captured stdout: ${captured}`);
    const line = matched[0];
    assert.match(line, /toolStarts=1/);
    assert.match(line, /toolEnds=1/);
    assert.match(line, /interDeltaCount=\d+/);
    assert.match(line, /interDeltaMaxMs=\d+/);
    assert.match(line, /interDeltaP95Ms=\d+/);
    assert.match(line, /postToolFirstDeltaCount=\d+/);
    assert.match(line, /postToolFirstDeltaMaxMs=\d+/);
    assert.match(line, /sse_writes=4/);
  });

  test("does not emit extended web_stream_timing fields when admin trace toggle is off", async () => {
    const service = buildToolStreamingServiceForTraceTest({ traceEnabled: false });
    const { captured } = await captureProcessStdoutSync(async () => {
      const outcome = await service.streamToCompletion(
        buildToolStreamingPreparedFixture({ traceEnabled: false }) as never,
        {
          isClientAborted: () => false,
          onDelta: () => undefined,
          onThinking: () => undefined,
          onTool: () => undefined,
          onDone: () => undefined,
          getSseWriterStatsSummary: () => null
        }
      );
      assert.equal(outcome.status, "completed");
    });

    const matched = captured.match(/web_stream_timing assistantId=[^\n]*/);
    assert.ok(matched, `expected web_stream_timing log line in captured stdout: ${captured}`);
    const line = matched[0];
    assert.doesNotMatch(line, /toolStarts=/);
    assert.doesNotMatch(line, /interDeltaCount=/);
    assert.doesNotMatch(line, /sse_writes=/);
  });
});

function buildToolStreamingServiceForTraceTest(options: {
  traceEnabled: boolean;
}): StreamWebChatTurnService {
  return new StreamWebChatTurnService(
    {
      createMessage: async (input: Record<string, unknown>) => ({
        id: "assistant-msg-1",
        chatId: input.chatId,
        assistantId: input.assistantId,
        author: input.author,
        content: input.content,
        createdAt: new Date("2026-04-05T12:00:00.000Z")
      }),
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
          type: "delta",
          delta: "Looking it up...",
          accumulated: "Looking it up..."
        };
        yield {
          type: "tool",
          toolPhase: "start",
          toolName: "files.list",
          toolCallId: "tool-1"
        };
        yield {
          type: "tool",
          toolPhase: "end",
          toolName: "files.list",
          toolCallId: "tool-1",
          isError: false
        };
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield {
          type: "delta",
          delta: " here it is.",
          accumulated: "Looking it up... here it is."
        };
        yield {
          type: "done",
          respondedAt: "2026-04-05T12:00:01.000Z"
        };
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
      deliver: async () => ({ attachments: [] })
    } as never,
    createOverviewLatencyTraceServiceMock({ enabled: options.traceEnabled }) as never,
    createAttachmentObjectAvailabilityServiceMock() as never
  );
}

function buildToolStreamingPreparedFixture(options: { traceEnabled: boolean }) {
  return {
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
      content: "list files",
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
    workspaceTimezone: "UTC",
    traceHandle: createOverviewLatencyTraceServiceMock({ enabled: options.traceEnabled }).start()
  };
}
