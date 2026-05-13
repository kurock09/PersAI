import assert from "node:assert/strict";
import { MaterializationRolloutWorkerService } from "../src/modules/workspace-management/application/materialization-rollout-worker.service";

class FakePrisma {
  readonly rollouts = [
    {
      id: "rollout-1",
      workspaceId: "ws-1",
      status: "pending",
      pendingCount: 1,
      runningCount: 0,
      succeededCount: 0,
      degradedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      cancelledCount: 0
    }
  ];
  readonly items = [
    {
      id: "item-1",
      rolloutId: "rollout-1",
      assistantId: "assistant-1",
      workspaceId: "ws-1",
      userId: "user-1",
      targetGeneration: 42,
      priority: 100,
      status: "pending",
      attempts: 0,
      nextRetryAt: null,
      startedAt: null,
      finishedAt: null,
      claimedAt: null
    }
  ];
  readonly audits: Array<Record<string, unknown>> = [];
  readonly assistantState = {
    applyStatus: "succeeded",
    applyErrorCode: null,
    applyErrorMessage: null
  };

  materializationRolloutItem = {
    findMany: async () =>
      this.items
        .filter((item) => item.status === "pending")
        .map((item) => ({
          id: item.id,
          rolloutId: item.rolloutId,
          assistantId: item.assistantId,
          workspaceId: item.workspaceId,
          userId: item.userId,
          targetGeneration: item.targetGeneration
        })),
    updateMany: async ({
      where,
      data
    }: {
      where: { id: { in: string[] } };
      data: Record<string, unknown>;
    }) => {
      for (const item of this.items) {
        if (where.id.in.includes(item.id)) {
          Object.assign(item, {
            ...data,
            attempts: item.attempts + 1
          });
        }
      }
      return { count: where.id.in.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const item = this.items.find((entry) => entry.id === where.id);
      if (!item) throw new Error("item missing");
      Object.assign(item, data);
      return item;
    },
    groupBy: async () => {
      const counts = new Map<string, number>();
      for (const item of this.items) {
        counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([status, count]) => ({
        status,
        _count: { _all: count }
      }));
    }
  };

  materializationRollout = {
    updateMany: async ({
      where,
      data
    }: {
      where: { id: { in: string[] } };
      data: Record<string, unknown>;
    }) => {
      for (const rollout of this.rollouts) {
        if (where.id.in.includes(rollout.id)) {
          Object.assign(rollout, data);
        }
      }
      return { count: where.id.in.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const rollout = this.rollouts.find((entry) => entry.id === where.id);
      if (!rollout) throw new Error("rollout missing");
      Object.assign(rollout, data);
      return rollout;
    },
    groupBy: async () => {
      const counts = new Map<string, number>();
      for (const item of this.items) {
        counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([status, count]) => ({
        status,
        _count: { _all: count }
      }));
    }
  };

  assistant = {
    findUnique: async () => ({
      id: "assistant-1",
      workspaceId: "ws-1",
      userId: "user-1"
    })
  };

  assistantStateRow = {
    applyStatus: "succeeded",
    applyErrorCode: null,
    applyErrorMessage: null
  };

  $transaction = async <T>(callback: (tx: FakePrisma) => Promise<T>): Promise<T> => callback(this);
}

function makeService(opts?: {
  latestSpec?: {
    id: string;
    publishedVersionId: string;
    materializedAtConfigGeneration: number;
    contentHash: string;
    runtimeBundleHash: string | null;
  } | null;
  refreshedSpec?: {
    id: string;
    contentHash: string;
    runtimeBundleHash: string | null;
  } | null;
  applyStatus?: "succeeded" | "degraded" | "failed";
}) {
  const prisma = new FakePrisma();
  const applyCalls: Array<Record<string, unknown>> = [];
  prisma.assistantState.applyStatus = opts?.applyStatus ?? "succeeded";
  prisma.assistantStateRow.applyStatus = opts?.applyStatus ?? "succeeded";

  const service = new MaterializationRolloutWorkerService(
    prisma as never,
    {
      execute: async (userId: string, publishedVersion: { id: string }, reapply: boolean) => {
        applyCalls.push({ userId, publishedVersionId: publishedVersion.id, reapply });
      }
    } as never,
    {
      getLeaseState: async () => null,
      acquire: async () => null,
      heartbeat: async () => true,
      release: async () => undefined
    } as never,
    {
      recordLeaseLost: () => undefined,
      recordTickSkipped: () => undefined,
      recordLeaseExpiredRecovered: () => undefined,
      recordTickAcquired: () => undefined
    } as never,
    {
      execute: async (input: Record<string, unknown>) => {
        prisma.audits.push(input);
      }
    } as never,
    {
      findLatestByAssistantId: async () => ({
        id: "pub-assistant-1"
      })
    } as never,
    {
      findLatestByAssistantId: async () => opts?.latestSpec ?? null,
      findByPublishedVersionId: async () =>
        opts?.refreshedSpec
          ? {
              id: opts.refreshedSpec.id,
              contentHash: opts.refreshedSpec.contentHash,
              runtimeBundleHash: opts.refreshedSpec.runtimeBundleHash,
              publishedVersionId: "pub-assistant-1",
              materializedAtConfigGeneration: 42
            }
          : null
    } as never
  );

  prisma.assistant.findUnique = async ({ select }: { select?: Record<string, unknown> } = {}) => {
    if (select && "applyStatus" in select) {
      return prisma.assistantStateRow;
    }
    return {
      id: "assistant-1",
      workspaceId: "ws-1",
      userId: "user-1"
    };
  };

  return { prisma, service, applyCalls };
}

async function run(): Promise<void> {
  {
    const { prisma, service, applyCalls } = makeService({
      refreshedSpec: {
        id: "spec-2",
        contentHash: "hash-2",
        runtimeBundleHash: "bundle-2"
      }
    });
    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(applyCalls.length, 1, "worker applies published version when item is stale");
    assert.equal(prisma.items[0]?.status, "succeeded");
    assert.equal(prisma.rollouts[0]?.status, "succeeded");
    console.log("✓ rollout worker applies queued stale item and updates rollout summary");
  }

  {
    const { prisma, service, applyCalls } = makeService({
      latestSpec: {
        id: "spec-1",
        publishedVersionId: "pub-assistant-1",
        materializedAtConfigGeneration: 42,
        contentHash: "hash-1",
        runtimeBundleHash: "bundle-1"
      }
    });
    const processed = await service.processPendingBatch();

    assert.equal(processed, 1);
    assert.equal(applyCalls.length, 0, "worker skips already-fresh items");
    assert.equal(prisma.items[0]?.status, "skipped");
    assert.equal(prisma.rollouts[0]?.skippedCount, 1);
    console.log("✓ rollout worker skips fresh-enough item");
  }
}

void run();
