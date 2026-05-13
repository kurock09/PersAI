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
    findMany: async () => [...this.rollouts].reverse()
  };

  materializationRolloutItem = {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      this.items.push(...data);
      return { count: data.length };
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
}

void run();
