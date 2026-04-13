import assert from "node:assert/strict";
import { PersaiReminderSchedulerService } from "../src/modules/workspace-management/application/persai-reminder-scheduler.service";

type SchedulerRow = {
  id: string;
  assistantId: string;
  externalRef: string;
  nextRunAt: Date | null;
  reminderPayloadText: string | null;
  scheduleJson: unknown;
  controlStatus: "active" | "disabled" | "cancelled";
  retryAfterAt: Date | null;
  schedulerClaimToken: string | null;
  schedulerClaimEpoch: number | null;
  schedulerClaimedAt: Date | null;
  schedulerClaimExpiresAt: Date | null;
  createdAt: Date;
};

class FakeHandleInternalCronFireService {
  calls: unknown[] = [];
  shouldThrow = false;

  async execute(input: unknown) {
    this.calls.push(input);
    if (this.shouldThrow) {
      throw new Error("delivery failed");
    }
    return { ok: true, deliveredTo: "web" };
  }
}

class FakeBumpConfigGenerationService {
  constructor(public currentEpoch = 1) {}

  async bumpReminderSchedulerEpoch() {
    this.currentEpoch += 1;
    return this.currentEpoch;
  }

  async currentReminderSchedulerEpoch() {
    return this.currentEpoch;
  }
}

class FakeWorkspaceManagementPrismaService {
  constructor(
    public rows: SchedulerRow[],
    private readonly getCurrentEpoch: () => number
  ) {}

  assistantTaskRegistryItem = {
    updateMany: async ({
      where,
      data
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = this.rows.find(
        (entry) =>
          entry.id === where.id &&
          entry.schedulerClaimToken === where.schedulerClaimToken &&
          entry.schedulerClaimEpoch === where.schedulerClaimEpoch
      );
      if (!row) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }
  };

  async $transaction<T>(
    callback: (tx: {
      $queryRaw: (_sql: unknown) => Promise<
        Array<{
          id: string;
          assistantId: string;
          externalRef: string;
          nextRunAt: Date;
          reminderPayloadText: string;
          scheduleJson: unknown;
        }>
      >;
      assistantTaskRegistryItem: {
        update: (params: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => Promise<void>;
      };
    }) => Promise<T>
  ): Promise<T> {
    const tx = {
      $queryRaw: async () => {
        const now = Date.now();
        return this.rows
          .filter(
            (row) =>
              row.controlStatus === "active" &&
              row.nextRunAt !== null &&
              row.nextRunAt.getTime() <= now &&
              row.externalRef &&
              row.reminderPayloadText &&
              row.scheduleJson &&
              (row.retryAfterAt === null || row.retryAfterAt.getTime() <= now) &&
              (row.schedulerClaimExpiresAt === null ||
                row.schedulerClaimExpiresAt.getTime() <= now ||
                (row.schedulerClaimEpoch ?? 0) < this.getCurrentEpoch())
          )
          .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime())
          .map((row) => ({
            id: row.id,
            assistantId: row.assistantId,
            externalRef: row.externalRef,
            nextRunAt: row.nextRunAt!,
            reminderPayloadText: row.reminderPayloadText!,
            scheduleJson: row.scheduleJson
          }));
      },
      assistantTaskRegistryItem: {
        update: async ({
          where,
          data
        }: {
          where: Record<string, unknown>;
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

async function runSuccessBatchTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-1",
        assistantId: "assistant-1",
        externalRef: "job-1",
        nextRunAt: dueAt,
        reminderPayloadText: "Проверить релиз",
        scheduleJson: {
          kind: "every",
          everyMs: 60_000,
          anchorMs: dueAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const service = new PersaiReminderSchedulerService(
    prisma as never,
    handler as never,
    epochs as never
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.deepEqual(handler.calls[0], {
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary: "Проверить релиз",
    runAtMs: dueAt.getTime(),
    nextRunAtMs: dueAt.getTime() + 60_000
  });
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null);
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
  assert.equal(prisma.rows[0]?.retryAfterAt, null);
}

async function runFailureRetryTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-2",
        assistantId: "assistant-1",
        externalRef: "job-2",
        nextRunAt: dueAt,
        reminderPayloadText: "Упавший reminder",
        scheduleJson: {
          kind: "at",
          at: dueAt.toISOString()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  handler.shouldThrow = true;
  const service = new PersaiReminderSchedulerService(
    prisma as never,
    handler as never,
    epochs as never
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null);
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
  assert.ok(prisma.rows[0]?.retryAfterAt instanceof Date);
  assert.ok((prisma.rows[0]?.retryAfterAt?.getTime() ?? 0) > Date.now());
}

async function runEpochResetReclaimTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(5);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-3",
        assistantId: "assistant-1",
        externalRef: "job-3",
        nextRunAt: dueAt,
        reminderPayloadText: "Нужно переизбрать claim",
        scheduleJson: {
          kind: "every",
          everyMs: 60_000,
          anchorMs: dueAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: "stale-token",
        schedulerClaimEpoch: 4,
        schedulerClaimedAt: new Date(),
        schedulerClaimExpiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const service = new PersaiReminderSchedulerService(
    prisma as never,
    handler as never,
    epochs as never
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null);
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
}

async function runEpochBumpSkipsOldWorkerTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(7);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-4",
        assistantId: "assistant-1",
        externalRef: "job-4",
        nextRunAt: dueAt,
        reminderPayloadText: "Старый worker не должен доставить",
        scheduleJson: {
          kind: "every",
          everyMs: 60_000,
          anchorMs: dueAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const service = new PersaiReminderSchedulerService(
    prisma as never,
    handler as never,
    epochs as never
  );

  const claimed = await service.processDueJobsBatch(1);
  assert.equal(claimed, 1);

  prisma.rows[0]!.schedulerClaimToken = "epoch-stale-token";
  prisma.rows[0]!.schedulerClaimEpoch = 7;
  prisma.rows[0]!.schedulerClaimedAt = new Date();
  prisma.rows[0]!.schedulerClaimExpiresAt = new Date(Date.now() + 60_000);

  epochs.currentEpoch = 8;
  handler.calls = [];

  // Simulate a worker still holding the old epoch claim: it should not deliver again once epoch moved.
  await (
    service as unknown as { processClaimedTask: (task: unknown) => Promise<void> }
  ).processClaimedTask({
    id: "task-4",
    assistantId: "assistant-1",
    externalRef: "job-4",
    nextRunAt: dueAt,
    reminderPayloadText: "Старый worker не должен доставить",
    schedule: {
      kind: "every",
      everyMs: 60_000,
      anchorMs: dueAt.getTime()
    },
    claimToken: "epoch-stale-token",
    claimEpoch: 7
  });

  assert.equal(handler.calls.length, 0);
}

async function run(): Promise<void> {
  await runSuccessBatchTest();
  await runFailureRetryTest();
  await runEpochResetReclaimTest();
  await runEpochBumpSkipsOldWorkerTest();
}

void run();
