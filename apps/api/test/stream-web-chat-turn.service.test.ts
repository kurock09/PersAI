import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAssistantInboundConflict } from "../src/modules/workspace-management/application/assistant-inbound-error";
import {
  resolveWebStreamCadenceWatchdogOptions,
  StreamWebChatTurnService
} from "../src/modules/workspace-management/application/stream-web-chat-turn.service";
import { PrismaAssistantChatRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository";

const noopRecordToolPathLedgerFromToolInvocationsService = {
  async recordFromToolInvocations() {
    return undefined;
  }
} as never;

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

function createPlatformHttpMetricsServiceMock() {
  return {
    recordWebStreamTurn() {
      return undefined;
    },
    recordWebStreamStage() {
      return undefined;
    }
  };
}

function createWebRuntimeTurnClientServiceMock() {
  return {};
}

function createSkillStatePersistenceServiceMock() {
  return {
    buildRuntimeContext: (input: { decisionState?: unknown }) => ({
      decision: input.decisionState ?? null
    }),
    persistFromTurnRouting: async () => ({
      skillDecisionState: null
    })
  };
}

function createAssistantDocumentJobReadServiceMock() {
  return {
    listOpenJobsForWebChat: async () => [],
    listOpenJobsForRuntimeContext: async () => [],
    listJobDeliveryUpdatesForRuntimeContext: async () => []
  };
}

function createNotificationDeliveryWorkerServiceMock() {
  return {
    deliverIntentNow: async () => ({
      providerRef: null
    })
  };
}

function createAssistantBrowserProfileRepositoryMock(
  pendingProfile: Record<string, unknown> | null = null
) {
  return {
    findMostRecentPendingLoginForChat: async () => pendingProfile
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
  test("disables both cadence watchdog signals for all chat streams", () => {
    const projectOptions = resolveWebStreamCadenceWatchdogOptions("project");
    const normalOptions = resolveWebStreamCadenceWatchdogOptions("normal");

    assert.equal(projectOptions.slowAvgEnabled, false);
    assert.equal(projectOptions.silentEnabled, false);
    assert.equal(projectOptions.silentMs, normalOptions.silentMs);
    assert.equal(normalOptions.slowAvgEnabled, false);
    assert.equal(normalOptions.silentEnabled, false);
  });

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
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "assistant",
          content,
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
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async (input: Record<string, unknown>) => {
          quotaWrites.push(input);
        }
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
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
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
    assert.equal(quotaWrites.length, 1);
    assert.equal(quotaWrites[0]?.assistantContent, "Media sent.");
    const transport = (
      outcome as {
        transport: {
          assistantMessage: { content: string; attachments: unknown[] };
          engagementSummary: unknown;
        };
      }
    ).transport;
    assert.equal(transport.assistantMessage.content, "Media sent.");
    assert.ok(Array.isArray(transport.assistantMessage.attachments));
    assert.equal(
      (transport.assistantMessage.attachments[0] as Record<string, unknown>)?.id,
      "att-1"
    );
    assert.equal(
      (transport.assistantMessage.attachments[0] as Record<string, unknown>)?.attachmentType,
      "audio"
    );
    assert.equal(
      (transport.assistantMessage.attachments[0] as Record<string, unknown>)?.originalFilename,
      "reply.ogg"
    );
    assert.equal(Object.hasOwn(transport, "engagementSummary"), true);
    assert.equal(transport.engagementSummary, null);
  });

  test("persists final answer from done chunk and preamble in metadata", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];

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
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "assistant",
          content,
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
            delta: "Сначала проверю файл.",
            accumulated: "Сначала проверю файл."
          };
          yield {
            type: "tool",
            toolPhase: "start",
            toolName: "read_file",
            toolCallId: "tool-1"
          };
          yield {
            type: "tool",
            toolPhase: "end",
            toolName: "read_file",
            toolCallId: "tool-1"
          };
          yield {
            type: "delta",
            delta: "Готово.",
            accumulated: "Сначала проверю файл.Готово."
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            finalAnswer: "Готово.",
            workingNotes: ["Сначала проверю файл."],
            toolInvocations: [
              {
                name: "knowledge_search",
                iteration: 0,
                ok: true,
                toolCallId: "tool-1",
                billingFacts: { provider: "test" }
              }
            ],
            turnRouting: {
              mode: "shadow",
              executionMode: "premium",
              source: "llm"
            }
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
        onTool: () => undefined,
        onDone: () => undefined
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(createdMessages.length, 1);
    // Golden test 1: content === runtime answerText (byte-equal)
    assert.equal(createdMessages[0]?.content, "Готово.");
    // Golden test 2: no working markers in content
    assert.doesNotMatch(String(createdMessages[0]?.content), /:::working/);
    assert.doesNotMatch(String(createdMessages[0]?.content), /:::/);
    // Golden test 3: working notes preserved in metadata as an array
    assert.deepEqual((createdMessages[0]?.metadata as Record<string, unknown>)?.workingNotes, [
      "Сначала проверю файл."
    ]);
    assert.deepEqual((createdMessages[0]?.metadata as Record<string, unknown>)?.toolInvocations, [
      { name: "knowledge_search", iteration: 0, ok: true, toolCallId: "tool-1" }
    ]);
    const transport = (
      outcome as { transport: { assistantMessage: { toolInvocations?: unknown[] } } }
    ).transport.assistantMessage;
    assert.deepEqual(transport.toolInvocations, [
      { name: "knowledge_search", iteration: 0, ok: true, toolCallId: "tool-1" }
    ]);
  });

  test("persists final answer from done chunk without working markers (multi-tool turn)", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];

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
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "assistant",
          content,
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
            delta: "First plan.",
            accumulated: "First plan."
          };
          yield {
            type: "tool",
            toolPhase: "start",
            toolName: "web_fetch",
            toolCallId: "tool-1"
          };
          yield {
            type: "tool",
            toolPhase: "end",
            toolName: "web_fetch",
            toolCallId: "tool-1"
          };
          yield {
            type: "delta",
            delta: " Second plan.",
            accumulated: "First plan. Second plan."
          };
          yield {
            type: "tool",
            toolPhase: "start",
            toolName: "web_fetch",
            toolCallId: "tool-2"
          };
          yield {
            type: "tool",
            toolPhase: "end",
            toolName: "web_fetch",
            toolCallId: "tool-2"
          };
          yield {
            type: "delta",
            delta: " Done.",
            accumulated: "First plan. Second plan. Done."
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            finalAnswer: "Done.",
            workingNotes: ["First plan.", "Second plan."],
            turnRouting: {
              mode: "shadow",
              executionMode: "premium",
              source: "llm"
            }
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
        onTool: () => undefined,
        onDone: () => undefined
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(createdMessages.length, 1);
    // content is the clean final answer — no :::working markers
    assert.equal(createdMessages[0]?.content, "Done.");
    assert.doesNotMatch(String(createdMessages[0]?.content), /:::working/);
    // multi-step working notes preserved in metadata as an array
    assert.deepEqual((createdMessages[0]?.metadata as Record<string, unknown>)?.workingNotes, [
      "First plan.",
      "Second plan."
    ]);
    // Symptom 1: the live completed transport carries workingNotes so the
    // "Done" block renders without reopening the chat.
    const liveTransport = (outcome as { transport?: Record<string, unknown> | null }).transport;
    const liveAssistantMessage = (liveTransport as { assistantMessage?: Record<string, unknown> })
      ?.assistantMessage;
    assert.deepEqual(liveAssistantMessage?.workingNotes, ["First plan.", "Second plan."]);
  });

  test("delivers compaction follow-up on streamed turns after media has already been attached", async () => {
    const deliveredIntentIds: string[] = [];
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
        findChatById: async () => ({
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:00.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:00.000Z")
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "assistant",
          content,
          createdAt: new Date("2026-04-05T12:00:00.000Z")
        }),
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content:
            messageId === "follow-up-msg-1" ? "Please start a new chat." : "Here is your file.",
          createdAt: new Date("2026-04-05T12:00:00.000Z")
        })
      } as never,
      {
        listByMessageId: async (messageId: string) =>
          messageId === "assistant-msg-1"
            ? [
                {
                  id: "att-1",
                  assistantFileId: null,
                  attachmentType: "audio",
                  originalFilename: "reply.ogg",
                  mimeType: "audio/ogg",
                  sizeBytes: BigInt(1234),
                  processingStatus: "ready",
                  metadata: null,
                  createdAt: new Date("2026-04-05T12:00:00.000Z")
                }
              ]
            : []
      } as never,
      {
        releaseWebTurnProcessing: async () => undefined,
        completeWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async function* () {
          yield { type: "delta", delta: "Here is your file.", accumulated: "Here is your file." };
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
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
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
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliverIntentNow: async (intentId: string) => {
          deliveredIntentIds.push(intentId);
          return {
            status: "delivered",
            providerRef: "web_thread:thread-1:follow-up-msg-1",
            channel: "web_thread"
          };
        }
      } as never,
      createAssistantBrowserProfileRepositoryMock() as never,
      {
        maybeCreateFollowUp: async () => null
      } as never,
      undefined,
      {
        maybeCreateFollowUp: async () => ({
          intentId: "intent-compaction-1"
        })
      } as never
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
    assert.equal(deliveredIntentIds.length, 1);
    const transport = (
      outcome as {
        transport: {
          assistantMessage: { attachments: Array<Record<string, unknown>> };
          followUpAssistantMessage?: { id: string; content: string };
        };
      }
    ).transport;
    assert.equal(transport.assistantMessage.attachments.length, 1);
    assert.equal(transport.assistantMessage.attachments[0]?.id, "att-1");
    assert.equal(transport.followUpAssistantMessage?.id, "follow-up-msg-1");
    assert.equal(transport.followUpAssistantMessage?.content, "Please start a new chat.");
  });

  test("treats streamed follow-up delivery failure as non-blocking and does not persist an interrupted duplicate", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];

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
        findChatById: async () => ({
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web_chat",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          archivedAt: null,
          lastMessageAt: new Date("2026-04-05T12:00:00.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:00.000Z")
        }),
        updateMessageContent: async (messageId: string, assistantId: string, content: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId,
          author: "assistant",
          content,
          createdAt: new Date("2026-04-05T12:00:00.000Z")
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
            delta: "Here is your answer.",
            accumulated: "Here is your answer."
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            turnRouting: null
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliverIntentNow: async () => {
          throw new Error("follow-up delivery failed");
        }
      } as never,
      createAssistantBrowserProfileRepositoryMock() as never,
      {
        maybeCreateFollowUp: async () => ({
          intentId: "intent-quota-1"
        })
      } as never
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
    assert.equal(createdMessages[0]?.content, "Here is your answer.");
    assert.ok(
      !("followUpAssistantMessage" in (outcome as { transport: Record<string, unknown> }).transport)
    );
  });

  test("keeps streamed assistant text unchanged when runtime queued media but final web delivery produced no attachments", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    const updatedContents: string[] = [];
    const quotaWrites: Array<Record<string, unknown>> = [];
    const ledgerWrites: Array<Record<string, unknown>> = [];

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
            respondedAt: "2026-04-05T12:00:01.000Z",
            usageAccounting: {
              inputTokens: 120,
              cachedInputTokens: 20,
              outputTokens: 40,
              totalTokens: 160,
              entries: [
                {
                  stepType: "main_turn",
                  modelRole: "normal_reply",
                  providerKey: "openai",
                  modelKey: "gpt-5-mini",
                  inputTokens: 120,
                  cachedInputTokens: 20,
                  outputTokens: 40,
                  totalTokens: 160
                }
              ]
            }
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async (input: Record<string, unknown>) => {
          quotaWrites.push(input);
        }
      } as never,
      {
        recordChatMainReplyEvents: async (input: Record<string, unknown>) => {
          ledgerWrites.push(input);
          return 1;
        }
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({
          attachments: []
        })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
        workspaceTimezone: "UTC",
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
    assert.equal(createdMessages[0]?.content, "Отправляю hello.txt");
    assert.equal(updatedContents.length, 0);
    const transport = (
      outcome as { transport: { assistantMessage: { content: string; attachments: unknown[] } } }
    ).transport.assistantMessage;
    assert.equal(transport.attachments.length, 0);
    assert.equal(transport.content, "Отправляю hello.txt");
    assert.equal(quotaWrites[0]?.assistantContent, "Отправляю hello.txt");
    assert.equal(ledgerWrites.length, 1);
    assert.equal(ledgerWrites[0]?.sourceEventId, "assistant-msg-1");
    assert.equal(ledgerWrites[0]?.purpose, "chat_main_reply");
    assert.equal(ledgerWrites[0]?.surface, "web");
    assert.equal(ledgerWrites[0]?.occurredAt, "2026-04-05T12:00:01.000Z");
  });

  test("routes stream web turns through the web runtime client service", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    const toolEvents: Array<Record<string, unknown>> = [];
    const callbackOrder: string[] = [];
    let webRuntimeCalls = 0;
    let capturedWebRuntimeUserMessage = "";
    let capturedOpenMediaJobs: unknown[] | undefined;
    let capturedJobDeliveryUpdates: unknown[] | undefined;
    let capturedBridgeDeviceId: string | undefined;
    let capturedBridgeDeviceKind: string | undefined;

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
        execute: async function* (input: {
          userMessage: string;
          openMediaJobs?: unknown[];
          jobDeliveryUpdates?: unknown[];
          bridgeDeviceId?: string;
          bridgeDeviceKind?: string;
        }) {
          webRuntimeCalls += 1;
          capturedWebRuntimeUserMessage = input.userMessage;
          capturedOpenMediaJobs = input.openMediaJobs;
          capturedJobDeliveryUpdates = input.jobDeliveryUpdates;
          capturedBridgeDeviceId = input.bridgeDeviceId;
          capturedBridgeDeviceKind = input.bridgeDeviceKind;
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
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({
          attachments: []
        })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [
          {
            jobId: "job-1",
            kind: "image",
            toolCode: "image_generate",
            status: "running",
            createdAt: "2026-04-05T11:59:00.000Z",
            startedAt: "2026-04-05T11:59:10.000Z",
            updatedAt: "2026-04-05T11:59:30.000Z"
          }
        ],
        listJobDeliveryUpdatesForChatContext: async () => [
          {
            kind: "media",
            jobId: "job-2",
            mediaKind: "image",
            toolCode: "image_generate",
            deliveryStatus: "finalizing_delivery",
            sourceSummary: "festival banner",
            requestedCount: 1,
            expectedResultCount: 1,
            createdAt: "2026-04-05T11:58:00.000Z",
            startedAt: "2026-04-05T11:58:10.000Z",
            completedAt: "2026-04-05T11:58:40.000Z",
            updatedAt: "2026-04-05T11:58:40.000Z",
            deliveredAt: null
          }
        ],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
        workspaceTimezone: "UTC",
        bridgeDeviceId: "mobile-device-1",
        bridgeDeviceKind: "capacitor"
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
    assert.equal(webRuntimeCalls, 1);
    assert.equal(capturedWebRuntimeUserMessage, "hello");
    assert.equal(capturedBridgeDeviceId, "mobile-device-1");
    assert.equal(capturedBridgeDeviceKind, "capacitor");
    assert.deepEqual(capturedOpenMediaJobs, [
      {
        jobId: "job-1",
        kind: "image",
        toolCode: "image_generate",
        status: "running",
        createdAt: "2026-04-05T11:59:00.000Z",
        startedAt: "2026-04-05T11:59:10.000Z",
        updatedAt: "2026-04-05T11:59:30.000Z"
      }
    ]);
    assert.deepEqual(capturedJobDeliveryUpdates, [
      {
        kind: "media",
        jobId: "job-2",
        mediaKind: "image",
        toolCode: "image_generate",
        deliveryStatus: "finalizing_delivery",
        sourceSummary: "festival banner",
        requestedCount: 1,
        expectedResultCount: 1,
        createdAt: "2026-04-05T11:58:00.000Z",
        startedAt: "2026-04-05T11:58:10.000Z",
        completedAt: "2026-04-05T11:58:40.000Z",
        updatedAt: "2026-04-05T11:58:40.000Z",
        deliveredAt: null
      }
    ]);
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

  test("fires onPendingBrowserLogin when browser tool ends with pending profile", async () => {
    const pendingProfile = {
      id: "profile-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      originHost: "example.bitrix24.ru",
      bridgeSessionRef: null,
      bridgeClientKind: "extension",
      status: "pending_login" as const,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date("2026-07-05T12:00:00.000Z"),
      updatedAt: new Date("2026-07-05T12:00:00.000Z")
    };
    const pendingLoginEvents: Array<Record<string, unknown>> = [];

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
            type: "tool",
            toolPhase: "start",
            toolName: "browser",
            toolCallId: "tool-browser-1"
          };
          yield {
            type: "tool",
            toolPhase: "end",
            toolName: "browser",
            toolCallId: "tool-browser-1",
            toolRequestedAction: "login",
            isError: false
          };
          yield {
            type: "delta",
            delta: "Please sign in.",
            accumulated: "Please sign in."
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            finalAnswer: "Please sign in."
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock(pendingProfile) as never
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
          content: "log into bitrix",
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
        onTool: () => undefined,
        onDone: () => undefined,
        onPendingBrowserLogin: (state) => {
          pendingLoginEvents.push(state as Record<string, unknown>);
        }
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(pendingLoginEvents.length, 1);
    assert.deepEqual(pendingLoginEvents[0], {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      workspaceId: "workspace-1",
      bridgeClientKind: "extension",
      completionMode: "login"
    });
  });

  test("does not fire onPendingBrowserLogin when browser snapshot tool ends", async () => {
    const pendingProfile = {
      id: "profile-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      originHost: "example.bitrix24.ru",
      bridgeSessionRef: null,
      bridgeClientKind: "extension",
      status: "pending_login" as const,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date("2026-07-05T12:00:00.000Z"),
      updatedAt: new Date("2026-07-05T12:00:00.000Z")
    };
    const pendingLoginEvents: Array<Record<string, unknown>> = [];

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
            type: "tool",
            toolPhase: "end",
            toolName: "browser",
            toolCallId: "tool-browser-1",
            toolRequestedAction: "snapshot",
            isError: false
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            finalAnswer: "Done."
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock(pendingProfile) as never
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
          content: "take a screenshot",
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
        onTool: () => undefined,
        onDone: () => undefined,
        onPendingBrowserLogin: (state) => {
          pendingLoginEvents.push(state as Record<string, unknown>);
        }
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(pendingLoginEvents.length, 0);
  });

  test("retries stream web turn after waiting for active compaction conflict", async () => {
    let webRuntimeCalls = 0;
    let compactionWaitCalls = 0;

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
          webRuntimeCalls += 1;
          if (webRuntimeCalls === 1) {
            throw createAssistantInboundConflict(
              "native_runtime_conflict",
              "Session is already processing another turn."
            );
          }
          yield { type: "delta", delta: "recovered", accumulated: "recovered" };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            turnRouting: null
          };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({
          attachments: []
        })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliverIntentNow: async () => undefined
      } as never,
      createAssistantBrowserProfileRepositoryMock() as never,
      {
        maybeCreateFollowUp: async () => null
      } as never,
      undefined,
      undefined,
      {
        async waitForActiveThreadCompaction() {
          compactionWaitCalls += 1;
          return {
            waited: compactionWaitCalls > 1,
            readyForRetry: compactionWaitCalls > 1,
            noticeKind: null
          };
        }
      } as never
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
    assert.equal(webRuntimeCalls, 2);
    assert.equal(compactionWaitCalls, 2);
    assert.equal(outcome.transport?.assistantMessage.content, "recovered");
  });

  test("uses the admin-managed onboarding prompt for welcome stream turns", async () => {
    let capturedWebRuntimeUserMessage = "";

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
          capturedWebRuntimeUserMessage = input.userMessage;
          yield { type: "delta", delta: "Hi Alex", accumulated: "Hi Alex" };
          yield { type: "done", respondedAt: "2026-04-05T12:00:01.000Z" };
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
      capturedWebRuntimeUserMessage,
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
        }),
        findMessageToolContextById: async () => null
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
          throw new Error("web runtime stream should not be used for replay");
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
      assert.equal(Object.hasOwn(preparation.transport, "engagementSummary"), true);
      assert.equal(preparation.transport.engagementSummary, null);
      assert.ok(Array.isArray(preparation.transport.activeSandboxJobs));
    }
  });

  test("stream replay projection includes activeSandboxJobs", async () => {
    const sandboxJobs = [
      {
        jobRef: "jr1.sandbox.gggggggggggggggggggggggggggggggg",
        toolCode: "exec" as const,
        status: "running" as const,
        notifyState: "subscribed" as const,
        createdAt: "2026-07-18T12:00:00.000Z",
        startedAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:01.000Z"
      }
    ];
    const completedState = {
      clientTurnId: "turn-sandbox-stream-replay",
      chatId: "chat-1",
      userMessageId: "user-msg-1",
      assistantMessageId: "assistant-msg-1",
      respondedAt: "2026-07-18T12:00:01.000Z",
      degradedByQuotaFallback: false,
      quotaFallbackReason: null,
      quotaFallbackModel: null,
      completedAt: "2026-07-18T12:00:02.000Z"
    };
    const service = new StreamWebChatTurnService(
      {
        findChatById: async () => ({
          id: "chat-1",
          assistantId: "assistant-1",
          userId: "user-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          chatMode: "normal",
          deepModeEnabled: false,
          skillDecisionState: null,
          archivedAt: null,
          lastMessageAt: new Date("2026-07-18T12:00:02.000Z"),
          createdAt: new Date("2026-07-18T12:00:00.000Z"),
          updatedAt: new Date("2026-07-18T12:00:02.000Z")
        }),
        findMessageByIdForAssistant: async (messageId: string) => ({
          id: messageId,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: messageId === "user-msg-1" ? "user" : "assistant",
          content: messageId === "user-msg-1" ? "hello" : "hi back",
          createdAt: new Date("2026-07-18T12:00:00.000Z")
        }),
        findMessageToolContextById: async () => null
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
          throw new Error("web runtime stream should not be used for replay");
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        finalizeSourceTurn: async () => ({
          finalized: 0,
          legacyChosen: 0,
          autoSubscribed: 0,
          currentTurnPreserved: 0,
          currentTurnReleased: 0
        }),
        listOpenSandboxJobsForWebChat: async () => sandboxJobs
      } as never
    );

    const preparation = await service.prepare("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello",
      clientTurnId: "turn-sandbox-stream-replay"
    });

    assert.equal(preparation.mode, "replayed");
    if (preparation.mode === "replayed") {
      assert.deepEqual(preparation.transport.activeSandboxJobs, sandboxJobs);
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

    const matched = captured.match(/web_stream_timing traceId=[^\n]*/);
    assert.ok(matched, `expected web_stream_timing log line in captured stdout: ${captured}`);
    const line = matched[0];
    assert.match(line, /traceId=trace-test/);
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

    const matched = captured.match(/web_stream_timing traceId=[^\n]*/);
    assert.ok(matched, `expected web_stream_timing log line in captured stdout: ${captured}`);
    const line = matched[0];
    assert.match(line, /traceId=trace-test/);
    assert.doesNotMatch(line, /toolStarts=/);
    assert.doesNotMatch(line, /interDeltaCount=/);
    assert.doesNotMatch(line, /sse_writes=/);
  });

  test("partial on abort: persists metadata.status=partial with accumulated content", async () => {
    const createdMessages: Array<Record<string, unknown>> = [];
    let aborted = false;

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
            metadata: input.metadata,
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
          chatMode: null,
          deepModeEnabled: false,
          skillDecisionState: null,
          lastMessageAt: new Date("2026-04-05T12:00:00.000Z"),
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
          updatedAt: new Date("2026-04-05T12:00:00.000Z")
        }),
        createSystemMessage: async (input: Record<string, unknown>) => ({
          id: "system-msg-1",
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: "system",
          content: input.content,
          createdAt: new Date("2026-04-05T12:00:00.000Z")
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
            delta: "Пишу ответ...",
            accumulated: "Пишу ответ..."
          };
          aborted = true;
          // generator ends without emitting done — stream was aborted
        }
      } as never,
      createWebRuntimeTurnClientServiceMock() as never,
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        markUndeliveredArtifactsReconciliationRequired: async () => undefined,
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createPlatformHttpMetricsServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createAssistantBrowserProfileRepositoryMock() as never
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
        isClientAborted: () => aborted,
        onDelta: () => undefined,
        onThinking: () => undefined,
        onTool: () => undefined,
        onDone: () => undefined
      }
    );

    assert.equal(outcome.status, "interrupted");
    const assistantMsg = createdMessages.find((m) => m.author === "assistant");
    assert.ok(assistantMsg, "expected an assistant message to be persisted");
    assert.ok(
      typeof assistantMsg.content === "string" && assistantMsg.content.trim().length > 0,
      "expected non-empty partial content"
    );
    assert.equal(
      (assistantMsg.metadata as Record<string, unknown>)?.status,
      "partial",
      "expected metadata.status === 'partial'"
    );
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
    createWebRuntimeTurnClientServiceMock() as never,
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
      recordWebChatTurnUsage: async () => undefined
    } as never,
    {
      recordChatMainReplyEvents: async () => 0
    } as never,
    noopRecordToolPathLedgerFromToolInvocationsService,
    {
      markUndeliveredArtifactsReconciliationRequired: async () => undefined,
      deliver: async () => ({ attachments: [] })
    } as never,
    createOverviewLatencyTraceServiceMock({ enabled: options.traceEnabled }) as never,
    createPlatformHttpMetricsServiceMock() as never,
    createAttachmentObjectAvailabilityServiceMock() as never,
    createSkillStatePersistenceServiceMock() as never,
    {
      attachAcknowledgementMessageId: async () => 0,
      listOpenJobsForChatContext: async () => [],
      listOpenJobsForWebChat: async () => []
    } as never,
    createAssistantDocumentJobReadServiceMock() as never,
    createNotificationDeliveryWorkerServiceMock() as never,
    createAssistantBrowserProfileRepositoryMock() as never
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
