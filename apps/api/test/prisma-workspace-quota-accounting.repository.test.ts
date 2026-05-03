import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaWorkspaceQuotaAccountingRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository";

type MockState = {
  id: string;
  workspaceId: string;
  tokenBudgetUsed: bigint;
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsUsed: number;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
  activeWebChatsCurrent: number;
  activeWebChatsLimit: number | null;
  mediaStorageBytesUsed: bigint;
  mediaStorageBytesLimit: bigint | null;
  knowledgeStorageBytesUsed: bigint;
  knowledgeStorageBytesLimit: bigint | null;
  lastComputedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type EventWrite = {
  workspaceId?: string;
  assistantId?: string | null;
  userId?: string | null;
  dimension: string;
  delta: bigint;
  source: string;
  metadata?: unknown;
  limitValue?: bigint | null;
};

type MockTokenBudgetPeriodCounter = {
  workspaceId: string;
  periodStartedAt: Date;
  periodEndsAt: Date;
  usedCredits: bigint;
  limitCredits: bigint | null;
  lastComputedAt: Date;
};

function buildState(overrides: Partial<MockState> = {}): MockState {
  return {
    id: "state-1",
    workspaceId: "ws-1",
    tokenBudgetUsed: BigInt(0),
    tokenBudgetLimit: BigInt(100),
    costOrTokenDrivingToolClassUnitsUsed: 0,
    costOrTokenDrivingToolClassUnitsLimit: 10,
    activeWebChatsCurrent: 0,
    activeWebChatsLimit: 20,
    mediaStorageBytesUsed: BigInt(0),
    mediaStorageBytesLimit: BigInt(100),
    knowledgeStorageBytesUsed: BigInt(0),
    knowledgeStorageBytesLimit: BigInt(100),
    lastComputedAt: new Date("2026-04-06T00:00:00.000Z"),
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    ...overrides
  };
}

function applyUpdate(state: MockState, data: Record<string, unknown>): MockState {
  const nextState = { ...state };
  if ("tokenBudgetUsed" in data) {
    const tokenBudgetUsed = data.tokenBudgetUsed as bigint | { increment: bigint };
    nextState.tokenBudgetUsed =
      typeof tokenBudgetUsed === "bigint"
        ? tokenBudgetUsed
        : nextState.tokenBudgetUsed + tokenBudgetUsed.increment;
  }
  if ("mediaStorageBytesUsed" in data) {
    const mediaStorageBytesUsed = data.mediaStorageBytesUsed as
      | { increment: bigint }
      | { decrement: bigint };
    if ("increment" in mediaStorageBytesUsed) {
      nextState.mediaStorageBytesUsed += mediaStorageBytesUsed.increment;
    } else {
      nextState.mediaStorageBytesUsed -= mediaStorageBytesUsed.decrement;
    }
  }
  if ("knowledgeStorageBytesUsed" in data) {
    const knowledgeStorageBytesUsed = data.knowledgeStorageBytesUsed as
      | { increment: bigint }
      | { decrement: bigint };
    if ("increment" in knowledgeStorageBytesUsed) {
      nextState.knowledgeStorageBytesUsed += knowledgeStorageBytesUsed.increment;
    } else {
      nextState.knowledgeStorageBytesUsed -= knowledgeStorageBytesUsed.decrement;
    }
  }
  nextState.updatedAt = new Date("2026-04-06T00:00:01.000Z");
  nextState.lastComputedAt = new Date("2026-04-06T00:00:01.000Z");
  return nextState;
}

function createRetryingRepository(initialState: MockState): {
  repository: PrismaWorkspaceQuotaAccountingRepository;
  getTransactionCalls: () => number;
  eventWrites: EventWrite[];
} {
  let state = initialState;
  let tokenCounter: MockTokenBudgetPeriodCounter | null = null;
  let transactionCalls = 0;
  const eventWrites: EventWrite[] = [];

  const repository = new PrismaWorkspaceQuotaAccountingRepository({
    $transaction: async (
      callback: (tx: {
        workspaceQuotaAccountingState: {
          findUnique: () => Promise<MockState>;
          upsert: (args: {
            update: Record<string, unknown>;
            create: Record<string, unknown>;
          }) => Promise<MockState>;
          update: (args: { data: Record<string, unknown> }) => Promise<MockState>;
          create: () => Promise<never>;
        };
        workspaceTokenBudgetPeriodCounter: {
          findUnique: () => Promise<MockTokenBudgetPeriodCounter | null>;
          upsert: (args: {
            update: Record<string, unknown>;
            create: {
              workspaceId: string;
              periodStartedAt: Date;
              periodEndsAt: Date;
              usedCredits: bigint;
              limitCredits: bigint | null;
              lastComputedAt: Date;
            };
          }) => Promise<MockTokenBudgetPeriodCounter>;
        };
        workspaceQuotaUsageEvent: {
          create: (args: {
            data: { dimension: string; delta: bigint; source: string };
          }) => Promise<Record<string, never>>;
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
        workspaceQuotaAccountingState: {
          findUnique: async () => state,
          upsert: async ({ update, create }) => {
            if (state) {
              state = applyUpdate(state, update);
            } else {
              state = buildState(create as Partial<MockState>);
            }
            return state;
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            state = applyUpdate(state, data);
            return state;
          },
          create: async () => {
            throw new Error("create should not be called when state already exists");
          }
        },
        workspaceTokenBudgetPeriodCounter: {
          findUnique: async () => tokenCounter,
          upsert: async ({ update, create }) => {
            if (tokenCounter === null) {
              tokenCounter = {
                workspaceId: create.workspaceId,
                periodStartedAt: create.periodStartedAt,
                periodEndsAt: create.periodEndsAt,
                usedCredits: create.usedCredits,
                limitCredits: create.limitCredits,
                lastComputedAt: create.lastComputedAt
              };
              return tokenCounter;
            }
            const usedCreditsUpdate = update.usedCredits as { increment: bigint } | undefined;
            tokenCounter = {
              ...tokenCounter,
              usedCredits: tokenCounter.usedCredits + (usedCreditsUpdate?.increment ?? BigInt(0)),
              limitCredits: update.limitCredits as bigint | null,
              lastComputedAt: update.lastComputedAt as Date
            };
            return tokenCounter;
          }
        },
        workspaceQuotaUsageEvent: {
          create: async ({
            data
          }: {
            data: { dimension: string; delta: bigint; source: string };
          }) => {
            eventWrites.push(data);
            return {};
          }
        }
      });
    }
  } as never);

  return {
    repository,
    getTransactionCalls: () => transactionCalls,
    eventWrites
  };
}

function buildLimits() {
  return {
    tokenBudgetLimit: BigInt(100),
    costOrTokenDrivingToolClassUnitsLimit: 10,
    activeWebChatsLimit: 20,
    mediaStorageBytesLimit: BigInt(100),
    knowledgeStorageBytesLimit: BigInt(100)
  };
}

async function runRetriesSerializableTokenBudgetCap(): Promise<void> {
  const { repository, getTransactionCalls, eventWrites } = createRetryingRepository(
    buildState({ tokenBudgetUsed: BigInt(95), mediaStorageBytesLimit: BigInt(1000) })
  );

  const result = await repository.applyTokenBudgetUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    periodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    periodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    delta: BigInt(12),
    source: "web_chat_turn_sync",
    metadata: { estimator: "chars_div_4_ceil_v1" },
    limits: buildLimits()
  });

  assert.equal(getTransactionCalls(), 2);
  assert.equal(result.appliedDelta, BigInt(12));
  assert.equal(result.capped, false);
  assert.equal(result.state.tokenBudgetUsed, BigInt(12));
  assert.equal(result.counter.usedCredits, BigInt(12));
  assert.equal(eventWrites.length, 1);
  assert.equal(eventWrites[0]?.dimension, "token_budget");
  assert.equal(eventWrites[0]?.delta, BigInt(12));
  assert.equal(eventWrites[0]?.source, "web_chat_turn_sync");
  assert.equal(eventWrites[0]?.workspaceId, "ws-1");
}

async function runRetriesSerializableMediaStorageCap(): Promise<void> {
  const { repository, getTransactionCalls, eventWrites } = createRetryingRepository(
    buildState({ mediaStorageBytesUsed: BigInt(95) })
  );

  const result = await repository.applyMediaStorageUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    delta: BigInt(12),
    source: "web_staged_upload",
    metadata: null,
    limits: buildLimits()
  });

  assert.equal(getTransactionCalls(), 2);
  assert.equal(result.appliedDelta, BigInt(5));
  assert.equal(result.capped, true);
  assert.equal(result.state.mediaStorageBytesUsed, BigInt(100));
  assert.equal(eventWrites.length, 1);
  assert.equal(eventWrites[0]?.dimension, "media_storage_bytes");
  assert.equal(eventWrites[0]?.delta, BigInt(5));
  assert.equal(eventWrites[0]?.source, "web_staged_upload");
  assert.equal(eventWrites[0]?.workspaceId, "ws-1");
}

async function runRetriesSerializableKnowledgeStorageCap(): Promise<void> {
  const { repository, getTransactionCalls, eventWrites } = createRetryingRepository(
    buildState({ knowledgeStorageBytesUsed: BigInt(95) })
  );

  const result = await repository.applyKnowledgeStorageUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    delta: BigInt(12),
    source: "assistant_knowledge_upload",
    metadata: { filename: "gazprom.pdf" },
    limits: buildLimits()
  });

  assert.equal(getTransactionCalls(), 2);
  assert.equal(result.appliedDelta, BigInt(5));
  assert.equal(result.capped, true);
  assert.equal(result.state.knowledgeStorageBytesUsed, BigInt(100));
  assert.equal(eventWrites.length, 1);
  assert.equal(eventWrites[0]?.dimension, "knowledge_storage_bytes");
  assert.equal(eventWrites[0]?.delta, BigInt(5));
  assert.equal(eventWrites[0]?.source, "assistant_knowledge_upload");
  assert.equal(eventWrites[0]?.workspaceId, "ws-1");
}

async function runRetriesSerializableKnowledgeStorageRelease(): Promise<void> {
  const { repository, getTransactionCalls, eventWrites } = createRetryingRepository(
    buildState({ knowledgeStorageBytesUsed: BigInt(7) })
  );

  const result = await repository.releaseKnowledgeStorageUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    delta: BigInt(12),
    source: "assistant_reset_knowledge_cleanup",
    metadata: null,
    limits: buildLimits()
  });

  assert.equal(getTransactionCalls(), 2);
  assert.equal(result.releasedDelta, BigInt(7));
  assert.equal(result.state.knowledgeStorageBytesUsed, BigInt(0));
  assert.equal(eventWrites.length, 1);
  assert.equal(eventWrites[0]?.dimension, "knowledge_storage_bytes");
  assert.equal(eventWrites[0]?.delta, BigInt(-7));
  assert.equal(eventWrites[0]?.source, "assistant_reset_knowledge_cleanup");
  assert.equal(eventWrites[0]?.workspaceId, "ws-1");
}

async function main(): Promise<void> {
  await runRetriesSerializableTokenBudgetCap();
  await runRetriesSerializableMediaStorageCap();
  await runRetriesSerializableKnowledgeStorageCap();
  await runRetriesSerializableKnowledgeStorageRelease();
}

void main();
