import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantAsyncJobHandleStateService } from "../src/modules/workspace-management/application/assistant-async-job-handle-state.service";

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
  claimToken: string | null;
  retryCount: number;
  maxRetries: number;
  lastErrorCode: string | null;
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
    claimToken: null,
    retryCount: 0,
    maxRetries: 8,
    lastErrorCode: null,
    ...overrides
  };
  const updates: Array<Record<string, unknown>> = [];
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
    assistantChatMessage: { findFirst: async () => ({ id: "message-1" }) },
    assistantMediaJob: { findUnique: async () => canonical },
    assistantDocumentRenderJob: { findUnique: async () => canonical }
  };
  Object.assign(delegate, {
    count: async () => (row.narrationOwner === "current_turn" ? 1 : 0)
  });
  const prisma = {
    $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx),
    assistantAsyncJobHandle: delegate
  };
  return {
    row,
    updates,
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
});
