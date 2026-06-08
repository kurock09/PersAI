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

  runtimeSession = {
    findMany: async () => [
      {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "web" as const,
        externalThreadKey: "thread-1",
        externalUserKey: "user-1",
        runtimeTier: "paid_isolated" as const,
        lastTurnAt: new Date(Date.now() - 25 * 60 * 1000),
        memoryExtractionWatermark: 0
      }
    ]
  };

  assistantBackgroundCompactionJob = {
    findFirst: async () => this.latestIdleJob
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

async function run(): Promise<void> {
  await runEligibleIdleSessionEnqueuesJob();
  await runCompletedIdleJobBlocksRepeatWithoutNewTurn();
  await runBelowThresholdSkips();
}

void run();
