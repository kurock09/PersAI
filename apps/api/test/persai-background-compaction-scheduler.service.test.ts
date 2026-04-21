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
              row.status === "pending" &&
              (row.retryAfterAt === null || row.retryAfterAt.getTime() <= now) &&
              (row.schedulerClaimExpiresAt === null ||
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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

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
  const service = new PersaiBackgroundCompactionSchedulerService(
    prisma as never,
    epochs as never,
    client as never
  );

  const processed = await service.processDueJobsBatch();

  assert.equal(processed, 1);
  const row = prisma.rows[0]!;
  assert.equal(row.status, "pending");
  assert.equal(row.lastErrorCode, "scheduler_internal_error");
  assert.ok(row.retryAfterAt instanceof Date);
}

async function run(): Promise<void> {
  await runSuccessClaimsAndCompletes();
  await runRetryableFailureSchedulesRetry();
  await runNonRetryableFailureMarksFailed();
  await runRetryableFailureExhaustionMarksFailed();
  await runEpochChangedReleasesClaim();
  await runStaleClaimReclaimedAfterTtl();
  await runUnexpectedThrowMarksRetryable();
}

void run();
