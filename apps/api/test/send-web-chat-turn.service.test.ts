import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SendWebChatTurnService } from "../src/modules/workspace-management/application/send-web-chat-turn.service";
import { createAssistantInboundConflict } from "../src/modules/workspace-management/application/assistant-inbound-error";

const noopRecordToolPathLedgerFromToolInvocationsService = {
  async recordFromToolInvocations() {
    return undefined;
  }
} as never;

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
    buildRuntimeContext: (input: { decisionState?: unknown }) => ({
      decision: input.decisionState ?? null
    }),
    persistFromTurnRouting: async () => ({
      skillDecisionState: null
    })
  };
}

function createQuotaAdvisoryFollowUpServiceMock() {
  return {
    maybeCreateFollowUp: async () => null
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

describe("SendWebChatTurnService", () => {
  test("parseInput accepts chatMode and derives compatibility deep mode", () => {
    const service = Object.create(SendWebChatTurnService.prototype) as SendWebChatTurnService;

    assert.deepEqual(
      service.parseInput({
        surfaceThreadKey: " thread-1 ",
        message: " hello ",
        chatMode: "project"
      }),
      {
        surfaceThreadKey: "thread-1",
        message: "hello",
        chatMode: "project",
        deepModeEnabled: true
      }
    );

    assert.deepEqual(
      service.parseInput({
        surfaceThreadKey: "thread-1",
        message: "hello",
        deepModeEnabled: true
      }),
      {
        surfaceThreadKey: "thread-1",
        message: "hello",
        deepModeEnabled: true
      }
    );

    assert.throws(
      () =>
        service.parseInput({
          surfaceThreadKey: "thread-1",
          message: "hello",
          chatMode: "project",
          deepModeEnabled: false
        }),
      /chatMode conflicts/
    );
  });

  test("replays duplicate clientTurnId without starting a second web runtime turn", async () => {
    let webRuntimeCalls = 0;
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
          webRuntimeCalls += 1;
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
          assistantId: "assistant-1",
          assistant: {
            workspaceId: "workspace-1"
          }
        })
      } as never,
      {} as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {} as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello",
      clientTurnId: "turn-1"
    });

    assert.equal(webRuntimeCalls, 0);
    assert.equal(result.userMessage.id, "user-msg-1");
    assert.equal(result.assistantMessage.id, "assistant-msg-1");
    assert.equal(result.assistantMessage.content, "hi back");
    assert.deepEqual(result.runtime.turnRouting, {
      mode: "shadow",
      executionMode: "reasoning",
      source: "precheck"
    });
  });

  test("routes sync web turns through the web runtime client service", async () => {
    let webRuntimeCalls = 0;
    let capturedWebRuntimeUserMessage = "";
    let capturedOpenMediaJobs: unknown[] | undefined;
    let capturedJobDeliveryUpdates: unknown[] | undefined;

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
        execute: async (input: {
          userMessage: string;
          openMediaJobs?: unknown[];
          jobDeliveryUpdates?: unknown[];
        }) => {
          webRuntimeCalls += 1;
          capturedWebRuntimeUserMessage = input.userMessage;
          capturedOpenMediaJobs = input.openMediaJobs;
          capturedJobDeliveryUpdates = input.jobDeliveryUpdates;
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
          assistantId: "assistant-1",
          assistant: {
            workspaceId: "workspace-1"
          }
        })
      } as never,
      {
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
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
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello"
    });

    assert.equal(webRuntimeCalls, 1);
    assert.equal(capturedWebRuntimeUserMessage, "hello");
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
    assert.equal(result.assistantMessage.content, "native");
    assert.deepEqual(result.runtime.turnRouting, {
      mode: "shadow",
      executionMode: "premium",
      source: "llm"
    });
  });

  test("forwards open document jobs from document read service to runtime client", async () => {
    let capturedOpenDocumentJobs: unknown[] | undefined;
    let capturedJobDeliveryUpdates: unknown[] | undefined;

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
        execute: async (input: {
          userMessage: string;
          openDocumentJobs?: unknown[];
          jobDeliveryUpdates?: unknown[];
        }) => {
          capturedOpenDocumentJobs = input.openDocumentJobs;
          capturedJobDeliveryUpdates = input.jobDeliveryUpdates;
          return {
            assistantMessage: "native",
            respondedAt: "2026-04-05T12:00:01.000Z",
            media: [],
            turnRouting: { mode: "shadow", executionMode: "premium", source: "llm" }
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
            content: "документ готов?",
            attachments: [],
            createdAt: "2026-04-05T12:00:00.000Z"
          },
          assistant: { id: "assistant-1", workspaceId: "workspace-1" },
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
          assistantId: "assistant-1",
          assistant: { workspaceId: "workspace-1" }
        })
      } as never,
      { recordWebChatTurnUsage: async () => undefined } as never,
      { recordChatMainReplyEvents: async () => 0 } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        listOpenJobsForWebChat: async () => [],
        listOpenJobsForRuntimeContext: async () => [
          {
            jobId: "doc-job-1",
            descriptorMode: "create_pdf_document",
            documentType: "pdf_document",
            status: "running",
            sourceSummary: "документ по брифу",
            createdAt: "2026-04-05T11:59:00.000Z",
            startedAt: "2026-04-05T11:59:10.000Z",
            updatedAt: "2026-04-05T11:59:30.000Z"
          }
        ],
        listJobDeliveryUpdatesForRuntimeContext: async () => [
          {
            kind: "document",
            jobId: "doc-job-2",
            descriptorMode: "create_pdf_document",
            documentType: "pdf_document",
            deliveryStatus: "delivered_recently",
            sourceSummary: "документ по брифу",
            createdAt: "2026-04-05T11:50:00.000Z",
            startedAt: "2026-04-05T11:50:10.000Z",
            completedAt: "2026-04-05T11:51:00.000Z",
            updatedAt: "2026-04-05T11:51:10.000Z",
            deliveredAt: "2026-04-05T11:51:10.000Z"
          }
        ]
      } as never,
      { deliver: async () => ({ attachments: [] }) } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    await service.execute("user-1", { surfaceThreadKey: "thread-1", message: "документ готов?" });

    assert.deepEqual(capturedOpenDocumentJobs, [
      {
        jobId: "doc-job-1",
        descriptorMode: "create_pdf_document",
        documentType: "pdf_document",
        status: "running",
        sourceSummary: "документ по брифу",
        createdAt: "2026-04-05T11:59:00.000Z",
        startedAt: "2026-04-05T11:59:10.000Z",
        updatedAt: "2026-04-05T11:59:30.000Z"
      }
    ]);
    assert.deepEqual(capturedJobDeliveryUpdates, [
      {
        kind: "document",
        jobId: "doc-job-2",
        descriptorMode: "create_pdf_document",
        documentType: "pdf_document",
        deliveryStatus: "delivered_recently",
        sourceSummary: "документ по брифу",
        createdAt: "2026-04-05T11:50:00.000Z",
        startedAt: "2026-04-05T11:50:10.000Z",
        completedAt: "2026-04-05T11:51:00.000Z",
        updatedAt: "2026-04-05T11:51:10.000Z",
        deliveredAt: "2026-04-05T11:51:10.000Z"
      }
    ]);
  });

  test("uses the admin-managed onboarding prompt for welcome sync turns", async () => {
    let capturedWebRuntimeUserMessage = "";
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
          capturedWebRuntimeUserMessage = input.userMessage;
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
        recordWebChatTurnUsage: async (input: Record<string, unknown>) => {
          quotaWrites.push(input);
        }
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    await service.execute("user-1", {
      surfaceThreadKey: "welcome",
      message: "__welcome_init__",
      welcomeTurn: true,
      welcomeLocale: "ru"
    });

    assert.equal(
      capturedWebRuntimeUserMessage,
      "You just came online. Introduce yourself warmly to Alex."
    );
    assert.equal(
      quotaWrites[0]?.userContent,
      "You just came online. Introduce yourself warmly to Alex."
    );
  });

  test("delivers web runtime media through the shared web media delivery path", async () => {
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
          assistantId: "assistant-1",
          assistant: {
            workspaceId: "workspace-1"
          }
        })
      } as never,
      {
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async (input: Record<string, unknown>) => {
          deliverInput = input;
          return { attachments: deliveredAttachments };
        }
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
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
    const quotaWrites: Array<Record<string, unknown>> = [];
    const ledgerWrites: Array<Record<string, unknown>> = [];

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
          },
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
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "send hello again",
      welcomeLocale: "ru"
    });

    assert.equal(updatedContents.length, 1);
    assert.match(updatedContents[0] ?? "", /Поправка: файл не был реально доставлен в этот чат/);
    assert.equal(result.assistantMessage.attachments.length, 0);
    assert.match(
      result.assistantMessage.content,
      /Поправка: файл не был реально доставлен в этот чат/
    );
    assert.match(
      String(quotaWrites[0]?.assistantContent ?? ""),
      /Поправка: файл не был реально доставлен в этот чат/
    );
    assert.equal(ledgerWrites.length, 1);
    assert.equal(ledgerWrites[0]?.sourceEventId, "assistant-msg-1");
    assert.equal(ledgerWrites[0]?.purpose, "chat_main_reply");
    assert.equal(ledgerWrites[0]?.surface, "web");
    assert.equal(ledgerWrites[0]?.occurredAt, "2026-04-05T12:00:01.000Z");
  });

  test("treats post-replay skill-state persistence failure as non-blocking", async () => {
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
        claimWebTurnProcessing: async () => "claimed",
        completeWebTurnProcessing: async () => undefined,
        releaseWebTurnProcessing: async () => undefined
      } as never,
      {
        execute: async () => ({
          assistantMessage: "native",
          respondedAt: "2026-04-05T12:00:01.000Z",
          media: []
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
            skillDecisionState: {
              status: "active",
              activeSkillId: "skill-1",
              activeSkillName: "Helper",
              activeScenarioKey: null,
              activeScenarioDisplayName: null,
              topicSummary: "old"
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      {
        buildRuntimeContext: () => ({
          decision: null
        }),
        persistFromTurnRouting: async () => {
          throw new Error("skill-state write failed");
        }
      } as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello",
      clientTurnId: "turn-1"
    });

    assert.equal(result.assistantMessage.content, "native");
    assert.deepEqual(result.chat.skillDecisionState, {
      status: "active",
      activeSkillId: "skill-1",
      activeSkillName: "Helper",
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: "old"
    });
  });

  test("retries sync web turn after waiting for active compaction conflict", async () => {
    let nativeCalls = 0;
    let compactionWaitCalls = 0;

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
        execute: async () => {
          nativeCalls += 1;
          if (nativeCalls === 1) {
            throw createAssistantInboundConflict(
              "native_runtime_conflict",
              "Session is already processing another turn."
            );
          }
          return {
            assistantMessage: "Recovered web reply",
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
            content: "hello after compaction",
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        deliverIntentNow: async () => undefined
      } as never,
      createQuotaAdvisoryFollowUpServiceMock() as never,
      undefined,
      undefined,
      {
        async waitForActiveThreadCompaction() {
          compactionWaitCalls += 1;
          return { waited: true, readyForRetry: true, noticeKind: "compacted" as const };
        }
      } as never
    );

    const result = await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "hello after compaction"
    });

    assert.equal(nativeCalls, 2);
    assert.equal(compactionWaitCalls, 2);
    assert.equal(result.assistantMessage.content, "Recovered web reply");
  });

  test("does not retry sync web turn when compaction wait timed out", async () => {
    let nativeCalls = 0;
    let compactionWaitCalls = 0;

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
        execute: async () => {
          nativeCalls += 1;
          throw createAssistantInboundConflict(
            "native_runtime_conflict",
            "Session is already processing another turn."
          );
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
            content: "hello after compaction timeout",
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
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      {
        deliverIntentNow: async () => undefined
      } as never,
      createQuotaAdvisoryFollowUpServiceMock() as never,
      undefined,
      undefined,
      {
        async waitForActiveThreadCompaction() {
          compactionWaitCalls += 1;
          return {
            waited: true,
            readyForRetry: false,
            noticeKind: null
          };
        }
      } as never
    );

    await assert.rejects(
      service.execute("user-1", {
        surfaceThreadKey: "thread-1",
        message: "hello after compaction timeout"
      })
    );

    assert.equal(nativeCalls, 1);
    assert.equal(compactionWaitCalls, 2);
  });

  // ADR-126 v3 — when the runtime turn result contains discoveredFilePaths,
  // the persistence call must include them as metadata.discoveredFilePaths.
  test("persists discoveredFilePaths as message metadata when runtime returns file discoveries", async () => {
    let capturedCreateMessageInput: Record<string, unknown> | null = null;

    const service = new SendWebChatTurnService(
      {
        createMessage: async (input: Record<string, unknown>) => {
          capturedCreateMessageInput = input;
          return {
            id: "assistant-msg-1",
            chatId: input.chatId,
            assistantId: input.assistantId,
            author: input.author,
            content: input.content,
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
          assistantMessage: "reply with discovered files",
          respondedAt: "2026-04-05T12:00:01.000Z",
          media: [],
          discoveredFilePaths: [
            "/workspace/outbound/self/report-a.pdf",
            "/workspace/outbound/self/report-b.pdf"
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
            content: "find my files",
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
        resolveByUserId: async () => ({ assistantId: "assistant-1" })
      } as never,
      {
        recordWebChatTurnUsage: async () => undefined
      } as never,
      {
        recordChatMainReplyEvents: async () => 0
      } as never,
      noopRecordToolPathLedgerFromToolInvocationsService,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      createAssistantDocumentJobReadServiceMock() as never,
      {
        deliver: async () => ({ attachments: [] })
      } as never,
      createOverviewLatencyTraceServiceMock() as never,
      createAttachmentObjectAvailabilityServiceMock() as never,
      createSkillStatePersistenceServiceMock() as never,
      createNotificationDeliveryWorkerServiceMock() as never,
      createQuotaAdvisoryFollowUpServiceMock() as never
    );

    await service.execute("user-1", {
      surfaceThreadKey: "thread-1",
      message: "find my files"
    });

    assert.ok(capturedCreateMessageInput !== null, "createMessage must have been called");
    assert.deepEqual(
      (capturedCreateMessageInput as Record<string, unknown>).metadata,
      {
        discoveredFilePaths: [
          "/workspace/outbound/self/report-a.pdf",
          "/workspace/outbound/self/report-b.pdf"
        ]
      },
      "metadata.discoveredFilePaths must match the runtime return value in insertion order"
    );
  });
});
