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

void runRetriesSerializableConsumeWithinLimit();
