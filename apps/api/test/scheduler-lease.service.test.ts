import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import {
  LEASE_TTL_MS,
  SCHEDULER_KEYS,
  type SchedulerKey
} from "../src/modules/workspace-management/application/scheduler-lease.constants";
import { SchedulerLeaseService } from "../src/modules/workspace-management/application/scheduler-lease.service";

type LeaseRow = {
  schedulerKey: SchedulerKey;
  holderId: string;
  leaseToken: string;
  expiresAt: Date;
  lastHeartbeat: Date;
  createdAt: Date;
  updatedAt: Date;
};

class FakeSchedulerLeasePrisma {
  readonly leases = new Map<SchedulerKey, LeaseRow>();

  constructor() {
    this.seedAllRows();
  }

  async $transaction<T>(
    callback: (tx: FakeSchedulerLeasePrisma) => Promise<T>,
    _options?: { timeout?: number }
  ): Promise<T> {
    return callback(this);
  }

  async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
    const sql = query.strings.join(" ");
    if (!sql.includes('UPDATE "scheduler_leases"') || !sql.includes("RETURNING")) {
      throw new Error(`Unsupported $queryRaw query: ${sql}`);
    }

    const [holderId, leaseToken, expiresAt, lastHeartbeat, updatedAt, schedulerKey, now] =
      query.values as [string, string, Date, Date, Date, SchedulerKey, Date];

    const row = this.leases.get(schedulerKey);
    if (!row) {
      return [] as T;
    }

    if (row.expiresAt < now || row.holderId === "") {
      row.holderId = holderId;
      row.leaseToken = leaseToken;
      row.expiresAt = expiresAt;
      row.lastHeartbeat = lastHeartbeat;
      row.updatedAt = updatedAt;
      return [{ leaseToken }] as T;
    }

    return [] as T;
  }

  async $executeRaw(query: Prisma.Sql): Promise<number> {
    const sql = query.strings.join(" ");

    if (sql.includes('INSERT INTO "scheduler_leases"')) {
      let inserted = 0;
      for (const key of SCHEDULER_KEYS) {
        if (this.leases.has(key)) {
          continue;
        }
        const now = new Date();
        this.leases.set(key, {
          schedulerKey: key,
          holderId: "",
          leaseToken: "",
          expiresAt: new Date(now.getTime() - 1),
          lastHeartbeat: now,
          createdAt: now,
          updatedAt: now
        });
        inserted += 1;
      }
      return inserted;
    }

    if (sql.includes("\"holder_id\" = ''")) {
      const [expiresAt, lastHeartbeat, updatedAt, schedulerKey, leaseToken] = query.values as [
        Date,
        Date,
        Date,
        SchedulerKey,
        string
      ];
      const row = this.leases.get(schedulerKey);
      if (!row || row.leaseToken !== leaseToken) {
        return 0;
      }
      row.holderId = "";
      row.leaseToken = "";
      row.expiresAt = expiresAt;
      row.lastHeartbeat = lastHeartbeat;
      row.updatedAt = updatedAt;
      return 1;
    }

    if (sql.includes('UPDATE "scheduler_leases"')) {
      const [expiresAt, lastHeartbeat, updatedAt, schedulerKey, leaseToken] = query.values as [
        Date,
        Date,
        Date,
        SchedulerKey,
        string
      ];
      const row = this.leases.get(schedulerKey);
      if (!row || row.leaseToken !== leaseToken) {
        return 0;
      }
      row.expiresAt = expiresAt;
      row.lastHeartbeat = lastHeartbeat;
      row.updatedAt = updatedAt;
      return 1;
    }

    throw new Error(`Unsupported $executeRaw query: ${sql}`);
  }

  private seedAllRows(): void {
    for (const key of SCHEDULER_KEYS) {
      const now = new Date();
      this.leases.set(key, {
        schedulerKey: key,
        holderId: "",
        leaseToken: "",
        expiresAt: new Date(now.getTime() - 1),
        lastHeartbeat: now,
        createdAt: now,
        updatedAt: now
      });
    }
  }
}

class TestSchedulerLeaseService extends SchedulerLeaseService {
  constructor(
    prisma: FakeSchedulerLeasePrisma,
    private readonly holderIdOverride: string
  ) {
    super(prisma as never);
  }

  protected override getSelfHolderId(): string {
    return this.holderIdOverride;
  }
}

function createService(prisma: FakeSchedulerLeasePrisma, holderId: string): SchedulerLeaseService {
  return new TestSchedulerLeaseService(prisma, holderId);
}

async function runCrashRecoveryAfterExpiryTest(): Promise<void> {
  const prisma = new FakeSchedulerLeasePrisma();
  const firstLeader = createService(prisma, "pid:101:leader-a");
  const secondLeader = createService(prisma, "pid:202:leader-b");
  const key: SchedulerKey = "background_task";

  const firstLease = await firstLeader.acquire(key);
  assert.ok(firstLease, "first leader should acquire the lease");

  const heldRow = prisma.leases.get(key);
  assert.ok(heldRow);
  heldRow.expiresAt = new Date(Date.now() + LEASE_TTL_MS);

  const beforeExpiry = await secondLeader.acquire(key);
  assert.equal(beforeExpiry, null, "second leader must not acquire before expiry");

  heldRow.expiresAt = new Date(Date.now() - 1);

  const afterExpiry = await secondLeader.acquire(key);
  assert.ok(afterExpiry, "second leader should recover the expired lease");
  assert.equal(prisma.leases.get(key)?.holderId, "pid:202:leader-b");
}

async function runHeartbeatTokenMismatchTest(): Promise<void> {
  const prisma = new FakeSchedulerLeasePrisma();
  const service = createService(prisma, "pid:101:leader-a");

  const acquired = await service.acquire("idle_reengagement");
  assert.ok(acquired);

  const updated = await service.heartbeat("idle_reengagement", "wrong-token");
  assert.equal(updated, false, "heartbeat must fail after token mismatch");
}

async function runAcquireRaceOnlyOneWinnerTest(): Promise<void> {
  const prisma = new FakeSchedulerLeasePrisma();
  const serviceA = createService(prisma, "pid:101:leader-a");
  const serviceB = createService(prisma, "pid:202:leader-b");
  const key: SchedulerKey = "background_compaction";

  const [a, b] = await Promise.all([serviceA.acquire(key), serviceB.acquire(key)]);
  const winners = [a, b].filter((value) => value !== null);

  assert.equal(winners.length, 1, "exactly one pod should win the acquire race");
}

async function runStaleReleaseNoOpAfterTakeoverTest(): Promise<void> {
  const prisma = new FakeSchedulerLeasePrisma();
  const firstLeader = createService(prisma, "pid:101:leader-a");
  const secondLeader = createService(prisma, "pid:202:leader-b");
  const key: SchedulerKey = "media_job";

  const firstLease = await firstLeader.acquire(key);
  assert.ok(firstLease);

  const row = prisma.leases.get(key);
  assert.ok(row);
  row.expiresAt = new Date(Date.now() - 1);

  const secondLease = await secondLeader.acquire(key);
  assert.ok(secondLease);

  await firstLeader.release(key, firstLease.token);

  assert.equal(
    prisma.leases.get(key)?.holderId,
    "pid:202:leader-b",
    "stale release must not clear the current leader"
  );
  assert.equal(
    prisma.leases.get(key)?.leaseToken,
    secondLease.token,
    "stale release must not clear the new leader token"
  );
}

async function runMissingLeaseRowReturnsNullUntilSeededTest(): Promise<void> {
  const prisma = new FakeSchedulerLeasePrisma();
  prisma.leases.delete("background_task");

  const service = createService(prisma, "pid:101:leader-a");
  const missingAcquire = await service.acquire("background_task");
  assert.equal(missingAcquire, null, "missing row should return null");

  await service.onModuleInit();

  const recoveredAcquire = await service.acquire("background_task");
  assert.ok(recoveredAcquire, "boot-time seed guard should recreate the lease row");
}

async function run(): Promise<void> {
  await runCrashRecoveryAfterExpiryTest();
  await runHeartbeatTokenMismatchTest();
  await runAcquireRaceOnlyOneWinnerTest();
  await runStaleReleaseNoOpAfterTakeoverTest();
  await runMissingLeaseRowReturnsNullUntilSeededTest();
  console.log("scheduler lease service tests passed (ADR-091 Session 1)");
}

void run();
