import assert from "node:assert/strict";
import { MaterializationRolloutService } from "../src/modules/workspace-management/application/materialization-rollout.service";

class FakePrisma {
  readonly assistants = [
    { id: "assistant-1", userId: "user-1", workspaceId: "ws-1", createdAt: new Date("2026-05-01") },
    { id: "assistant-2", userId: "user-2", workspaceId: "ws-1", createdAt: new Date("2026-05-02") },
    { id: "assistant-3", userId: "user-3", workspaceId: "ws-1", createdAt: new Date("2026-05-03") }
  ];
  readonly rollouts: Array<Record<string, unknown>> = [];
  readonly items: Array<Record<string, unknown>> = [];
  readonly auditEvents: Array<Record<string, unknown>> = [];
  private rolloutCounter = 0;

  assistant = {
    findMany: async () => this.assistants
  };

  materializationRollout = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `rollout-${++this.rolloutCounter}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        ...data
      };
      this.rollouts.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rollouts.find((entry) => entry.id === where.id);
      if (!row) throw new Error("rollout missing");
      Object.assign(row, data);
      return row;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = this.rollouts.find((entry) => entry.id === where.id);
      if (!row) throw new Error("rollout missing");
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.rollouts.find((entry) => entry.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) =>
      this.rollouts.find(
        (entry) => entry.id === where.id && entry.workspaceId === where.workspaceId
      ) ?? null,
    findMany: async () => [...this.rollouts].reverse()
  };

  materializationRolloutItem = {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      this.items.push(
        ...data.map((row, index) => ({
          id: `item-${this.items.length + index + 1}`,
          attempts: 0,
          nextRetryAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          startedAt: null,
          finishedAt: null,
          claimedAt: null,
          materializedSpecId: null,
          materializedContentHash: null,
          runtimeBundleHash: null,
          createdAt: new Date("2026-05-14T07:00:00.000Z"),
          updatedAt: new Date("2026-05-14T07:00:00.000Z"),
          ...row
        }))
      );
      return { count: data.length };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      this.items.filter((item) => {
        if (where.rolloutId !== undefined && item.rolloutId !== where.rolloutId) return false;
        if (where.workspaceId !== undefined && item.workspaceId !== where.workspaceId) return false;
        if (where.status !== undefined && item.status !== where.status) return false;
        return true;
      }),
    updateMany: async ({
      where,
      data
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const item of this.items) {
        const matches =
          (where.rolloutId === undefined || item.rolloutId === where.rolloutId) &&
          (where.workspaceId === undefined || item.workspaceId === where.workspaceId) &&
          (where.status === undefined || item.status === where.status);
        if (matches) {
          Object.assign(item, data, { updatedAt: new Date("2026-05-14T07:10:00.000Z") });
          count += 1;
        }
      }
      return { count };
    },
    groupBy: async ({ where }: { where: { rolloutId: string } }) => {
      const counts = new Map<string, number>();
      for (const item of this.items.filter((entry) => entry.rolloutId === where.rolloutId)) {
        counts.set(String(item.status), (counts.get(String(item.status)) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([status, count]) => ({
        status,
        _count: { _all: count }
      }));
    }
  };

  $transaction = async <T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> => callback(this);
}

function createService() {
  const prisma = new FakePrisma();
  const authorization = {
    assertCanPerformDangerousAdminAction: async () => ({
      workspaceId: "ws-1"
    }),
    assertCanReadAdminSurface: async () => ({
      workspaceId: "ws-1"
    })
  };
  const audit = {
    execute: async (input: Record<string, unknown>) => {
      prisma.auditEvents.push(input);
    }
  };
  const generation = {
    execute: async () => 42
  };
  const publishedVersions = {
    findLatestByAssistantId: async (assistantId: string) =>
      assistantId === "assistant-3" ? null : { id: `pub-${assistantId}` }
  };

  return {
    prisma,
    service: new MaterializationRolloutService(
      prisma as never,
      authorization as never,
      audit as never,
      generation as never,
      publishedVersions as never
    )
  };
}

async function run(): Promise<void> {
  {
    const { prisma, service } = createService();
    const summary = await service.createManualReapplyRollout("admin-1", "stepup");

    assert.equal(summary.id, "rollout-1");
    assert.equal(summary.targetGeneration, 42);
    assert.equal(summary.totalItems, 2);
    assert.equal(summary.pendingCount, 2);
    assert.equal(summary.status, "pending");
    assert.equal(prisma.items.length, 2, "only assistants with a published version are queued");
    assert.equal(prisma.auditEvents.length, 1, "audit event recorded");
    console.log("✓ manual reapply rollout queues published assistants only");
  }

  {
    const { service } = createService();
    const first = await service.createManualReapplyRollout("admin-1", "stepup");
    const listed = await service.listRollouts("admin-1");

    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, first.id);
    console.log("✓ materialization rollouts list returns recent rollouts");
  }

  {
    const { prisma, service } = createService();
    await service.createManualReapplyRollout("admin-1", "stepup");
    prisma.items[0] = {
      ...prisma.items[0],
      status: "failed",
      lastErrorCode: "apply_exception",
      lastErrorMessage: "Apply failed."
    };
    prisma.items[1] = {
      ...prisma.items[1],
      status: "pending"
    };

    const failed = await service.listFailedItems("admin-1", "rollout-1");
    assert.equal(failed.items.length, 1);
    assert.equal(failed.items[0]?.lastErrorCode, "apply_exception");

    const retried = await service.retryFailedItems("admin-1", "rollout-1", "stepup");
    assert.equal(retried.retriedCount, 1);
    assert.equal(prisma.items[0]?.status, "pending");
    assert.equal(
      prisma.auditEvents.some(
        (event) => event.eventCode === "admin.materialization_rollout_retry_failed"
      ),
      true
    );

    const cancelled = await service.cancelPendingItems("admin-1", "rollout-1", "stepup");
    assert.equal(cancelled.cancelledCount, 2);
    assert.equal(prisma.rollouts[0]?.cancelledCount, 2);
    assert.equal(
      prisma.auditEvents.some(
        (event) => event.eventCode === "admin.materialization_rollout_cancel_pending"
      ),
      true
    );
    console.log("✓ rollout service exposes failed items and retry/cancel controls");
  }
}

void run();
