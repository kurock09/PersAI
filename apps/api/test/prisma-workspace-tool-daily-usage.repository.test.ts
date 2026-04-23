import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaWorkspaceToolDailyUsageRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-tool-daily-usage.repository";

async function runRetriesSerializableConsumeWithinLimit(): Promise<void> {
  let transactionCalls = 0;

  const repository = new PrismaWorkspaceToolDailyUsageRepository({
    $transaction: async (
      callback: (tx: {
        workspaceToolUsageDailyCounter: {
          findUnique: typeof usageCounterTx.findUnique;
          update: typeof usageCounterTx.update;
          create: typeof usageCounterTx.create;
        };
      }) => Promise<unknown>
    ) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        throw new Prisma.PrismaClientKnownRequestError("serialization conflict", {
          code: "P2034",
          clientVersion: "test"
        });
      }
      return callback({
        workspaceToolUsageDailyCounter: usageCounterTx
      });
    }
  } as never);

  const allowed = await repository.consumeWithinLimit("ws-1", "web_search", 3);
  assert.equal(transactionCalls, 2);
  assert.deepEqual(allowed, {
    allowed: true,
    currentCount: 3
  });

  const cappedRepository = new PrismaWorkspaceToolDailyUsageRepository({
    $transaction: async (
      callback: (tx: {
        workspaceToolUsageDailyCounter: {
          findUnique: typeof cappedUsageCounterTx.findUnique;
          update: typeof cappedUsageCounterTx.update;
          create: typeof cappedUsageCounterTx.create;
        };
      }) => Promise<unknown>
    ) =>
      callback({
        workspaceToolUsageDailyCounter: cappedUsageCounterTx
      })
  } as never);

  const denied = await cappedRepository.consumeWithinLimit("ws-1", "web_search", 3);
  assert.deepEqual(denied, {
    allowed: false,
    currentCount: 3
  });
}

const usageCounterTx = {
  findUnique: async () => ({
    id: "counter-1",
    workspaceId: "ws-1",
    toolCode: "web_search",
    date: new Date("2026-04-06T00:00:00.000Z"),
    callCount: 2
  }),
  update: async () => ({
    id: "counter-1",
    workspaceId: "ws-1",
    toolCode: "web_search",
    date: new Date("2026-04-06T00:00:00.000Z"),
    callCount: 3
  }),
  create: async () => {
    throw new Error("create should not be called when row already exists");
  }
};

const cappedUsageCounterTx = {
  findUnique: async () => ({
    id: "counter-1",
    workspaceId: "ws-1",
    toolCode: "web_search",
    date: new Date("2026-04-06T00:00:00.000Z"),
    callCount: 3
  }),
  update: async () => {
    throw new Error("update must not run when daily limit is already reached");
  },
  create: async () => {
    throw new Error("create must not run when daily limit is already reached");
  }
};

/**
 * ADR-074 L1.1 — `consumeWithinLimit` now accepts a `units` weight that
 * advances the counter by N per call. The limit check is "reject if the
 * batch would push the counter past the cap" (whole-batch semantics, no
 * partial commits). This test verifies both the happy path (count
 * jumps by 4 instead of 1) and the boundary path (a 3-unit batch on a
 * cap=5 counter at 3 is denied without mutating the row).
 */
async function runWeightedConsumeWithinLimit(): Promise<void> {
  const updates: Array<{ increment: number }> = [];
  const txAtTwo = {
    findUnique: async () => ({
      id: "counter-2",
      workspaceId: "ws-1",
      toolCode: "image_generate",
      date: new Date("2026-04-06T00:00:00.000Z"),
      callCount: 2
    }),
    update: async (params: { data: { callCount: { increment: number } } }) => {
      updates.push({ increment: params.data.callCount.increment });
      return {
        id: "counter-2",
        workspaceId: "ws-1",
        toolCode: "image_generate",
        date: new Date("2026-04-06T00:00:00.000Z"),
        callCount: 2 + params.data.callCount.increment
      };
    },
    create: async () => {
      throw new Error("create should not run when row exists");
    }
  };

  const repo = new PrismaWorkspaceToolDailyUsageRepository({
    $transaction: async (
      callback: (tx: { workspaceToolUsageDailyCounter: typeof txAtTwo }) => Promise<unknown>
    ) => callback({ workspaceToolUsageDailyCounter: txAtTwo })
  } as never);

  const allowed = await repo.consumeWithinLimit("ws-1", "image_generate", 10, 4);
  assert.deepEqual(allowed, { allowed: true, currentCount: 6 });
  assert.deepEqual(updates, [{ increment: 4 }]);

  // Whole-batch denial: cap=5, currentCount=3, units=3 → would land at
  // 6, exceeds 5, must be denied without mutating the row.
  const txAtThree = {
    findUnique: async () => ({
      id: "counter-3",
      workspaceId: "ws-1",
      toolCode: "image_generate",
      date: new Date("2026-04-06T00:00:00.000Z"),
      callCount: 3
    }),
    update: async () => {
      throw new Error("update must not run when batch would exceed cap");
    },
    create: async () => {
      throw new Error("create must not run when batch would exceed cap");
    }
  };
  const denyingRepo = new PrismaWorkspaceToolDailyUsageRepository({
    $transaction: async (
      callback: (tx: { workspaceToolUsageDailyCounter: typeof txAtThree }) => Promise<unknown>
    ) => callback({ workspaceToolUsageDailyCounter: txAtThree })
  } as never);
  const denied = await denyingRepo.consumeWithinLimit("ws-1", "image_generate", 5, 3);
  assert.deepEqual(denied, { allowed: false, currentCount: 3 });

  // Defensive normalization: zero/negative/fractional `units` collapses
  // to 1 so a buggy caller cannot zero the counter.
  const normalizingTx = {
    findUnique: async () => null,
    update: async () => {
      throw new Error("update should not run when row does not exist");
    },
    create: async (params: { data: { callCount: number } }) => ({
      id: "counter-4",
      workspaceId: "ws-1",
      toolCode: "tts",
      date: new Date("2026-04-06T00:00:00.000Z"),
      callCount: params.data.callCount
    })
  };
  const normalizingRepo = new PrismaWorkspaceToolDailyUsageRepository({
    $transaction: async (
      callback: (tx: { workspaceToolUsageDailyCounter: typeof normalizingTx }) => Promise<unknown>
    ) => callback({ workspaceToolUsageDailyCounter: normalizingTx })
  } as never);
  const result = await normalizingRepo.consumeWithinLimit("ws-1", "tts", 5, 0);
  assert.deepEqual(result, { allowed: true, currentCount: 1 });
}

/**
 * ADR-074 L1.1 — `incrementAndGet` also accepts a `units` weight (used
 * by the always-count observability path when the plan has no daily
 * cap configured). Verify it is forwarded to the upsert payload.
 */
async function runWeightedIncrementAndGet(): Promise<void> {
  const captured: Array<{ create: number; updateIncrement: number }> = [];
  const repo = new PrismaWorkspaceToolDailyUsageRepository({
    workspaceToolUsageDailyCounter: {
      upsert: async (params: {
        update: { callCount: { increment: number } };
        create: { callCount: number };
      }) => {
        captured.push({
          create: params.create.callCount,
          updateIncrement: params.update.callCount.increment
        });
        return {
          id: "counter-5",
          workspaceId: "ws-1",
          toolCode: "tts",
          date: new Date("2026-04-06T00:00:00.000Z"),
          callCount: params.create.callCount
        };
      }
    }
  } as never);

  const count = await repo.incrementAndGet("ws-1", "tts", 4);
  assert.equal(count, 4);
  assert.deepEqual(captured, [{ create: 4, updateIncrement: 4 }]);

  // Default behaviour (no units arg) still increments by 1 — keeps
  // older API callers wire-compatible.
  const captured2: Array<{ create: number; updateIncrement: number }> = [];
  const defaultRepo = new PrismaWorkspaceToolDailyUsageRepository({
    workspaceToolUsageDailyCounter: {
      upsert: async (params: {
        update: { callCount: { increment: number } };
        create: { callCount: number };
      }) => {
        captured2.push({
          create: params.create.callCount,
          updateIncrement: params.update.callCount.increment
        });
        return {
          id: "counter-6",
          workspaceId: "ws-1",
          toolCode: "memory_write",
          date: new Date("2026-04-06T00:00:00.000Z"),
          callCount: 1
        };
      }
    }
  } as never);
  await defaultRepo.incrementAndGet("ws-1", "memory_write");
  assert.deepEqual(captured2, [{ create: 1, updateIncrement: 1 }]);
}

void runRetriesSerializableConsumeWithinLimit();
void runWeightedConsumeWithinLimit();
void runWeightedIncrementAndGet();
