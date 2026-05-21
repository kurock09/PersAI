import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PersaiBackgroundTaskSchedulerService } from "../src/modules/workspace-management/application/persai-background-task-scheduler.service";

class FakeSchedulerLeaseService {
  acquireResult: { token: string } | null = { token: "lease-task-1" };
  heartbeatResults: boolean[] = [];
  releaseCalls: Array<{ key: string; token: string }> = [];
  leaseState: { holderId: string; expiresAt: Date } | null = {
    holderId: "",
    expiresAt: new Date(Date.now() - 1)
  };

  async getLeaseState() {
    return this.leaseState;
  }

  async acquire() {
    return this.acquireResult;
  }

  async heartbeat() {
    return this.heartbeatResults.shift() ?? true;
  }

  async release(key: string, token: string) {
    this.releaseCalls.push({ key, token });
  }
}

class FakeBackgroundSchedulerMetricsService {
  tickAcquired: Array<{ key: string; durationMs: number; candidatesProcessed: number }> = [];
  tickSkipped: string[] = [];
  leaseLost: string[] = [];

  recordTickAcquired(key: string, durationMs: number, candidatesProcessed: number): void {
    this.tickAcquired.push({ key, durationMs, candidatesProcessed });
  }

  recordTickSkipped(key: string): void {
    this.tickSkipped.push(key);
  }

  recordLeaseLost(key: string): void {
    this.leaseLost.push(key);
  }

  recordLeaseExpiredRecovered(): void {}
}

class FakeRecordModelCostLedgerService {
  calls: Array<Record<string, unknown>> = [];
  throwError: Error | null = null;

  async recordBackgroundTaskEvaluationEvent(input: Record<string, unknown>): Promise<number> {
    this.calls.push(input);
    if (this.throwError !== null) {
      throw this.throwError;
    }
    return 1;
  }
}

function createService(
  leaseService: FakeSchedulerLeaseService,
  metricsService: FakeBackgroundSchedulerMetricsService,
  overrides?: {
    prisma?: Record<string, unknown>;
    notificationIntentService?: Record<string, unknown>;
    recordModelCostLedgerService?: FakeRecordModelCostLedgerService;
  }
): PersaiBackgroundTaskSchedulerService {
  return new PersaiBackgroundTaskSchedulerService(
    (overrides?.prisma ?? {}) as never,
    {} as never,
    {} as never,
    {} as never,
    (overrides?.notificationIntentService ?? {}) as never,
    (overrides?.recordModelCostLedgerService ?? new FakeRecordModelCostLedgerService()) as never,
    leaseService as never,
    metricsService as never
  );
}

describe("PersaiBackgroundTaskSchedulerService", () => {
  test("tick exits silently when another leader owns the lease", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    leaseService.acquireResult = null;
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const service = createService(leaseService, metricsService);

    (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
      undefined;
    (service as unknown as { processDueTasksBatch: () => Promise<number> }).processDueTasksBatch =
      async () => {
        throw new Error("tick should not process tasks when another leader holds the lease");
      };

    await (service as unknown as { tick: () => Promise<void> }).tick();

    assert.deepEqual(metricsService.tickSkipped, ["background_task"]);
    assert.equal(leaseService.releaseCalls.length, 0);
  });

  test("tick aborts further drain after lease loss", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    leaseService.acquireResult = { token: "lease-task-1" };
    leaseService.heartbeatResults = [false];
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const service = createService(leaseService, metricsService);
    let batchCalls = 0;

    (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
      undefined;
    (service as unknown as { processDueTasksBatch: () => Promise<number> }).processDueTasksBatch =
      async () => {
        batchCalls += 1;
        if (batchCalls === 1) {
          (
            service as unknown as {
              leaseLost: boolean;
            }
          ).leaseLost = true;
          metricsService.recordLeaseLost("background_task");
        }
        return 12;
      };

    await (service as unknown as { tick: () => Promise<void> }).tick();

    assert.equal(batchCalls, 1);
    assert.deepEqual(metricsService.leaseLost, ["background_task"]);
    assert.equal(metricsService.tickAcquired[0]?.candidatesProcessed, 12);
    assert.deepEqual(leaseService.releaseCalls, [
      { key: "background_task", token: "lease-task-1" }
    ]);
  });

  test("completeEvaluatedTask appends a background-task ledger event after persisting the run", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const ledgerService = new FakeRecordModelCostLedgerService();
    const updates: Array<{ target: "run" | "task"; data: Record<string, unknown> }> = [];
    let transactionCommitted = false;
    const prisma = {
      assistantBackgroundTaskRun: {
        updateMany: async (input: { data: Record<string, unknown> }) => {
          updates.push({ target: "run", data: input.data });
          return { count: 1 };
        }
      },
      assistantBackgroundTask: {
        updateMany: async (input: { data: Record<string, unknown> }) => {
          updates.push({ target: "task", data: input.data });
          return { count: 1 };
        }
      },
      $transaction: async (callback: (tx: Record<string, unknown>) => Promise<void>) => {
        await callback(prisma as never);
        transactionCommitted = true;
      }
    };
    const service = createService(leaseService, metricsService, {
      prisma,
      recordModelCostLedgerService: ledgerService
    });
    const claimedTask = {
      id: "task-1",
      runId: "task-run-1",
      runStartedAt: new Date("2026-05-20T20:05:00.000Z"),
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "Check weather",
      brief: "Push rain alert if needed.",
      scheduleJson: { kind: "daily" },
      pushPolicyJson: null,
      scheduledRunAt: new Date("2026-05-20T20:00:00.000Z"),
      runCount: 1,
      lastRunAt: null,
      lastRunStatus: null,
      externalRef: null,
      attemptCount: 1,
      claimToken: "claim-token-1",
      claimEpoch: 1
    };

    await (
      service as unknown as {
        completeEvaluatedTask: (
          task: Record<string, unknown>,
          schedule: unknown,
          outcome: {
            ok: true;
            result: {
              decision: "push" | "no_push" | "complete";
              pushText: string | null;
              rationale: string | null;
              confidence: "low" | "medium" | "high";
              toolRunText: string | null;
              artifacts: unknown[];
              usage: Record<string, unknown> | null;
            };
          }
        ) => Promise<void>;
      }
    ).completeEvaluatedTask(
      claimedTask,
      { kind: "daily" },
      {
        ok: true,
        result: {
          decision: "complete",
          pushText: null,
          rationale: "Weather condition met and task can be closed.",
          confidence: "high",
          toolRunText: "No alert needed after latest check.",
          artifacts: [],
          usage: {
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 120,
            cachedInputTokens: 20,
            outputTokens: 40,
            totalTokens: 160
          }
        }
      }
    );

    assert.equal(transactionCommitted, true);
    assert.deepEqual(
      updates.map((entry) => entry.target),
      ["run", "task"],
      "run/task persistence should complete before the ledger append"
    );
    assert.equal(ledgerService.calls.length, 1);
    assert.deepEqual(ledgerService.calls[0], {
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      occurredAt: "2026-05-20T20:05:00.000Z",
      sourceEventId: "task-run-1",
      requestCorrelationId: "task-1",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5-mini",
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 40,
        totalTokens: 160
      }
    });
  });

  test("completeEvaluatedTask does not fail when the ledger append throws", async () => {
    const leaseService = new FakeSchedulerLeaseService();
    const metricsService = new FakeBackgroundSchedulerMetricsService();
    const ledgerService = new FakeRecordModelCostLedgerService();
    ledgerService.throwError = new Error("ledger unavailable");
    let transactionCommitted = false;
    const prisma = {
      assistantBackgroundTaskRun: {
        updateMany: async () => ({ count: 1 })
      },
      assistantBackgroundTask: {
        updateMany: async () => ({ count: 1 })
      },
      $transaction: async (callback: (tx: Record<string, unknown>) => Promise<void>) => {
        await callback(prisma as never);
        transactionCommitted = true;
      }
    };
    const service = createService(leaseService, metricsService, {
      prisma,
      recordModelCostLedgerService: ledgerService
    });

    await (
      service as unknown as {
        completeEvaluatedTask: (
          task: Record<string, unknown>,
          schedule: unknown,
          outcome: {
            ok: true;
            result: {
              decision: "push" | "no_push" | "complete";
              pushText: string | null;
              rationale: string | null;
              confidence: "low" | "medium" | "high";
              toolRunText: string | null;
              artifacts: unknown[];
              usage: Record<string, unknown> | null;
            };
          }
        ) => Promise<void>;
      }
    ).completeEvaluatedTask(
      {
        id: "task-1",
        runId: "task-run-1",
        runStartedAt: new Date("2026-05-20T20:05:00.000Z"),
        assistantId: "assistant-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        title: "Check weather",
        brief: "Push rain alert if needed.",
        scheduleJson: { kind: "daily" },
        pushPolicyJson: null,
        scheduledRunAt: new Date("2026-05-20T20:00:00.000Z"),
        runCount: 1,
        lastRunAt: null,
        lastRunStatus: null,
        externalRef: null,
        attemptCount: 1,
        claimToken: "claim-token-1",
        claimEpoch: 1
      },
      { kind: "daily" },
      {
        ok: true,
        result: {
          decision: "complete",
          pushText: null,
          rationale: "No change yet.",
          confidence: "medium",
          toolRunText: "Still monitoring.",
          artifacts: [],
          usage: {
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 80,
            cachedInputTokens: 0,
            outputTokens: 20,
            totalTokens: 100
          }
        }
      }
    );

    assert.equal(transactionCommitted, true);
    assert.equal(ledgerService.calls.length, 1);
  });
});
