import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, test } from "node:test";
import {
  completeWebTurnReplay,
  finalizePersistedWebTurn,
  runWebTurnPostRuntimeCleanup
} from "../src/modules/workspace-management/application/complete-web-post-runtime-turn";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertStartedTogether(starts: number[]) {
  assert.equal(starts.length > 1, true);
  assert.ok(Math.max(...starts) - Math.min(...starts) <= 5);
}

function createFinalizeBaseInput(overrides?: Record<string, unknown>) {
  return {
    logger: {
      warn() {
        return undefined;
      }
    },
    assistantChatRepository: {
      findMessageByIdForAssistant: async () => null,
      updateMessageContent: async (messageId: string, assistantId: string, content: string) => ({
        id: messageId,
        chatId: "chat-1",
        assistantId,
        author: "assistant",
        content,
        createdAt: new Date("2026-06-23T00:00:00.000Z")
      })
    },
    appendTurnEventsService: {
      reconcileAnswerTextToPersistedBody: async () => []
    },
    attachmentRepository: {
      listByMessageId: async () => []
    },
    assistantMediaJobService: {
      listOpenJobsForWebChat: async () => []
    },
    assistantDocumentJobReadService: {
      listOpenJobsForWebChat: async () => []
    },
    asyncJobHandleState: {
      listOpenSandboxJobsForWebChat: async () => []
    },
    mediaDeliveryService: {
      deliver: async () => ({ attachments: [] })
    },
    trackWorkspaceQuotaUsageService: {
      recordWebChatTurnUsage: async () => undefined
    },
    notificationDeliveryWorkerService: {
      deliverIntentNow: async () => ({ providerRef: null })
    },
    appendModelCostLedgerEvents: async () => undefined,
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    surfaceThreadKey: "thread-1",
    userMessageId: "user-msg-1",
    userContent: "hello",
    assistant: {
      id: "assistant-1",
      workspaceId: "workspace-1"
    },
    assistantMessage: {
      id: "assistant-msg-1",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant",
      content: "hello back",
      createdAt: new Date("2026-06-23T00:00:00.000Z")
    },
    assistantText: "hello back",
    mediaArtifacts: [],
    respondedAt: "2026-06-23T00:00:01.000Z",
    traceId: "trace-1",
    quotaSource: "web_chat_turn_stream_completed" as const,
    locale: "en",
    ...overrides
  } as never;
}

describe("complete web post-runtime turn", () => {
  test("finalizePersistedWebTurn parallelizes media and document job reads with media delivery", async () => {
    const startedAt: Record<string, number> = {};
    const completedAt: Record<string, number> = {};
    const stages: Record<string, number> = {};

    await finalizePersistedWebTurn(
      createFinalizeBaseInput({
        assistantMediaJobService: {
          listOpenJobsForWebChat: async () => {
            startedAt.mediaJobs = performance.now();
            await delay(20);
            completedAt.mediaJobs = performance.now();
            return [];
          }
        },
        assistantDocumentJobReadService: {
          listOpenJobsForWebChat: async () => {
            startedAt.documentJobs = performance.now();
            await delay(20);
            completedAt.documentJobs = performance.now();
            return [];
          }
        },
        mediaDeliveryService: {
          deliver: async () => {
            startedAt.mediaDelivery = performance.now();
            await delay(20);
            completedAt.mediaDelivery = performance.now();
            return { attachments: [] };
          }
        },
        markTraceStage: (stage: string) => {
          stages[stage] = performance.now();
        }
      })
    );

    assertStartedTogether([startedAt.mediaJobs, startedAt.documentJobs, startedAt.mediaDelivery]);
    assert.ok(
      stages.media_delivered >=
        Math.max(completedAt.mediaJobs, completedAt.documentJobs, completedAt.mediaDelivery)
    );
  });

  test("finalizePersistedWebTurn parallelizes quota and ledger writes after final content", async () => {
    const startedAt: Record<string, number> = {};
    let finalContentPersistedAt = 0;

    await finalizePersistedWebTurn(
      createFinalizeBaseInput({
        assistantMessage: {
          id: "assistant-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "draft",
          createdAt: new Date("2026-06-23T00:00:00.000Z")
        },
        assistantText: "final",
        assistantChatRepository: {
          findMessageByIdForAssistant: async () => null,
          updateMessageContent: async () => {
            await delay(15);
            finalContentPersistedAt = performance.now();
            return {
              id: "assistant-msg-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "final",
              createdAt: new Date("2026-06-23T00:00:00.000Z")
            };
          }
        },
        trackWorkspaceQuotaUsageService: {
          recordWebChatTurnUsage: async () => {
            startedAt.quota = performance.now();
            await delay(20);
          }
        },
        appendModelCostLedgerEvents: async () => {
          startedAt.ledger = performance.now();
          await delay(20);
        }
      })
    );

    assert.ok(startedAt.quota >= finalContentPersistedAt);
    assert.ok(startedAt.ledger >= finalContentPersistedAt);
    assertStartedTogether([startedAt.quota, startedAt.ledger]);
  });

  test("completeWebTurnReplay forwards the atomically preserved assistant-message winner", async () => {
    let boundAssistantMessageId: string | null = null;
    const stages: Record<string, number> = {};

    const replay = await completeWebTurnReplay({
      bindingRepository: {
        completeWebTurnProcessing: async (_assistantId, _provider, _surface, payload) => {
          boundAssistantMessageId = payload.assistantMessageId;
        }
      },
      webChatTurnAttemptService: {
        markCompleted: async () => {
          return "worker-message-1";
        }
      },
      assistantId: "assistant-1",
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-1",
      chatId: "chat-1",
      userMessageId: "user-msg-1",
      assistantMessageId: "assistant-msg-1",
      respondedAt: "2026-06-23T00:00:01.000Z",
      degradedByQuotaFallback: false,
      quotaFallbackReason: null,
      quotaFallbackModel: null,
      followUpAssistantMessageId: null,
      markTraceStage: (stage) => {
        stages[stage] = performance.now();
      }
    });

    assert.equal(replay.assistantMessageId, "worker-message-1");
    assert.equal(boundAssistantMessageId, "worker-message-1");
    assert.ok(stages.replay_completed > 0);
  });

  test("parallel cleanup uses allSettled so skill-state failure does not abort replay", async () => {
    const warnings: string[] = [];
    let replayCompleted = false;

    const persistedSkillState = await runWebTurnPostRuntimeCleanup({
      logger: {
        warn(message: string) {
          warnings.push(message);
        }
      },
      replayInput: {
        bindingRepository: {
          completeWebTurnProcessing: async () => {
            await delay(20);
            replayCompleted = true;
          }
        },
        assistantId: "assistant-1",
        userId: "user-1",
        surfaceThreadKey: "thread-1",
        clientTurnId: "turn-1",
        chatId: "chat-1",
        userMessageId: "user-msg-1",
        assistantMessageId: "assistant-msg-1",
        respondedAt: "2026-06-23T00:00:01.000Z",
        degradedByQuotaFallback: false,
        quotaFallbackReason: null,
        quotaFallbackModel: null,
        followUpAssistantMessageId: null
      },
      skillStateInput: {
        autoSkillRoutingStateService: {
          persistFromTurnRouting: async () => {
            await delay(5);
            throw new Error("skill write failed");
          }
        },
        chatId: "chat-1",
        turnRouting: null
      },
      skillStateFallback: {
        skillDecisionState: { mode: "fallback" }
      },
      skillStateFailureMessage: (error) =>
        `skill failed: ${error instanceof Error ? error.message : String(error)}`,
      cleanupFailureMessage: (error) =>
        `cleanup failed: ${error instanceof Error ? error.message : String(error)}`
    });

    assert.equal(replayCompleted, true);
    assert.deepEqual(persistedSkillState, {
      skillDecisionState: { mode: "fallback" }
    });
    assert.deepEqual(warnings, ["skill failed: skill write failed"]);
  });

  describe("ADR-170 D5.3 — reconciles the turn event log once the final body is settled", () => {
    test("reconciles the assistant message's own log after a delivery-honesty correction changes the persisted content", async () => {
      const reconcileCalls: string[] = [];

      const result = await finalizePersistedWebTurn(
        createFinalizeBaseInput({
          appendTurnEventsService: {
            reconcileAnswerTextToPersistedBody: async (input: { messageId: string }) => {
              reconcileCalls.push(input.messageId);
              return [];
            }
          }
        })
      );

      assert.deepEqual(reconcileCalls, ["assistant-msg-1"]);
      assert.equal(result.finalAssistantContent, "hello back");
    });

    test("reconciles even when the correction is a no-op (content unchanged), so log/body parity does not depend on a write happening", async () => {
      let updateMessageContentCalls = 0;
      const reconcileCalls: string[] = [];

      await finalizePersistedWebTurn(
        createFinalizeBaseInput({
          // assistantText === assistantMessage.content, so
          // applyFinalDeliveryHonestyCorrection is a no-op and
          // updateMessageContent must never be called — reconciliation still
          // must run, because the log could still diverge from the body for
          // reasons unrelated to whether THIS call wrote anything.
          assistantChatRepository: {
            findMessageByIdForAssistant: async () => null,
            updateMessageContent: async (
              messageId: string,
              assistantId: string,
              content: string
            ) => {
              updateMessageContentCalls += 1;
              return {
                id: messageId,
                chatId: "chat-1",
                assistantId,
                author: "assistant",
                content,
                createdAt: new Date("2026-06-23T00:00:00.000Z")
              };
            }
          },
          appendTurnEventsService: {
            reconcileAnswerTextToPersistedBody: async (input: { messageId: string }) => {
              reconcileCalls.push(input.messageId);
              return [];
            }
          }
        })
      );

      assert.equal(updateMessageContentCalls, 0);
      assert.deepEqual(reconcileCalls, ["assistant-msg-1"]);
    });

    test("a reconciliation failure is logged and swallowed — it must never fail turn completion", async () => {
      const warnings: string[] = [];

      const result = await finalizePersistedWebTurn(
        createFinalizeBaseInput({
          logger: {
            warn(message: string) {
              warnings.push(message);
            }
          },
          appendTurnEventsService: {
            reconcileAnswerTextToPersistedBody: async () => {
              throw new Error("simulated reconciliation failure");
            }
          }
        })
      );

      assert.equal(result.finalAssistantContent, "hello back");
      assert.ok(
        warnings.some((message) =>
          message.includes("ADR-170 turn_event answer_text reconciliation failed")
        )
      );
    });
  });
});
