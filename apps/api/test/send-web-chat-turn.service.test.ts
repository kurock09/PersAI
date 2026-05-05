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

function createAttachmentObjectAvailabilityServiceMock() {
  return {
    assertRuntimeReadable: async () => undefined
  };
}

function createSkillStatePersistenceServiceMock() {
  return {
    buildRuntimeContext: async (input: { decisionState?: unknown; cadenceState?: unknown }) => ({
      decision: input.decisionState ?? null,
      cadence: input.cadenceState ?? null,
      currentUserMessageIndex: 1,
      recentMessages: []
    }),
    createBackgroundCheckContext: (context: Record<string, unknown>) => ({
      ...context,
      forceCheck: true
    }),
    persistFromTurnRouting: async () => ({
      skillDecisionState: null,
      skillCadenceState: null
    }),
    markBackgroundCheckQueued: async () => undefined,
    shouldRunBackgroundCheck: () => false,
    runBackgroundCheck: () => undefined
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
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {} as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never
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
    let capturedOpenMediaJobs: unknown[] | undefined;

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
        execute: async (input: { userMessage: string; openMediaJobs?: unknown[] }) => {
          nativeRuntimeCalls += 1;
          capturedNativeUserMessage = input.userMessage;
          capturedOpenMediaJobs = input.openMediaJobs;
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
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello"
    });

    assert.equal(nativeRuntimeCalls, 1);
    assert.equal(capturedNativeUserMessage, "hello");
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
    assert.equal(result.assistantMessage.content, "native");
    assert.deepEqual(result.runtime.turnRouting, {
      mode: "shadow",
      executionMode: "premium",
      source: "llm"
    });
  });

  test("forces classifier drift checks for background skill rechecks", async () => {
    let backgroundCheckContext: Record<string, unknown> | null = null;
    let backgroundCheckPromise: Promise<unknown> | null = null;

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
        execute: async () => ({
          assistantMessage: "native",
          respondedAt: "2026-04-05T12:00:01.000Z",
          media: []
        }),
        checkSkillRouting: async (input: { skillStateContext?: Record<string, unknown> }) => {
          backgroundCheckContext = input.skillStateContext ?? null;
          return { skillState: null };
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
            deepModeEnabled: false,
            skillDecisionState: {
              status: "active",
              activeSkillId: "skill-1",
              activeSkillName: "Psychologist",
              topicSummary: "pricing topic drift",
              confidence: "high",
              checkedAtMessageIndex: 19
            },
            skillCadenceState: {
              messageCountSinceCheck: 5
            },
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
            content: "какой тариф лучше",
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
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      {
        buildRuntimeContext: async (input: {
          decisionState?: unknown;
          cadenceState?: unknown;
        }) => ({
          decision: input.decisionState ?? null,
          cadence: input.cadenceState ?? null,
          currentUserMessageIndex: 24,
          recentMessages: [{ role: "user", text: "какой тариф лучше" }]
        }),
        createBackgroundCheckContext: (context: Record<string, unknown>) => ({
          ...context,
          forceCheck: true
        }),
        persistFromTurnRouting: async () => ({
          skillDecisionState: null,
          skillCadenceState: null
        }),
        markBackgroundCheckQueued: async () => undefined,
        shouldRunBackgroundCheck: () => true,
        runBackgroundCheck: (input: { execute: () => Promise<unknown> }) => {
          backgroundCheckPromise = input.execute();
        }
      } as never
    );

    await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "какой тариф лучше"
    });
    await backgroundCheckPromise;

    assert.equal(backgroundCheckContext?.forceCheck, true);
    assert.equal(backgroundCheckContext?.currentUserMessageIndex, 24);
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
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never
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

  test("delivers native runtime media through the shared web media delivery path", async () => {
    const deliveredAttachments = [
      {
        id: "attachment-1",
        attachmentType: "document",
        originalFilename: "program.cpp",
        mimeType: "text/plain",
        sizeBytes: 64,
        processingStatus: "ready",
        createdAt: "2026-04-05T12:00:03.000Z"
      }
    ];
    let deliverInput: Record<string, unknown> | null = null;

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
        execute: async () => ({
          assistantMessage: "native with file",
          respondedAt: "2026-04-05T12:00:01.000Z",
          media: [
            {
              source: "persai_object_storage",
              objectKey: "assistant-media/sandbox/jobs/job-1/program.cpp",
              type: "document",
              mimeType: "text/plain",
              filename: "program.cpp",
              sizeBytes: 64,
              caption: "Here is your program"
            }
          ]
        })
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
            content: "write me a cpp file",
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
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        deliver: async (input: Record<string, unknown>) => {
          deliverInput = input;
          return { attachments: deliveredAttachments };
        }
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "write me a cpp file"
    });

    assert.deepEqual(deliverInput, {
      artifacts: [
        {
          source: "persai_object_storage",
          objectKey: "assistant-media/sandbox/jobs/job-1/program.cpp",
          type: "document",
          mimeType: "text/plain",
          filename: "program.cpp",
          sizeBytes: 64,
          caption: "Here is your program"
        }
      ],
      channel: "web",
      assistantId: "assistant-1",
      chatId: "chat-1",
      messageId: "assistant-msg-1",
      workspaceId: "workspace-1"
    });
    assert.deepEqual(result.assistantMessage.attachments, deliveredAttachments);
  });

  test("corrects assistant text when runtime queued a file but final web delivery produced no attachments", async () => {
    const updatedContents: string[] = [];
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
        }),
        updateMessageContent: async (_messageId: string, _assistantId: string, content: string) => {
          updatedContents.push(content);
          return {
            id: "assistant-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content,
            createdAt: new Date("2026-04-05T12:00:02.000Z")
          };
        }
      } as never,
      {
        listByMessageId: async () => []
      } as never,
      {
        completeWebTurnProcessing: async () => undefined,
        releaseWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async () => ({
          assistantMessage: "Готово, отправляю hello.txt",
          respondedAt: "2026-04-05T12:00:01.000Z",
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
        })
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
            content: "send hello again",
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
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "send hello again"
    });

    assert.equal(updatedContents.length, 1);
    assert.match(updatedContents[0] ?? "", /Поправка: файл не был реально доставлен в этот чат/);
    assert.equal(result.assistantMessage.attachments.length, 0);
    assert.match(
      result.assistantMessage.content,
      /Поправка: файл не был реально доставлен в этот чат/
    );
    assert.match(
      String(memoryWrites[0]?.assistantContent ?? ""),
      /Поправка: файл не был реально доставлен в этот чат/
    );
    assert.match(
      String(quotaWrites[0]?.assistantContent ?? ""),
      /Поправка: файл не был реально доставлен в этот чат/
    );
  });
});
