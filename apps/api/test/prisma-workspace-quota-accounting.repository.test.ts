import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaWorkspaceQuotaAccountingRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository";

async function runRetriesSerializableTokenBudgetCap(): Promise<void> {
  let transactionCalls = 0;
  eventWrites.length = 0;

  const repository = new PrismaWorkspaceQuotaAccountingRepository({
    $transaction: async (
      callback: (tx: {
        workspaceQuotaAccountingState: {
          findUnique: typeof workspaceQuotaAccountingState.findUnique;
          update: typeof workspaceQuotaAccountingState.update;
          create: typeof workspaceQuotaAccountingState.create;
        };
        workspaceQuotaUsageEvent: {
          create: typeof workspaceQuotaUsageEvent.create;
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
        workspaceQuotaAccountingState,
        workspaceQuotaUsageEvent
      });
    }
  } as never);

  const result = await repository.applyTokenBudgetUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    delta: BigInt(12),
    source: "web_chat_turn_sync",
    metadata: { estimator: "chars_div_4_ceil_v1" },
    limits: {
      tokenBudgetLimit: BigInt(100),
      costOrTokenDrivingToolClassUnitsLimit: 10,
      activeWebChatsLimit: 20,
      mediaStorageBytesLimit: BigInt(1000)
    }
  });

  assert.equal(transactionCalls, 2);
  assert.equal(result.appliedDelta, BigInt(5));
  assert.equal(result.capped, true);
  assert.equal(result.state.tokenBudgetUsed, BigInt(100));
  assert.deepEqual(eventWrites, [
    {
      delta: BigInt(5),
      source: "web_chat_turn_sync"
    }
  ]);
  eventWrites.length = 0;
}

async function runRetriesSerializableMediaStorageCap(): Promise<void> {
  let transactionCalls = 0;
  eventWrites.length = 0;

  const repository = new PrismaWorkspaceQuotaAccountingRepository({
    $transaction: async (
      callback: (tx: {
        workspaceQuotaAccountingState: {
          findUnique: typeof workspaceQuotaAccountingStateMedia.findUnique;
          update: typeof workspaceQuotaAccountingStateMedia.update;
          create: typeof workspaceQuotaAccountingStateMedia.create;
        };
        workspaceQuotaUsageEvent: {
          create: typeof workspaceQuotaUsageEvent.create;
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
        workspaceQuotaAccountingState: workspaceQuotaAccountingStateMedia,
        workspaceQuotaUsageEvent
      });
    }
  } as never);

  const result = await repository.applyMediaStorageUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    delta: BigInt(12),
    source: "web_staged_upload",
    metadata: null,
    limits: {
      tokenBudgetLimit: BigInt(100),
      costOrTokenDrivingToolClassUnitsLimit: 10,
      activeWebChatsLimit: 20,
      mediaStorageBytesLimit: BigInt(100)
    }
  });

  assert.equal(transactionCalls, 2);
  assert.equal(result.appliedDelta, BigInt(5));
  assert.equal(result.capped, true);
  assert.equal(result.state.mediaStorageBytesUsed, BigInt(100));
  assert.deepEqual(eventWrites, [
    {
      delta: BigInt(5),
      source: "web_staged_upload"
    }
  ]);
}

const workspaceQuotaAccountingState = {
  findUnique: async () => ({
    id: "state-1",
    workspaceId: "ws-1",
    tokenBudgetUsed: BigInt(95),
    tokenBudgetLimit: BigInt(100),
    costOrTokenDrivingToolClassUnitsUsed: 0,
    costOrTokenDrivingToolClassUnitsLimit: 10,
    activeWebChatsCurrent: 0,
    activeWebChatsLimit: 20,
    mediaStorageBytesUsed: BigInt(0),
    mediaStorageBytesLimit: BigInt(1000),
    lastComputedAt: new Date("2026-04-06T00:00:00.000Z"),
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  }),
  update: async ({ data }: { data: { tokenBudgetUsed: { increment: bigint } } }) => ({
    id: "state-1",
    workspaceId: "ws-1",
    tokenBudgetUsed: BigInt(95) + data.tokenBudgetUsed.increment,
    tokenBudgetLimit: BigInt(100),
    costOrTokenDrivingToolClassUnitsUsed: 0,
    costOrTokenDrivingToolClassUnitsLimit: 10,
    activeWebChatsCurrent: 0,
    activeWebChatsLimit: 20,
    mediaStorageBytesUsed: BigInt(0),
    mediaStorageBytesLimit: BigInt(1000),
    lastComputedAt: new Date("2026-04-06T00:00:01.000Z"),
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:01.000Z")
  }),
  create: async () => {
    throw new Error("create should not be called when state already exists");
  }
};

const workspaceQuotaAccountingStateMedia = {
  findUnique: async () => ({
    id: "state-1",
    workspaceId: "ws-1",
    tokenBudgetUsed: BigInt(0),
    tokenBudgetLimit: BigInt(100),
    costOrTokenDrivingToolClassUnitsUsed: 0,
    costOrTokenDrivingToolClassUnitsLimit: 10,
    activeWebChatsCurrent: 0,
    activeWebChatsLimit: 20,
    mediaStorageBytesUsed: BigInt(95),
    mediaStorageBytesLimit: BigInt(100),
    lastComputedAt: new Date("2026-04-06T00:00:00.000Z"),
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z")
  }),
  update: async ({ data }: { data: { mediaStorageBytesUsed: { increment: bigint } } }) => ({
    id: "state-1",
    workspaceId: "ws-1",
    tokenBudgetUsed: BigInt(0),
    tokenBudgetLimit: BigInt(100),
    costOrTokenDrivingToolClassUnitsUsed: 0,
    costOrTokenDrivingToolClassUnitsLimit: 10,
    activeWebChatsCurrent: 0,
    activeWebChatsLimit: 20,
    mediaStorageBytesUsed: BigInt(95) + data.mediaStorageBytesUsed.increment,
    mediaStorageBytesLimit: BigInt(100),
    lastComputedAt: new Date("2026-04-06T00:00:01.000Z"),
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:01.000Z")
  }),
  create: async () => {
    throw new Error("create should not be called when state already exists");
  }
};

const eventWrites: Array<{ delta: bigint; source: string }> = [];

const workspaceQuotaUsageEvent = {
  create: async ({ data }: { data: { delta: bigint; source: string } }) => {
    eventWrites.push({
      delta: data.delta,
      source: data.source
    });
    return {};
  }
};

async function main(): Promise<void> {
  await runRetriesSerializableTokenBudgetCap();
  await runRetriesSerializableMediaStorageCap();
}

void main();
