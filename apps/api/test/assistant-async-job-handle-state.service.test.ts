import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT,
  AssistantAsyncJobHandleStateService
} from "../src/modules/workspace-management/application/assistant-async-job-handle-state.service";

type Row = {
  id: string;
  kind: "media" | "document";
  canonicalJobId: string;
  state: string;
  narrationOwner: "current_turn" | "continuation" | "legacy" | null;
  narrationDecision: string | null;
  sourceFinalizedAt: Date | null;
  continuationDepth: number;
  continuationClientTurnId: string | null;
  continuationAssistantMessageId: string | null;
  claimToken: string | null;
  dispatchReceiptRequestId: string | null;
  retryCount: number;
  maxRetries: number;
  lastErrorCode: string | null;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  channel: "web" | "telegram";
};

const owned = {
  jobRef: "jr1.media.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  assistantId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  chatId: "00000000-0000-4000-8000-000000000004",
  channel: "web" as const,
  threadKey: "thread-1"
};

function fixture(
  overrides: Partial<Row> = {},
  canonical: { status: string; lastErrorCode: string | null } = {
    status: "queued",
    lastErrorCode: null
  }
) {
  const row: Row = {
    id: "00000000-0000-4000-8000-000000000005",
    kind: "media",
    canonicalJobId: "00000000-0000-4000-8000-000000000006",
    state: "none",
    narrationOwner: null,
    narrationDecision: null,
    sourceFinalizedAt: null,
    continuationDepth: 0,
    continuationClientTurnId: null,
    continuationAssistantMessageId: null,
    claimToken: null,
    dispatchReceiptRequestId: null,
    retryCount: 0,
    maxRetries: 8,
    lastErrorCode: null,
    assistantId: owned.assistantId,
    workspaceId: owned.workspaceId,
    chatId: owned.chatId,
    channel: "web",
    ...overrides
  };
  const updates: Array<Record<string, unknown>> = [];
  const createdMessages: Array<Record<string, unknown>> = [];
  const delegate = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data);
      updates.push(data);
      return row;
    },
    updateMany: async ({
      where,
      data
    }: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (where?.narrationOwner === null && row.narrationOwner !== null) {
        return { count: 0 };
      }
      if (
        typeof where?.narrationOwner === "string" &&
        row.narrationOwner !== where.narrationOwner
      ) {
        return { count: 0 };
      }
      Object.assign(row, data);
      updates.push(data);
      return { count: 1 };
    }
  };
  const tx = {
    $queryRaw: async () => [row],
    assistantAsyncJobHandle: delegate,
    assistantChatMessage: {
      findFirst: async () => ({ id: "message-1" }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdMessages.push(data);
        return { id: "failure-message-1" };
      }
    },
    assistantMediaJob: { findUnique: async () => canonical },
    assistantDocumentRenderJob: { findUnique: async () => canonical }
  };
  Object.assign(delegate, {
    count: async () => (row.narrationOwner === "current_turn" ? 1 : 0)
  });
  const prisma = {
    $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx),
    assistantAsyncJobHandle: {
      ...delegate,
      findUnique: async () => row
    }
  };
  return {
    row,
    updates,
    createdMessages,
    service: new AssistantAsyncJobHandleStateService(prisma as never)
  };
}

describe("AssistantAsyncJobHandleStateService", () => {
  test("subscribes pending once and promotes duplicate completion to ready once", async () => {
    const subject = fixture();
    const first = await subject.service.subscribePending({
      ...owned
    });
    assert.equal(first.outcome, "subscribed");
    assert.equal(first.outcome === "subscribed" && first.duplicate, false);
    const second = await subject.service.subscribePending({
      ...owned
    });
    assert.equal(second.outcome, "subscribed");
    assert.equal(second.outcome === "subscribed" && second.duplicate, true);
    const completion = await subject.service.recordCanonicalCompletion({
      kind: "media",
      canonicalJobId: "00000000-0000-4000-8000-000000000006",
      terminalStatus: "completed",
      terminalSnapshot: { status: "completed", message: "Job completed and was delivered." }
    });
    assert.deepEqual(completion, { decision: "skip_legacy_frame", state: "ready" });
    assert.equal(subject.row.state, "ready");
    assert.equal(subject.row.narrationOwner, "continuation");
  });

  test("terminal observation atomically owns current-turn narration", async () => {
    const subject = fixture({}, { status: "failed", lastErrorCode: "provider_failed" });
    const claimed = await subject.service.observeForCurrentTurn(owned);
    assert.equal(claimed.outcome, "claimed_current_turn");
    const duplicate = await subject.service.observeForCurrentTurn(owned);
    assert.equal(duplicate.outcome, "already_owned");
    assert.equal(subject.row.state, "failed");
  });

  test("subscribed failure and cancellation both become one continuation-ready fact", async () => {
    for (const terminalStatus of ["failed", "cancelled"] as const) {
      const subject = fixture({
        state: "subscribed",
        narrationOwner: "continuation",
        narrationDecision: "notify_subscribed"
      });
      const result = await subject.service.recordCanonicalCompletion({
        kind: "media",
        canonicalJobId: "00000000-0000-4000-8000-000000000006",
        terminalStatus,
        terminalSnapshot: { status: terminalStatus, message: "Terminal." }
      });
      assert.deepEqual(result, { decision: "skip_legacy_frame", state: "ready" });
      assert.equal(subject.row.state, "ready");
    }
  });

  test("delivery arbitration defers unresolved and preserves finalized legacy", async () => {
    const unresolved = fixture();
    assert.equal(
      await unresolved.service.prepareDelivery({
        kind: "media",
        canonicalJobId: "00000000-0000-4000-8000-000000000006"
      }),
      "defer"
    );
    const legacy = fixture({
      narrationOwner: "legacy",
      narrationDecision: "legacy_completion",
      sourceFinalizedAt: new Date()
    });
    assert.equal(
      await legacy.service.prepareDelivery({
        kind: "document",
        canonicalJobId: "00000000-0000-4000-8000-000000000006"
      }),
      "legacy_frame"
    );
  });

  test("source finalization preserves owners and assigns unresolved rows to legacy", async () => {
    const unresolved = fixture();
    const result = await unresolved.service.finalizeSourceTurn({
      assistantId: owned.assistantId,
      chatId: owned.chatId,
      sourceClientTurnId: "turn-1",
      outcome: "failed"
    });
    assert.deepEqual(result, {
      finalized: 1,
      legacyChosen: 1,
      currentTurnPreserved: 0,
      currentTurnReleased: 0
    });
    assert.equal(unresolved.row.narrationOwner, "legacy");

    const subscribed = fixture({
      narrationOwner: "continuation",
      narrationDecision: "notify_subscribed",
      state: "subscribed"
    });
    await subscribed.service.finalizeSourceTurn({
      assistantId: owned.assistantId,
      chatId: owned.chatId,
      sourceClientTurnId: "turn-1",
      outcome: "failed"
    });
    assert.equal(subscribed.row.narrationOwner, "continuation");
  });

  test("finalization preserves proven current-turn output and releases failed ownership", async () => {
    const persisted = fixture({ narrationOwner: "current_turn" });
    const preserved = await persisted.service.finalizeSourceTurn({
      assistantId: owned.assistantId,
      chatId: owned.chatId,
      sourceClientTurnId: "turn-1",
      outcome: "persisted",
      assistantMessageId: "message-1"
    });
    assert.equal(preserved.currentTurnPreserved, 1);
    assert.equal(persisted.row.narrationOwner, "current_turn");

    const failed = fixture({ narrationOwner: "current_turn" });
    const released = await failed.service.finalizeSourceTurn({
      assistantId: owned.assistantId,
      chatId: owned.chatId,
      sourceClientTurnId: "turn-1",
      outcome: "stopped"
    });
    assert.equal(released.currentTurnReleased, 1);
    assert.equal(failed.row.narrationOwner, "legacy");
  });

  test("depth four rejects a fifth unattended continuation", async () => {
    const subject = fixture({ continuationDepth: 4 });
    const result = await subject.service.subscribePending({
      ...owned
    });
    assert.deepEqual(result, { outcome: "depth_exhausted" });
    assert.equal(subject.row.state, "failed");
    assert.equal(subject.row.narrationDecision, "continuation_depth_exhausted");
    assert.deepEqual(await subject.service.subscribePending(owned), {
      outcome: "depth_exhausted"
    });
  });

  test("subscribe re-reads canonical terminal truth instead of stale caller status", async () => {
    const subject = fixture({}, { status: "delivered", lastErrorCode: null });
    const result = await subject.service.subscribePending(owned);
    assert.equal(result.outcome, "terminal_inline");
    assert.equal(subject.row.narrationOwner, "current_turn");
    assert.equal(subject.row.state, "completed");
  });

  test("failClaim persists exactly one opaque failure observation", async () => {
    const subject = fixture({
      state: "claimed",
      claimToken: "claim-1",
      continuationClientTurnId: "async-cont:fail-1"
    });
    const first = await subject.service.failClaim({
      id: subject.row.id,
      claimToken: "claim-1",
      errorCode: "continuation_context_invalid",
      errorMessage: "invalid"
    });
    assert.equal(first.applied, true);
    assert.equal(first.observation?.assistantMessageId, "failure-message-1");
    assert.equal(subject.row.state, "failed");
    assert.equal(subject.row.continuationAssistantMessageId, "failure-message-1");
    assert.equal(subject.createdMessages.length, 1);
    assert.equal(subject.createdMessages[0]?.content, ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT);
    const second = await subject.service.failClaim({
      id: subject.row.id,
      claimToken: "claim-1",
      errorCode: "continuation_context_invalid",
      errorMessage: "invalid"
    });
    assert.equal(second.applied, true);
    assert.equal(second.observation?.assistantMessageId, "failure-message-1");
    assert.equal(subject.createdMessages.length, 1);
  });

  test("retry exhaustion persists opaque failure observation", async () => {
    const subject = fixture({
      state: "claimed",
      claimToken: "claim-1",
      retryCount: 7,
      maxRetries: 8,
      continuationClientTurnId: "async-cont:exhaust-1"
    });
    const result = await subject.service.requeueClaim({
      id: subject.row.id,
      claimToken: "claim-1",
      retryAt: new Date(),
      errorCode: "continuation_dispatch_failed",
      errorMessage: "boom"
    });
    assert.equal(result, "exhausted");
    assert.equal(subject.row.state, "failed");
    assert.equal(subject.row.lastErrorCode, "continuation_retry_exhausted");
    assert.equal(subject.row.continuationAssistantMessageId, "failure-message-1");
    assert.equal(subject.createdMessages[0]?.content, ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT);
  });

  test("dispatched reconciliation refuses ambiguous requeue", async () => {
    const subject = fixture({
      state: "dispatched",
      claimToken: "claim-1"
    });
    const ambiguous = await subject.service.requeueClaim({
      id: subject.row.id,
      claimToken: "claim-1",
      retryAt: new Date(),
      errorCode: "busy",
      errorMessage: "busy"
    });
    assert.equal(ambiguous, "ambiguous");
    assert.equal(subject.row.state, "dispatched");
    const proven = await subject.service.requeueClaim({
      id: subject.row.id,
      claimToken: "claim-1",
      retryAt: new Date(),
      errorCode: "busy",
      errorMessage: "busy",
      dispatchedProof: { receiptAbsent: true, leaseAbsent: true, outputAbsent: true }
    });
    assert.equal(proven, "requeued");
    assert.equal(subject.row.state, "ready");
  });

  test("typed busy rejection requeues an exact dispatched claim without fabricated proof", async () => {
    const subject = fixture({
      state: "dispatched",
      claimToken: "claim-1",
      retryCount: 0
    });
    const result = await subject.service.requeueBusyNotStarted({
      id: subject.row.id,
      claimToken: "claim-1",
      receiptRequestId: "dispatch-1",
      retryAt: new Date()
    });
    assert.equal(result, "requeued");
    assert.equal(subject.row.state, "ready");
    assert.equal(subject.row.claimToken, null);
    assert.equal(subject.row.retryCount, 0, "busy requeue must not consume retry budget");
  });

  test("repeated busy requeues never exhaust retry budget", async () => {
    const subject = fixture({
      state: "dispatched",
      claimToken: "claim-1",
      dispatchReceiptRequestId: "dispatch-1",
      retryCount: 99,
      maxRetries: 3
    });
    for (let i = 0; i < 5; i += 1) {
      subject.row.state = "dispatched";
      subject.row.claimToken = "claim-1";
      subject.row.dispatchReceiptRequestId = "dispatch-1";
      const result = await subject.service.requeueBusyNotStarted({
        id: subject.row.id,
        claimToken: "claim-1",
        receiptRequestId: "dispatch-1",
        retryAt: new Date()
      });
      assert.equal(result, "requeued");
      assert.equal(subject.row.state, "ready");
      assert.equal(subject.row.retryCount, 99);
      assert.equal(subject.row.lastErrorCode, "continuation_busy");
      assert.equal(
        subject.updates.some((update) => typeof update.retryCount === "number"),
        false
      );
      assert.equal(
        subject.updates.some((update) => update.lastErrorCode === "continuation_retry_exhausted"),
        false
      );
    }
  });

  test("only one artifact contender owns the external side-effect attempt", async () => {
    const outcomes = ["claimed", "already_attempted"];
    const service = new AssistantAsyncJobHandleStateService({
      $queryRaw: async () => [{ outcome: outcomes.shift() }]
    } as never);
    const input = {
      id: "00000000-0000-4000-8000-000000000005",
      claimToken: "claim-1",
      kind: "artifacts" as const
    };
    assert.equal(await service.claimDeliveryAttempt(input), "claimed");
    assert.equal(await service.claimDeliveryAttempt(input), "already_attempted");
  });

  test("registerSandboxJob rejects non-detached SandboxJob fail-closed", async () => {
    let sandboxWhere: Record<string, unknown> | null = null;
    const tx = {
      assistantChat: {
        findFirst: async () => ({ userId: "00000000-0000-4000-8000-000000000099" })
      },
      sandboxJob: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          sandboxWhere = where;
          // Simulate Prisma filter: only detached rows match.
          if (where.status !== "detached") return null;
          return null;
        }
      },
      assistantChatMessage: { findFirst: async () => ({ id: "message-1" }) },
      runtimeSession: { findFirst: async () => ({ id: "session-1" }) },
      assistantAsyncJobHandle: {
        findUnique: async () => null,
        create: async () => {
          throw new Error("must not create handle for non-detached job");
        }
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);

    const result = await service.registerSandboxJob({
      canonicalJobId: "00000000-0000-4000-8000-000000000010",
      assistantId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      chatId: "00000000-0000-4000-8000-000000000004",
      channel: "web",
      threadKey: "thread-1",
      sourceClientTurnId: "turn-1",
      sourceUserMessageId: "00000000-0000-4000-8000-000000000007",
      runtimeRequestId: "request-1",
      runtimeSessionId: "00000000-0000-4000-8000-000000000008",
      toolCode: "shell"
    });

    assert.equal(result.registered, false);
    assert.equal(sandboxWhere?.status, "detached");
  });

  test("listOwnedSnapshotJobRefs excludes older terminal sandbox handles without open canonical", async () => {
    const currentTurnId = "turn-current";
    const rows = [
      {
        jobRef: "jr1.sandbox.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        kind: "sandbox" as const,
        canonicalJobId: "00000000-0000-4000-8000-000000000010",
        sourceClientTurnId: currentTurnId
      },
      {
        jobRef: "jr1.sandbox.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        kind: "sandbox" as const,
        canonicalJobId: "00000000-0000-4000-8000-000000000011",
        sourceClientTurnId: "turn-older",
        state: "none"
      },
      {
        jobRef: "jr1.sandbox.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        kind: "sandbox" as const,
        canonicalJobId: "00000000-0000-4000-8000-000000000012",
        sourceClientTurnId: "turn-open",
        state: "none"
      }
    ];
    const service = new AssistantAsyncJobHandleStateService({
      assistantAsyncJobHandle: {
        findMany: async () => rows
      },
      sandboxJob: {
        findMany: async ({ where }: { where: { id: { in: string[] }; status: unknown } }) => {
          const ids = where.id.in;
          // Only the still-detached job is currently open.
          return ids
            .filter((id) => id === "00000000-0000-4000-8000-000000000012")
            .map((id) => ({ id }));
        }
      },
      assistantMediaJob: { findMany: async () => [] },
      assistantDocumentRenderJob: { findMany: async () => [] }
    } as never);

    const listed = await service.listOwnedSnapshotJobRefs({
      assistantId: owned.assistantId,
      workspaceId: owned.workspaceId,
      chatId: owned.chatId,
      channel: "web",
      threadKey: owned.threadKey,
      sourceClientTurnId: currentTurnId
    });
    assert.deepEqual(listed.jobRefs, [
      "jr1.sandbox.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "jr1.sandbox.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
    ]);
    assert.equal(listed.overflow, false);
  });

  test("listOwnedSnapshotJobRefs excludes attachment-visible completion_pending media", async () => {
    const currentTurnId = "turn-current";
    const openMediaId = "00000000-0000-4000-8000-000000000020";
    const visibleMediaId = "00000000-0000-4000-8000-000000000021";
    const completionMessageId = "00000000-0000-4000-8000-000000000030";
    const rows = [
      {
        jobRef: "jr1.media.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        kind: "media" as const,
        canonicalJobId: openMediaId,
        sourceClientTurnId: "turn-older"
      },
      {
        jobRef: "jr1.media.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        kind: "media" as const,
        canonicalJobId: visibleMediaId,
        sourceClientTurnId: "turn-older"
      }
    ];
    const service = new AssistantAsyncJobHandleStateService({
      assistantAsyncJobHandle: {
        findMany: async () => rows
      },
      sandboxJob: { findMany: async () => [] },
      assistantMediaJob: {
        findMany: async () => [
          {
            id: openMediaId,
            status: "completion_pending",
            completionAssistantMessageId: null
          },
          {
            id: visibleMediaId,
            status: "completion_pending",
            completionAssistantMessageId: completionMessageId
          }
        ]
      },
      assistantChatMessageAttachment: {
        findMany: async () => [{ messageId: completionMessageId }]
      },
      assistantDocumentRenderJob: { findMany: async () => [] }
    } as never);

    const listed = await service.listOwnedSnapshotJobRefs({
      assistantId: owned.assistantId,
      workspaceId: owned.workspaceId,
      chatId: owned.chatId,
      channel: "web",
      threadKey: owned.threadKey,
      sourceClientTurnId: currentTurnId
    });
    assert.deepEqual(listed.jobRefs, ["jr1.media.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
    assert.equal(listed.overflow, false);
  });

  test("observe finalizes already-owned sandbox handle off state=none", async () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000005",
      kind: "sandbox" as const,
      canonicalJobId: "00000000-0000-4000-8000-000000000006",
      state: "none",
      narrationOwner: "continuation" as const,
      narrationDecision: "notify_subscribed",
      sourceFinalizedAt: new Date(),
      runtimeSessionId: "00000000-0000-4000-8000-000000000008",
      continuationDepth: 0,
      continuationClientTurnId: "async-cont:1",
      claimToken: null,
      retryCount: 0,
      maxRetries: 8,
      lastErrorCode: null
    };
    const updates: Array<Record<string, unknown>> = [];
    const tx = {
      $queryRaw: async () => [row],
      assistantAsyncJobHandle: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row, data);
          updates.push(data);
          return row;
        }
      },
      sandboxJob: {
        findUnique: async () => ({
          status: "completed",
          toolCode: "shell",
          resultPayload: { exitCode: 0, stdout: "ok", stderr: "", producedFiles: [] },
          assistantId: owned.assistantId,
          workspaceId: owned.workspaceId,
          runtimeSessionId: row.runtimeSessionId
        })
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);
    const observed = await service.observeForCurrentTurn(owned);
    assert.equal(observed.outcome, "already_owned");
    assert.equal(row.state, "ready");
    assert.equal(updates.length, 1);
  });

  test("media observe treats attachment-visible completion_pending as terminal", async () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000005",
      kind: "media" as const,
      canonicalJobId: "00000000-0000-4000-8000-000000000006",
      state: "none",
      narrationOwner: null,
      narrationDecision: null,
      sourceFinalizedAt: null,
      runtimeSessionId: null,
      continuationDepth: 0,
      continuationClientTurnId: null,
      claimToken: null,
      retryCount: 0,
      maxRetries: 8,
      lastErrorCode: null
    };
    const tx = {
      $queryRaw: async () => [row],
      assistantAsyncJobHandle: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row, data);
          return row;
        }
      },
      assistantMediaJob: {
        findUnique: async () => ({
          status: "completion_pending",
          lastErrorCode: null,
          deliveredAt: null,
          completionAssistantMessageId: "00000000-0000-4000-8000-000000000099"
        })
      },
      assistantChatMessageAttachment: {
        findFirst: async () => ({ id: "att-1" })
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);
    const observed = await service.observeForCurrentTurn(owned);
    assert.equal(observed.outcome, "claimed_current_turn");
    if (observed.outcome === "claimed_current_turn") {
      assert.equal(observed.status, "completed");
    }
    assert.equal(row.state, "completed");
  });

  test("failed media with deliveredAt observes failed, not completed", async () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000005",
      kind: "media" as const,
      canonicalJobId: "00000000-0000-4000-8000-000000000006",
      state: "none",
      narrationOwner: null,
      narrationDecision: null,
      sourceFinalizedAt: null,
      runtimeSessionId: null,
      continuationDepth: 0,
      continuationClientTurnId: null,
      claimToken: null,
      retryCount: 0,
      maxRetries: 8,
      lastErrorCode: null
    };
    const tx = {
      $queryRaw: async () => [row],
      assistantAsyncJobHandle: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row, data);
          return row;
        }
      },
      assistantMediaJob: {
        findUnique: async () => ({
          status: "failed",
          lastErrorCode: "telegram_delivery_failed",
          deliveredAt: new Date("2026-07-18T12:00:00.000Z"),
          completionAssistantMessageId: "00000000-0000-4000-8000-000000000099"
        })
      },
      assistantChatMessageAttachment: {
        findFirst: async () => ({ id: "failure-notice-att" })
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);
    const observed = await service.observeForCurrentTurn(owned);
    assert.equal(observed.outcome, "claimed_current_turn");
    if (observed.outcome === "claimed_current_turn") {
      assert.equal(observed.status, "failed");
      assert.equal(observed.errorCode, "telegram_delivery_failed");
    }
    assert.equal(row.state, "failed");
  });

  test("subscribed media with attachment-visible completion_pending becomes ready", async () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000005",
      kind: "media" as const,
      canonicalJobId: "00000000-0000-4000-8000-000000000006",
      state: "subscribed",
      narrationOwner: "continuation" as const,
      narrationDecision: "notify_subscribed",
      sourceFinalizedAt: new Date(),
      runtimeSessionId: null,
      continuationDepth: 0,
      continuationClientTurnId: "async-cont:1",
      claimToken: null,
      retryCount: 0,
      maxRetries: 8,
      lastErrorCode: null
    };
    const tx = {
      $queryRaw: async () => [row],
      assistantAsyncJobHandle: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row, data);
          return row;
        }
      },
      assistantMediaJob: {
        findUnique: async () => ({
          status: "completion_pending",
          lastErrorCode: null,
          deliveredAt: null,
          completionAssistantMessageId: "00000000-0000-4000-8000-000000000099"
        })
      },
      assistantChatMessageAttachment: {
        findFirst: async () => ({ id: "att-1" })
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);
    const observed = await service.observeForCurrentTurn(owned);
    assert.equal(observed.outcome, "already_owned");
    if (observed.outcome === "already_owned") {
      assert.equal(observed.status, "completed");
    }
    assert.equal(row.state, "ready");
  });

  test("registerSandboxJob accepts detached SandboxJob", async () => {
    const tx = {
      $queryRaw: async () => [{ count: 0n }],
      assistantChat: {
        findFirst: async () => ({ userId: "00000000-0000-4000-8000-000000000099" })
      },
      sandboxJob: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          assert.equal(where.status, "detached");
          return { id: where.id, status: "detached" };
        }
      },
      assistantChatMessage: { findFirst: async () => ({ id: "message-1" }) },
      runtimeSession: { findFirst: async () => ({ id: "session-1" }) },
      assistantAsyncJobHandle: {
        findUnique: async () => null,
        create: async ({ data }: { data: { jobRef: string } }) => ({ jobRef: data.jobRef })
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);

    const result = await service.registerSandboxJob({
      canonicalJobId: "00000000-0000-4000-8000-000000000010",
      assistantId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      chatId: "00000000-0000-4000-8000-000000000004",
      channel: "web",
      threadKey: "thread-1",
      sourceClientTurnId: "turn-1",
      sourceUserMessageId: "00000000-0000-4000-8000-000000000007",
      runtimeRequestId: "request-1",
      runtimeSessionId: "00000000-0000-4000-8000-000000000008",
      toolCode: "shell"
    });

    assert.equal(result.registered, true);
    if (result.registered) {
      assert.match(result.jobRef, /^jr1\.sandbox\./);
    }
  });

  test("registerSandboxJob cap re-assert excludes self so 7 others admit the 8th", async () => {
    const canonicalJobId = "00000000-0000-4000-8000-000000000010";
    let excludedSelf = false;
    const tx = {
      $queryRaw: async (query: unknown) => {
        const sql = String((query as { strings?: readonly string[] }).strings?.join("?") ?? "");
        if (sql.includes('COUNT(*)::bigint AS "count"')) {
          const values = (query as { values?: unknown[] }).values ?? [];
          excludedSelf = values.includes(canonicalJobId);
          return [{ count: 7n }];
        }
        return [{ id: "chat-1" }];
      },
      assistantChat: {
        findFirst: async () => ({ userId: "00000000-0000-4000-8000-000000000099" })
      },
      sandboxJob: {
        findFirst: async () => ({ id: canonicalJobId, status: "detached" })
      },
      assistantChatMessage: { findFirst: async () => ({ id: "message-1" }) },
      runtimeSession: { findFirst: async () => ({ id: "session-1" }) },
      assistantAsyncJobHandle: {
        findUnique: async () => null,
        create: async ({ data }: { data: { jobRef: string } }) => ({ jobRef: data.jobRef })
      }
    };
    const service = new AssistantAsyncJobHandleStateService({
      $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)
    } as never);

    const result = await service.registerSandboxJob({
      canonicalJobId,
      assistantId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      chatId: "00000000-0000-4000-8000-000000000004",
      channel: "web",
      threadKey: "thread-1",
      sourceClientTurnId: "turn-1",
      sourceUserMessageId: "00000000-0000-4000-8000-000000000007",
      runtimeRequestId: "request-1",
      runtimeSessionId: "00000000-0000-4000-8000-000000000008",
      toolCode: "shell"
    });

    assert.equal(excludedSelf, true);
    assert.equal(result.registered, true);
  });
});
