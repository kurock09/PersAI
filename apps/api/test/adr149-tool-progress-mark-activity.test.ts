import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StreamWebChatTurnService } from "../src/modules/workspace-management/application/stream-web-chat-turn.service";

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

describe("ADR-149 tool_progress touchRunningAttempt", () => {
  test("tool_progress SSE chunk heartbeats the running attempt without rewriting activity", async () => {
    const touchRunningAttemptCalls: Array<Record<string, unknown>> = [];
    const webChatTurnAttemptService = {
      async markCurrentActivity() {
        throw new Error("tool_progress must not clobber currentActivity via markCurrentActivity");
      },
      async touchRunningAttempt(input: Record<string, unknown>) {
        touchRunningAttemptCalls.push(input);
      },
      async markCompleted() {
        return undefined;
      },
      async markInterrupted() {
        return undefined;
      },
      async markFailed() {
        return undefined;
      }
    };

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
            type: "tool_progress",
            toolName: "shell",
            toolCallId: "tool-shell-1",
            toolProgressKind: "stdout_line",
            toolProgressLine: "still running",
            toolProgressSeq: 1
          };
          yield {
            type: "done",
            respondedAt: "2026-04-05T12:00:01.000Z",
            finalAnswer: "Done.",
            turnRouting: {
              mode: "shadow",
              executionMode: "premium",
              source: "llm"
            }
          };
        }
      } as never,
      {} as never,
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
      {
        recordWebStreamTurn() {
          return undefined;
        },
        recordWebStreamStage() {
          return undefined;
        }
      } as never,
      {
        assertRuntimeReadable: async () => undefined
      } as never,
      {
        buildRuntimeContext: () => ({ decision: null }),
        persistFromTurnRouting: async () => ({ skillDecisionState: null })
      } as never,
      {
        attachAcknowledgementMessageId: async () => 0,
        listOpenJobsForChatContext: async () => [],
        listOpenJobsForWebChat: async () => []
      } as never,
      {
        listOpenJobsForWebChat: async () => [],
        listOpenJobsForRuntimeContext: async () => [],
        listJobDeliveryUpdatesForRuntimeContext: async () => []
      } as never,
      {
        deliverIntentNow: async () => ({ providerRef: null })
      } as never,
      {
        findMostRecentPendingLoginForChat: async () => null
      } as never,
      undefined,
      webChatTurnAttemptService as never
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
          content: "run shell",
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
        clientTurnId: "turn-shell-progress-1"
      } as never,
      {
        isClientAborted: () => false,
        onDelta: () => undefined,
        onThinking: () => undefined,
        onDone: () => undefined
      }
    );

    assert.equal(outcome.status, "completed");
    assert.equal(touchRunningAttemptCalls.length, 1);
    assert.deepEqual(touchRunningAttemptCalls[0], {
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-shell-progress-1"
    });
  });
});
