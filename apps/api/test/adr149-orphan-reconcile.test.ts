import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ReconcileOrphanWebChatTurnAttemptsService } from "../src/modules/workspace-management/application/reconcile-orphan-web-chat-turn-attempts.service";
import { WebChatTurnStopDispatchService } from "../src/modules/workspace-management/application/web-chat-turn-stop-dispatch.service";
import { WebChatTurnStreamRegistry } from "../src/modules/workspace-management/application/web-chat-turn-stream-registry.service";

type AttemptRow = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  surfaceThreadKey: string;
  clientTurnId: string;
  userMessageId: string | null;
  status: string;
  acceptedAt: Date | null;
  runningAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakePrisma {
  attempts = new Map<string, AttemptRow>();
  receipts: Array<{
    assistantId: string;
    channel: string;
    externalThreadKey: string;
    externalUserKey: string;
    idempotencyKey: string;
    status: string;
    updatedAt: Date;
  }> = [];

  assistantWebChatTurnAttempt = {
    findMany: async (args: {
      where: { status: { in: string[] } };
      take: number;
    }): Promise<AttemptRow[]> => {
      return [...this.attempts.values()]
        .filter((row) => args.where.status.in.includes(row.status))
        .slice(0, args.take);
    },
    updateMany: async (args: {
      where: { id: string; status: { in: string[] } };
      data: {
        status: string;
        errorCode: string;
        errorMessage: string;
        interruptedAt: Date;
      };
    }): Promise<{ count: number }> => {
      const row = this.attempts.get(args.where.id);
      if (row === undefined || !args.where.status.in.includes(row.status)) {
        return { count: 0 };
      }
      row.status = args.data.status;
      row.updatedAt = args.data.interruptedAt;
      return { count: 1 };
    }
  };

  runtimeTurnReceipt = {
    findFirst: async (args: {
      where: {
        assistantId: string;
        channel: string;
        externalThreadKey: string;
        externalUserKey: string;
        idempotencyKey: string;
        status: string;
        updatedAt: { gte: Date };
      };
    }) => {
      return (
        this.receipts.find(
          (receipt) =>
            receipt.assistantId === args.where.assistantId &&
            receipt.channel === args.where.channel &&
            receipt.externalThreadKey === args.where.externalThreadKey &&
            receipt.externalUserKey === args.where.externalUserKey &&
            receipt.idempotencyKey === args.where.idempotencyKey &&
            receipt.status === args.where.status &&
            receipt.updatedAt.getTime() >= args.where.updatedAt.gte.getTime()
        ) ?? null
      );
    }
  };
}

class FakeStopDispatch {
  activeOwners = new Set<string>();

  async hasActiveOwner(assistantId: string, clientTurnId: string): Promise<boolean> {
    return this.activeOwners.has(`${assistantId}:${clientTurnId}`);
  }
}

function createService(prisma: FakePrisma, stopDispatch: FakeStopDispatch) {
  return new ReconcileOrphanWebChatTurnAttemptsService(
    prisma as never,
    stopDispatch as unknown as WebChatTurnStopDispatchService,
    new WebChatTurnStreamRegistry()
  );
}

describe("ADR-149 orphan web turn attempt reconcile", () => {
  test("reconciles stale accepted attempts after grace", async () => {
    const prisma = new FakePrisma();
    const stopDispatch = new FakeStopDispatch();
    const service = createService(prisma, stopDispatch);
    const now = new Date("2026-07-15T12:00:00.000Z");
    const graceMs = 60_000;
    prisma.attempts.set("attempt-1", {
      id: "attempt-1",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-1",
      userMessageId: "msg-1",
      status: "accepted",
      acceptedAt: new Date(now.getTime() - graceMs - 5_000),
      runningAt: null,
      createdAt: new Date(now.getTime() - graceMs - 5_000),
      updatedAt: new Date(now.getTime() - graceMs - 5_000)
    });

    const result = await service.executeBatch(8, { now, graceMs });

    assert.equal(result.candidates, 1);
    assert.equal(result.applied, 1);
    assert.equal(prisma.attempts.get("attempt-1")?.status, "interrupted");
  });

  test("does not reconcile active turns with fresh heartbeat", async () => {
    const prisma = new FakePrisma();
    const stopDispatch = new FakeStopDispatch();
    const service = createService(prisma, stopDispatch);
    const now = new Date("2026-07-15T12:00:00.000Z");
    const graceMs = 60_000;
    prisma.attempts.set("attempt-2", {
      id: "attempt-2",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-2",
      userMessageId: "msg-2",
      status: "running",
      acceptedAt: new Date(now.getTime() - graceMs - 30_000),
      runningAt: new Date(now.getTime() - graceMs - 20_000),
      createdAt: new Date(now.getTime() - graceMs - 30_000),
      updatedAt: new Date(now.getTime() - 1_000)
    });

    const result = await service.executeBatch(8, { now, graceMs });

    assert.equal(result.candidates, 1);
    assert.equal(result.applied, 0);
    assert.equal(result.skippedFresh, 1);
    assert.equal(prisma.attempts.get("attempt-2")?.status, "running");
  });

  test("skips attempts with active stream or stop owners", async () => {
    const prisma = new FakePrisma();
    const stopDispatch = new FakeStopDispatch();
    const streamRegistry = new WebChatTurnStreamRegistry();
    const service = new ReconcileOrphanWebChatTurnAttemptsService(
      prisma as never,
      stopDispatch as unknown as WebChatTurnStopDispatchService,
      streamRegistry
    );
    const now = new Date("2026-07-15T12:00:00.000Z");
    const graceMs = 60_000;
    const staleAt = new Date(now.getTime() - graceMs - 5_000);
    prisma.attempts.set("attempt-3", {
      id: "attempt-3",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-3",
      userMessageId: "msg-3",
      status: "running",
      acceptedAt: staleAt,
      runningAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt
    });
    prisma.attempts.set("attempt-4", {
      id: "attempt-4",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-4",
      userMessageId: "msg-4",
      status: "accepted",
      acceptedAt: staleAt,
      runningAt: null,
      createdAt: staleAt,
      updatedAt: staleAt
    });
    streamRegistry.register({
      assistantId: "assistant-1",
      clientTurnId: "turn-3",
      userId: "user-1"
    });
    stopDispatch.activeOwners.add("assistant-1:turn-4");

    const result = await service.executeBatch(8, { now, graceMs });

    assert.equal(result.applied, 0);
    assert.equal(result.skippedActiveOwner, 2);
    assert.equal(prisma.attempts.get("attempt-3")?.status, "running");
    assert.equal(prisma.attempts.get("attempt-4")?.status, "accepted");
  });

  test("reconcile is idempotent", async () => {
    const prisma = new FakePrisma();
    const stopDispatch = new FakeStopDispatch();
    const service = createService(prisma, stopDispatch);
    const now = new Date("2026-07-15T12:00:00.000Z");
    const graceMs = 60_000;
    const staleAt = new Date(now.getTime() - graceMs - 5_000);
    prisma.attempts.set("attempt-5", {
      id: "attempt-5",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      surfaceThreadKey: "thread-1",
      clientTurnId: "turn-5",
      userMessageId: "msg-5",
      status: "accepted",
      acceptedAt: staleAt,
      runningAt: null,
      createdAt: staleAt,
      updatedAt: staleAt
    });

    const first = await service.executeBatch(8, { now, graceMs });
    const second = await service.executeBatch(8, { now, graceMs });

    assert.equal(first.applied, 1);
    assert.equal(second.applied, 0);
    assert.equal(prisma.attempts.get("attempt-5")?.status, "interrupted");
  });
});
