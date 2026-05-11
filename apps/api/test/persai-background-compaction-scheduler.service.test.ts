import assert from "node:assert/strict";
import { PersaiBackgroundCompactionSchedulerService } from "../src/modules/workspace-management/application/persai-background-compaction-scheduler.service";
import type { InternalRuntimeCompactAndExtractOutcome } from "../src/modules/workspace-management/application/internal-runtime-compaction.client.service";

type Row = {
  id: string;
  assistantId: string;
  workspaceId: string;
  channel: "web" | "telegram" | "max_ru";
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
  enqueuedRequestId: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  attemptCount: number;
  retryAfterAt: Date | null;
  schedulerClaimToken: string | null;
  schedulerClaimEpoch: number | null;
  schedulerClaimedAt: Date | null;
  schedulerClaimExpiresAt: Date | null;
  pendingDedupeKey: string | null;
  completedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastResultPayload: unknown;
  createdAt: Date;
};

class FakeBumpConfigGenerationService {
  constructor(public currentEpoch = 1) {}

  async bumpBackgroundCompactionSchedulerEpoch() {
    this.currentEpoch += 1;
    return this.currentEpoch;
  }

  async currentBackgroundCompactionSchedulerEpoch() {
    return this.currentEpoch;
  }
}

class FakeWorkspaceManagementPrismaService {
  public assistantBackgroundCompactionJob: {
    update: (params: { where: { id: string }; data: Record<string, unknown> }) => Promise<void>;
    updateMany: (params: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{
      count: number;
    }>;
  };

  constructor(
    public rows: Row[],
    private readonly getCurrentEpoch: () => number
  ) {
    this.assistantBackgroundCompactionJob = {
      update: async ({ where, data }) => {
        const row = this.rows.find((entry) => entry.id === where.id);
        if (!row) {
          throw new Error("row not found");
        }
        Object.assign(row, data);
      },
      updateMany: async ({ where, data }) => {
        const matches = this.rows.filter((entry) => {
          if (where.id !== undefined && entry.id !== where.id) {
            return false;
          }
          if (
            where.schedulerClaimToken !== undefined &&
            entry.schedulerClaimToken !== where.schedulerClaimToken
          ) {
            return false;
          }
          if (
            where.schedulerClaimEpoch !== undefined &&
            entry.schedulerClaimEpoch !== where.schedulerClaimEpoch
          ) {
            return false;
          }
          return true;
        });
        for (const row of matches) {
          Object.assign(row, data);
        }
        return { count: matches.length };
      }
    };
  }

  async $transaction<T>(
    callback: (tx: {
      $queryRaw: () => Promise<
        Array<{
          id: string;
          assistantId: string;
          workspaceId: string;
          channel: Row["channel"];
          externalThreadKey: string;
          externalUserKey: string | null;
          runtimeTier: Row["runtimeTier"];
          enqueuedRequestId: string | null;
          attemptCount: number;
        }>
      >;
      assistantBackgroundCompactionJob: {
        update: (params: { where: { id: string }; data: Record<string, unknown> }) => Promise<void>;
      };
    }) => Promise<T>
  ): Promise<T> {
    const tx = {
      $queryRaw: async () => {
        const now = Date.now();
        const epoch = this.getCurrentEpoch();
        return this.rows
          .filter(
            (row) =>
              (row.status === "pending" ||
                (row.status === "in_progress" &&
                  (row.schedulerClaimExpiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) <= now) ||
                (row.status === "in_progress" && (row.schedulerClaimEpoch ?? 0) < epoch)) &&
              (row.retryAfterAt === null || row.retryAfterAt.getTime() <= now) &&
              (row.status === "pending" ||
                row.schedulerClaimExpiresAt === null ||
                row.schedulerClaimExpiresAt.getTime() <= now ||
                (row.schedulerClaimEpoch ?? 0) < epoch)
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((row) => ({
            id: row.id,
            assistantId: row.assistantId,
            workspaceId: row.workspaceId,
            channel: row.channel,
            externalThreadKey: row.externalThreadKey,
            externalUserKey: row.externalUserKey,
            runtimeTier: row.runtimeTier,
            enqueuedRequestId: row.enqueuedRequestId,
            attemptCount: row.attemptCount
          }));
      },
      assistantBackgroundCompactionJob: {
        update: async ({
          where,
          data
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = this.rows.find((entry) => entry.id === where.id);
          if (!row) {
            throw new Error("row not found");
          }
          Object.assign(row, data);
        }
      }
    };
    return callback(tx);
  }
}

class FakeInternalRuntimeCompactionClientService {
  public calls: unknown[] = [];
  public outcomes: InternalRuntimeCompactAndExtractOutcome[] = [];
  public throwNext = false;

  async execute(input: unknown): Promise<InternalRuntimeCompactAndExtractOutcome> {
    this.calls.push(input);
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error("scheduler boom");
    }
    const next = this.outcomes.shift();
    if (next === undefined) {
      throw new Error("no outcome queued");
    }
    return next;
  }
}

class FakeSchedulerLeaseService {
  acquireResult: { token: string } | null = { token: "lease-compaction-1" };
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
  leaseExpiredRecovered: string[] = [];

  recordTickAcquired(key: string, durationMs: number, candidatesProcessed: number): void {
    this.tickAcquired.push({ key, durationMs, candidatesProcessed });
  }

  recordTickSkipped(key: string): void {
    this.tickSkipped.push(key);
  }

  recordLeaseLost(key: string): void {
    this.leaseLost.push(key);
  }

  recordLeaseExpiredRecovered(key: string): void {
    this.leaseExpiredRecovered.push(key);
  }
}

function createScheduler(
  prisma: FakeWorkspaceManagementPrismaService,
  epochs: FakeBumpConfigGenerationService,
  client: FakeInternalRuntimeCompactionClientService,
  overrides?: {
    schedulerLeaseService?: FakeSchedulerLeaseService;
    backgroundSchedulerMetricsService?: FakeBackgroundSchedulerMetricsService;
  }
): PersaiBackgroundCompactionSchedulerService {
  return new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never,
    (overrides?.schedulerLeaseService ?? new FakeSchedulerLeaseService()) as never,
    (overrides?.backgroundSchedulerMetricsService ??
      new FakeBackgroundSchedulerMetricsService()) as never
  );
}

function makeRow(overrides: Partial<Row> = {}): Row {
  const baseCreated = new Date(Date.now() - 60_000);
  return {
    id: overrides.id ?? "job-1",
    assistantId: overrides.assistantId ?? "assistant-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    channel: overrides.channel ?? "web",
    externalThreadKey: overrides.externalThreadKey ?? "thread-1",
    externalUserKey: overrides.externalUserKey ?? null,
    runtimeTier: overrides.runtimeTier ?? "paid_isolated",
    enqueuedRequestId: overrides.enqueuedRequestId ?? null,
    status: overrides.status ?? "pending",
    attemptCount: overrides.attemptCount ?? 0,
    retryAfterAt: overrides.retryAfterAt ?? null,
    schedulerClaimToken: overrides.schedulerClaimToken ?? null,
    schedulerClaimEpoch: overrides.schedulerClaimEpoch ?? null,
    schedulerClaimedAt: overrides.schedulerClaimedAt ?? null,
    schedulerClaimExpiresAt: overrides.schedulerClaimExpiresAt ?? null,
    pendingDedupeKey: overrides.pendingDedupeKey ?? "assistant-1:web:thread-1",
    completedAt: overrides.completedAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    lastResultPayload: overrides.lastResultPayload ?? null,
    createdAt: overrides.createdAt ?? baseCreated
  };
}

async function runSuccessClaimsAndCompletes(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: true,
    result: {
      compacted: true,
      reason: null,
      toolResult: { ok: true, value: { compacted: true } }
    } as never
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  assert.equal(client.calls.length, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "completed");
  assert.equal(row.schedulerClaimToken, null);
  assert.equal(row.schedulerClaimEpoch, null);
  assert.equal(row.retryAfterAt, null);
  assert.equal(row.lastErrorCode, null);
  assert.equal(row.attemptCount, 1);
  assert.equal(row.pendingDedupeKey, null);
  assert.ok(row.completedAt instanceof Date);
}

async function runRetryableFailureSchedulesRetry(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: false,
    retryable: true,
    status: 503,
    code: "http_503",
    message: "runtime is down"
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "pending");
  assert.equal(row.schedulerClaimToken, null);
  assert.equal(row.schedulerClaimEpoch, null);
  assert.equal(row.lastErrorCode, "http_503");
  assert.equal(row.lastErrorMessage, "runtime is down");
  assert.ok(row.retryAfterAt instanceof Date);
  assert.ok((row.retryAfterAt?.getTime() ?? 0) > Date.now());
  assert.equal(row.attemptCount, 1);
  assert.equal(row.pendingDedupeKey, "assistant-1:web:thread-1");
}

async function runNonRetryableFailureMarksFailed(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: false,
    retryable: false,
    status: 400,
    code: "invalid_payload",
    message: "no synopsis"
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "failed");
  assert.equal(row.lastErrorCode, "invalid_payload");
  assert.equal(row.retryAfterAt, null);
  assert.ok(row.completedAt instanceof Date);
}

async function runRetryableFailureExhaustionMarksFailed(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [makeRow({ attemptCount: 4 })],
    () => epochs.currentEpoch
  );
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: false,
    retryable: true,
    status: 500,
    code: "http_500",
    message: "still down"
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "failed");
  assert.equal(row.attemptCount, 5);
  assert.equal(row.retryAfterAt, null);
  assert.equal(row.lastErrorCode, "http_500");
}

async function runEpochChangedReleasesClaim(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  // Inject an outcome that should never be observed because we simulate an
  // epoch flip between claim and process.
  client.outcomes.push({
    ok: true,
    result: { compacted: false, reason: "skip", toolResult: { ok: true, value: {} } } as never
  });
  const service = createScheduler(prisma, epochs, client);

  // Patch the bump service so the second `current...` call returns a higher
  // epoch than the one used during claim.
  let calls = 0;
  const originalCurrent = epochs.currentBackgroundCompactionSchedulerEpoch.bind(epochs);
  epochs.currentBackgroundCompactionSchedulerEpoch = async () => {
    calls += 1;
    if (calls === 1) {
      return originalCurrent();
    }
    return originalCurrent().then((value) => value + 1);
  };

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  // Outcome should not have been consumed because epoch flipped before
  // executing the runtime call.
  assert.equal(client.calls.length, 0);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "pending");
  assert.equal(row.schedulerClaimToken, null);
  assert.equal(row.schedulerClaimEpoch, null);
  assert.equal(row.lastErrorCode, "epoch_changed");
  assert.equal(row.attemptCount, 0);
  assert.equal(row.pendingDedupeKey, "assistant-1:web:thread-1");
}

async function runStaleClaimReclaimedAfterTtl(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const stale = makeRow({
    schedulerClaimToken: "stale",
    schedulerClaimEpoch: 3,
    schedulerClaimedAt: new Date(Date.now() - 10 * 60_000),
    schedulerClaimExpiresAt: new Date(Date.now() - 60_000),
    attemptCount: 1
  });
  const prisma = new FakeWorkspaceManagementPrismaService([stale], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: true,
    result: {
      compacted: true,
      reason: null,
      toolResult: { ok: true, value: { compacted: true } }
    } as never
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  assert.equal(client.calls.length, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "completed");
  assert.equal(row.attemptCount, 2);
}

async function runExpiredInProgressClaimGetsReclaimed(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      makeRow({
        id: "job-expired",
        status: "in_progress",
        pendingDedupeKey: null,
        schedulerClaimToken: "stale-token",
        schedulerClaimEpoch: 3,
        schedulerClaimedAt: new Date(Date.now() - 10 * 60_000),
        schedulerClaimExpiresAt: new Date(Date.now() - 60_000),
        attemptCount: 1
      })
    ],
    () => epochs.currentEpoch
  );
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: true,
    result: {
      compacted: true,
      reason: null,
      toolResult: { ok: true, value: { compacted: true } }
    } as never
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  assert.equal(client.calls.length, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "completed");
  assert.equal(row.attemptCount, 2);
}

async function runUnexpectedThrowMarksRetryable(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  client.throwNext = true;
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "pending");
  assert.equal(row.lastErrorCode, "scheduler_internal_error");
  assert.ok(row.retryAfterAt instanceof Date);
  assert.equal(row.pendingDedupeKey, "assistant-1:web:thread-1");
}

async function runRuntimeBusyDefersAndRestoresDedupe(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push({
    ok: false,
    deferred: true,
    status: 409,
    code: "runtime_session_busy",
    message: "Background-task runtime session is busy; evaluation deferred."
  });
  const service = createScheduler(prisma, epochs, client);

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "pending");
  assert.equal(row.lastErrorCode, "runtime_session_busy");
  assert.equal(row.lastErrorMessage, "Deferred: runtime session busy.");
  assert.ok(row.retryAfterAt instanceof Date);
  assert.equal(row.attemptCount, 0);
  assert.equal(row.pendingDedupeKey, "assistant-1:web:thread-1");
}

async function runTickSkipsWhenAnotherLeaderOwnsLease(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  const leaseService = new FakeSchedulerLeaseService();
  leaseService.acquireResult = null;
  const metricsService = new FakeBackgroundSchedulerMetricsService();
  const service = createScheduler(prisma, epochs, client, {
    schedulerLeaseService: leaseService,
    backgroundSchedulerMetricsService: metricsService
  });

  (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
    undefined;
  (service as unknown as { processDueJobsBatch: () => Promise<number> }).processDueJobsBatch =
    async () => {
      throw new Error("tick should not process jobs when another leader holds the lease");
    };

  await (service as unknown as { tick: () => Promise<void> }).tick();

  assert.deepEqual(metricsService.tickSkipped, ["background_compaction"]);
  assert.equal(leaseService.releaseCalls.length, 0);
}

async function runTickAbortsDrainWhenLeaseLost(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService([makeRow()], () => epochs.currentEpoch);
  const client = new FakeInternalRuntimeCompactionClientService();
  const leaseService = new FakeSchedulerLeaseService();
  leaseService.acquireResult = { token: "lease-compaction-1" };
  leaseService.heartbeatResults = [false];
  const metricsService = new FakeBackgroundSchedulerMetricsService();
  const service = createScheduler(prisma, epochs, client, {
    schedulerLeaseService: leaseService,
    backgroundSchedulerMetricsService: metricsService
  });
  let batchCalls = 0;

  (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
    undefined;
  (service as unknown as { processDueJobsBatch: () => Promise<number> }).processDueJobsBatch =
    async () => {
      batchCalls += 1;
      if (batchCalls === 1) {
        (
          service as unknown as {
            leaseLost: boolean;
          }
        ).leaseLost = true;
        metricsService.recordLeaseLost("background_compaction");
      }
      return 8;
    };

  await (service as unknown as { tick: () => Promise<void> }).tick();

  assert.equal(batchCalls, 1);
  assert.deepEqual(metricsService.leaseLost, ["background_compaction"]);
  assert.equal(metricsService.tickAcquired[0]?.candidatesProcessed, 8);
  assert.deepEqual(leaseService.releaseCalls, [
    { key: "background_compaction", token: "lease-compaction-1" }
  ]);
}

async function runRuntimeTimeoutDefersJobAndDrainContinuesWithoutLeaseLoss(): Promise<void> {
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [makeRow({ id: "job-timeout" }), makeRow({ id: "job-success" })],
    () => epochs.currentEpoch
  );
  const client = new FakeInternalRuntimeCompactionClientService();
  client.outcomes.push(
    {
      ok: false,
      retryable: true,
      status: 408,
      code: "runtime_timeout",
      message: "provider timeout"
    },
    {
      ok: true,
      result: {
        compacted: true,
        reason: null,
        toolResult: { ok: true, value: { compacted: true } }
      } as never
    }
  );
  const leaseService = new FakeSchedulerLeaseService();
  const metricsService = new FakeBackgroundSchedulerMetricsService();
  const service = createScheduler(prisma, epochs, client, {
    schedulerLeaseService: leaseService,
    backgroundSchedulerMetricsService: metricsService
  });

  (service as unknown as { scheduleNext: (delayMs: number) => void }).scheduleNext = () =>
    undefined;

  // ADR-091 audit: explicit timeout/hang coverage should prove the timed-out
  // candidate is deferred, the next candidate still drains, and the lease stays healthy.
  await (service as unknown as { tick: () => Promise<void> }).tick();

  const timeoutRow = prisma.rows.find((row) => row.id === "job-timeout");
  const successRow = prisma.rows.find((row) => row.id === "job-success");
  assert.equal(timeoutRow?.status, "pending");
  assert.equal(timeoutRow?.lastErrorCode, "runtime_timeout");
  assert.ok(timeoutRow?.retryAfterAt instanceof Date);
  assert.equal(successRow?.status, "completed");
  assert.deepEqual(metricsService.leaseLost, []);
  assert.equal(metricsService.tickAcquired[0]?.candidatesProcessed, 2);
  assert.deepEqual(leaseService.releaseCalls, [
    { key: "background_compaction", token: "lease-compaction-1" }
  ]);
}

async function run(): Promise<void> {
  await runSuccessClaimsAndCompletes();
  await runRetryableFailureSchedulesRetry();
  await runNonRetryableFailureMarksFailed();
  await runRetryableFailureExhaustionMarksFailed();
  await runEpochChangedReleasesClaim();
  await runStaleClaimReclaimedAfterTtl();
  await runExpiredInProgressClaimGetsReclaimed();
  await runUnexpectedThrowMarksRetryable();
  await runRuntimeBusyDefersAndRestoresDedupe();
  await runTickSkipsWhenAnotherLeaderOwnsLease();
  await runTickAbortsDrainWhenLeaseLost();
  await runRuntimeTimeoutDefersJobAndDrainContinuesWithoutLeaseLoss();
}

void run();
