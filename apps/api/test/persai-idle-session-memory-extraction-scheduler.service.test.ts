import assert from "node:assert/strict";
import { PersaiIdleSessionMemoryExtractionSchedulerService } from "../src/modules/workspace-management/application/persai-idle-session-memory-extraction-scheduler.service";

class FakeSchedulerLeaseService {
  acquireResult: { token: string } | null = { token: "lease-idle-memory-1" };
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

class FakeEnqueueBackgroundCompactionJobService {
  calls: Array<Record<string, unknown>> = [];

  async execute(input: Record<string, unknown>) {
    this.calls.push(input);
    return { enqueued: true, jobId: `job-${String(this.calls.length)}`, superseded: false };
  }
}

class FakeIdleSessionPrisma {
  hydratableMessageCount = 12;
  latestIdleJob: {
    status: "pending" | "in_progress" | "completed" | "failed";
    createdAt: Date;
  } | null = null;
  latestIdleJobsByThread = new Map<
    string,
    {
      status: "pending" | "in_progress" | "completed" | "failed";
      createdAt: Date;
    } | null
  >();
  runtimeSessions = [
    {
      id: "session-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web" as const,
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      runtimeTier: "paid_isolated" as const,
      lastTurnAt: new Date(Date.now() - 25 * 60 * 1000),
      memoryExtractionWatermark: 0
    }
  ];

  runtimeSession = {
    findMany: async (args?: { take?: number; cursor?: { id: string }; skip?: number }) => {
      const take = args?.take ?? this.runtimeSessions.length;
      const cursorIndex =
        args?.cursor === undefined
          ? -1
          : this.runtimeSessions.findIndex((session) => session.id === args.cursor?.id);
      const start = Math.max(0, cursorIndex + (args?.skip ?? 0));
      return this.runtimeSessions.slice(start, start + take);
    }
  };

  assistantBackgroundCompactionJob = {
    findFirst: async (args?: { where?: { externalThreadKey?: string } }) =>
      args?.where?.externalThreadKey !== undefined &&
      this.latestIdleJobsByThread.has(args.where.externalThreadKey)
        ? (this.latestIdleJobsByThread.get(args.where.externalThreadKey) ?? null)
        : this.latestIdleJob
  };

  assistantChat = {
    findUnique: async () => ({
      id: "chat-1",
      archivedAt: null
    })
  };

  async $queryRaw() {
    return [{ count: this.hydratableMessageCount }];
  }
}

function createScheduler(
  prisma: FakeIdleSessionPrisma,
  enqueueService?: FakeEnqueueBackgroundCompactionJobService
): {
  scheduler: PersaiIdleSessionMemoryExtractionSchedulerService;
  enqueue: FakeEnqueueBackgroundCompactionJobService;
} {
  const enqueue = enqueueService ?? new FakeEnqueueBackgroundCompactionJobService();
  return {
    enqueue,
    scheduler: new PersaiIdleSessionMemoryExtractionSchedulerService(
      prisma as never,
      enqueue as never,
      new FakeSchedulerLeaseService() as never,
      new FakeBackgroundSchedulerMetricsService() as never
    )
  };
}

async function runEligibleIdleSessionEnqueuesJob(): Promise<void> {
  const prisma = new FakeIdleSessionPrisma();
  const { scheduler, enqueue } = createScheduler(prisma);

  const processed = await scheduler.processDueIdleExtractionBatch(1);

  assert.equal(processed, 1);
  assert.equal(enqueue.calls.length, 1);
  assert.deepEqual(enqueue.calls[0], {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    channel: "web",
    externalThreadKey: "thread-1",
    externalUserKey: "user-1",
    runtimeTier: "paid_isolated",
    trigger: "idle_extract",
    enqueuedRequestId: null
  });
}

async function runCompletedIdleJobBlocksRepeatWithoutNewTurn(): Promise<void> {
  const prisma = new FakeIdleSessionPrisma();
  prisma.latestIdleJob = {
    status: "completed",
    createdAt: new Date()
  };
  const { scheduler, enqueue } = createScheduler(prisma);

  const processed = await scheduler.processDueIdleExtractionBatch(1);

  assert.equal(processed, 0);
  assert.equal(enqueue.calls.length, 0);
}

async function runBelowThresholdSkips(): Promise<void> {
  const prisma = new FakeIdleSessionPrisma();
  prisma.hydratableMessageCount = 9;
  const { scheduler, enqueue } = createScheduler(prisma);

  const processed = await scheduler.processDueIdleExtractionBatch(1);

  assert.equal(processed, 0);
  assert.equal(enqueue.calls.length, 0);
}

async function runScansPastSkippedFirstPage(): Promise<void> {
  const prisma = new FakeIdleSessionPrisma();
  const completedAfterTurn = { status: "completed" as const, createdAt: new Date() };
  prisma.runtimeSessions = [
    {
      id: "skipped-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "skipped-1",
      externalUserKey: "user-1",
      runtimeTier: "paid_isolated",
      lastTurnAt: new Date(Date.now() - 60 * 60 * 1000),
      memoryExtractionWatermark: 0
    },
    {
      id: "skipped-2",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "skipped-2",
      externalUserKey: "user-1",
      runtimeTier: "paid_isolated",
      lastTurnAt: new Date(Date.now() - 55 * 60 * 1000),
      memoryExtractionWatermark: 0
    },
    {
      id: "skipped-3",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "skipped-3",
      externalUserKey: "user-1",
      runtimeTier: "paid_isolated",
      lastTurnAt: new Date(Date.now() - 50 * 60 * 1000),
      memoryExtractionWatermark: 0
    },
    {
      id: "skipped-4",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "skipped-4",
      externalUserKey: "user-1",
      runtimeTier: "paid_isolated",
      lastTurnAt: new Date(Date.now() - 45 * 60 * 1000),
      memoryExtractionWatermark: 0
    },
    {
      id: "eligible-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "eligible-1",
      externalUserKey: "user-1",
      runtimeTier: "paid_isolated",
      lastTurnAt: new Date(Date.now() - 40 * 60 * 1000),
      memoryExtractionWatermark: 0
    }
  ];
  for (const session of prisma.runtimeSessions.slice(0, 4)) {
    prisma.latestIdleJobsByThread.set(session.externalThreadKey, completedAfterTurn);
  }
  prisma.latestIdleJobsByThread.set("eligible-1", null);
  const { scheduler, enqueue } = createScheduler(prisma);

  const processed = await scheduler.processDueIdleExtractionBatch(1);

  assert.equal(processed, 1);
  assert.equal(enqueue.calls.length, 1);
  assert.equal(enqueue.calls[0]?.externalThreadKey, "eligible-1");
}

async function run(): Promise<void> {
  await runEligibleIdleSessionEnqueuesJob();
  await runCompletedIdleJobBlocksRepeatWithoutNewTurn();
  await runBelowThresholdSkips();
  await runScansPastSkippedFirstPage();
}

void run();
