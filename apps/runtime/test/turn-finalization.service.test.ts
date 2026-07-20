import assert from "node:assert/strict";
import type {
  RuntimeFailedEvent,
  RuntimeInterruptedEvent,
  RuntimeSessionSummary,
  RuntimeTurnResult,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import type { RuntimeSessionLease } from "../src/modules/sessions/session-lease.service";
import type { UpdateRuntimeSessionSummaryInput } from "../src/modules/sessions/session-store.service";
import type { SessionLeaseService } from "../src/modules/sessions/session-lease.service";
import type { SessionStoreService } from "../src/modules/sessions/session-store.service";
import { TurnFinalizationService } from "../src/modules/turns/turn-finalization.service";
import type { AcceptedRuntimeTurn } from "../src/modules/turns/turn-acceptance.service";
import type { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";

function createSessionSummary(): RuntimeSessionSummary {
  return {
    sessionId: "session-1",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    currentTokens: 100,
    totalTokensFresh: true,
    compactionCount: 0,
    compactionHintTokens: null,
    providerKey: null,
    modelKey: null,
    updatedAt: "2026-04-11T12:00:00.000Z"
  };
}

function createAcceptedTurn(): AcceptedRuntimeTurn {
  const lease: RuntimeSessionLease = {
    sessionId: "session-1",
    ownerToken: "lease-owner-1"
  };

  return {
    outcome: "accepted",
    conversationKey: "conversation-key-1",
    session: createSessionSummary(),
    receipt: {
      requestId: "request-1",
      sessionId: "session-1",
      publishedVersionId: "version-1",
      status: "accepted",
      bundleHash: "1111111111111111111111111111111111111111111111111111111111111111",
      resultPayload: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    },
    lease
  };
}

function createTurnResult(
  usage: RuntimeUsageSnapshot | null,
  textUsageAccounting: RuntimeTurnResult["textUsageAccounting"] = {
    schemaVersion: 2,
    totalInputTokens: 0,
    uncachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    entries: []
  }
): RuntimeTurnResult {
  return {
    requestId: "request-1",
    sessionId: "session-1",
    assistantText: "hello",
    artifacts: [],
    respondedAt: "2026-04-11T12:05:00.000Z",
    usage,
    textUsageAccounting
  };
}

function createInterruptedEvent(): RuntimeInterruptedEvent {
  return {
    type: "interrupted",
    requestId: "request-1",
    sessionId: "session-1",
    assistantText: "partial",
    respondedAt: "2026-04-11T12:06:00.000Z"
  };
}

function createFailedEvent(): RuntimeFailedEvent {
  return {
    type: "failed",
    requestId: "request-1",
    sessionId: "session-1",
    code: "runtime_timeout",
    message: "Timed out",
    willRetry: false
  };
}

class FakeRuntimeStatePostgresService {
  completedArgs: unknown[] = [];
  interruptedArgs: unknown[] = [];
  failedArgs: unknown[] = [];
  throwOnComplete = false;
  throwOnFailedPayload = false;

  async markTurnReceiptCompleted(args: unknown): Promise<void> {
    this.completedArgs.push(args);
    if (this.throwOnComplete) {
      throw new Error("complete failed");
    }
  }

  async markTurnReceiptInterrupted(args: unknown): Promise<void> {
    this.interruptedArgs.push(args);
  }

  async markTurnReceiptFailed(args: unknown): Promise<void> {
    this.failedArgs.push(args);
    if (
      this.throwOnFailedPayload &&
      args !== null &&
      typeof args === "object" &&
      "resultPayload" in args
    ) {
      throw new Error("failed payload rejected");
    }
  }
}

class FakeSessionStoreService {
  updateCalls: UpdateRuntimeSessionSummaryInput[] = [];
  throwOnUpdate = false;

  async updateSessionSummary(
    input: UpdateRuntimeSessionSummaryInput
  ): Promise<RuntimeSessionSummary> {
    this.updateCalls.push(input);
    if (this.throwOnUpdate) {
      throw new Error("session update failed");
    }

    return {
      ...createSessionSummary(),
      currentTokens: input.currentTokens ?? 100,
      totalTokensFresh: input.totalTokensFresh ?? true,
      providerKey: input.providerKey ?? null,
      modelKey: input.modelKey ?? null,
      updatedAt: "2026-04-11T12:06:00.000Z"
    };
  }
}

class FakeSessionLeaseService {
  releasedLeases: RuntimeSessionLease[] = [];

  async releaseLease(lease: RuntimeSessionLease): Promise<boolean> {
    this.releasedLeases.push(lease);
    return true;
  }
}

export async function runTurnFinalizationServiceTest(): Promise<void> {
  const postgres = new FakeRuntimeStatePostgresService();
  const sessionStore = new FakeSessionStoreService();
  const sessionLease = new FakeSessionLeaseService();
  const service = new TurnFinalizationService(
    postgres as unknown as RuntimeStatePostgresService,
    sessionStore as unknown as SessionStoreService,
    sessionLease as unknown as SessionLeaseService
  );

  const completed = await service.completeAcceptedTurn(
    createAcceptedTurn(),
    createTurnResult({
      providerKey: "openai",
      modelKey: "gpt-5.4",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30
    })
  );
  assert.equal(completed.receiptStatus, "completed");
  assert.equal(completed.session.currentTokens, 10);
  assert.equal(completed.session.providerKey, "openai");
  assert.equal(completed.leaseReleased, true);
  assert.deepEqual(sessionStore.updateCalls[0], {
    sessionId: "session-1",
    providerKey: "openai",
    modelKey: "gpt-5.4",
    currentTokens: 10,
    totalTokensFresh: true,
    lastTurnAt: new Date("2026-04-11T12:05:00.000Z")
  });

  const completedAfterToolLoop = await service.completeAcceptedTurn(
    createAcceptedTurn(),
    createTurnResult(
      {
        providerKey: "deepseek",
        modelKey: "deepseek-v4-pro",
        inputTokens: 48_000,
        outputTokens: 2_000,
        totalTokens: 50_000
      },
      {
        schemaVersion: 2,
        totalInputTokens: 60_000,
        uncachedInputTokens: 60_000,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 2_400,
        totalTokens: 62_400,
        entries: [
          {
            schemaVersion: 2,
            stepType: "main_turn",
            modelRole: "premium_reply",
            providerKey: "deepseek",
            modelKey: "deepseek-v4-pro",
            totalInputTokens: 12_000,
            uncachedInputTokens: 12_000,
            cacheWriteInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 400,
            totalTokens: 12_400
          },
          {
            schemaVersion: 2,
            stepType: "tool_loop_followup",
            modelRole: "premium_reply",
            providerKey: "deepseek",
            modelKey: "deepseek-v4-pro",
            totalInputTokens: 48_000,
            uncachedInputTokens: 48_000,
            cacheWriteInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 2_000,
            totalTokens: 50_000
          }
        ]
      }
    )
  );
  assert.equal(completedAfterToolLoop.session.currentTokens, 12_000);
  assert.deepEqual(sessionStore.updateCalls[1], {
    sessionId: "session-1",
    providerKey: "deepseek",
    modelKey: "deepseek-v4-pro",
    currentTokens: 12_000,
    totalTokensFresh: true,
    lastTurnAt: new Date("2026-04-11T12:05:00.000Z")
  });

  const interrupted = await service.interruptAcceptedTurn({
    acceptedTurn: createAcceptedTurn(),
    event: createInterruptedEvent(),
    usage: null
  });
  assert.equal(interrupted.receiptStatus, "interrupted");
  assert.equal(interrupted.session.totalTokensFresh, false);
  assert.equal(interrupted.leaseReleased, true);
  assert.deepEqual(sessionStore.updateCalls[2], {
    sessionId: "session-1",
    totalTokensFresh: false,
    lastTurnAt: new Date("2026-04-11T12:06:00.000Z")
  });

  const failed = await service.failAcceptedTurn(
    createAcceptedTurn(),
    createFailedEvent(),
    "2026-04-11T12:07:00.000Z"
  );
  assert.equal(failed.receiptStatus, "failed");
  assert.equal(failed.leaseReleased, true);
  assert.equal(sessionStore.updateCalls.length, 3);

  postgres.throwOnFailedPayload = true;
  await assert.rejects(
    () => service.failAcceptedTurn(createAcceptedTurn(), createFailedEvent()),
    /failed payload rejected/
  );
  const minimalFailed = await service.failAcceptedTurnMinimal(
    createAcceptedTurn(),
    createFailedEvent()
  );
  assert.equal(minimalFailed.receiptStatus, "failed");
  const minimalFailureArgs = postgres.failedArgs.at(-1) as {
    requestId: string;
    errorCode: string;
    errorMessage: string;
    completedAt: Date;
    resultPayload?: unknown;
  };
  assert.deepEqual(minimalFailureArgs, {
    requestId: "request-1",
    errorCode: "runtime_timeout",
    errorMessage: "Timed out",
    completedAt: minimalFailureArgs.completedAt
  });
  assert.equal("resultPayload" in minimalFailureArgs, false);
  postgres.throwOnFailedPayload = false;

  sessionStore.throwOnUpdate = true;
  await assert.rejects(
    () =>
      service.completeAcceptedTurn(
        createAcceptedTurn(),
        createTurnResult({
          providerKey: "anthropic",
          modelKey: "claude-sonnet",
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3
        })
      ),
    /session update failed/
  );
  assert.deepEqual(sessionLease.releasedLeases.at(-1), {
    sessionId: "session-1",
    ownerToken: "lease-owner-1"
  });

  sessionStore.throwOnUpdate = false;
  postgres.throwOnComplete = true;
  const releasesBeforeReceiptFailure = sessionLease.releasedLeases.length;
  await assert.rejects(
    () =>
      service.completeAcceptedTurn(
        createAcceptedTurn(),
        createTurnResult({
          providerKey: "openai",
          modelKey: "gpt-5.4",
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        })
      ),
    /complete failed/
  );
  assert.equal(sessionLease.releasedLeases.length, releasesBeforeReceiptFailure);
}
