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
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  dimension: string;
  delta: bigint;
  source: string;
  metadata?: unknown;
  limitValue?: bigint | null;
};

type MockTokenBudgetPeriodCounter = {
  id: string;
  workspaceId: string;
  periodStartedAt: Date;
  periodEndsAt: Date;
  usedCredits: bigint;
  limitCredits: bigint | null;
  lastComputedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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

function buildCounter(
  overrides: Partial<MockTokenBudgetPeriodCounter> = {}
): MockTokenBudgetPeriodCounter {
  return {
    id: "counter-1",
    workspaceId: "ws-1",
    periodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    periodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
    usedCredits: BigInt(0),
    limitCredits: BigInt(100),
    lastComputedAt: new Date("2026-04-06T00:00:00.000Z"),
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
    ...overrides
  };
}

function toRawState(state: MockState): Record<string, unknown> {
  return {
    id: state.id,
    workspace_id: state.workspaceId,
    token_budget_used: state.tokenBudgetUsed,
    token_budget_limit: state.tokenBudgetLimit,
    cost_or_token_driving_tool_class_units_used: state.costOrTokenDrivingToolClassUnitsUsed,
    cost_or_token_driving_tool_class_units_limit: state.costOrTokenDrivingToolClassUnitsLimit,
    active_web_chats_current: state.activeWebChatsCurrent,
    active_web_chats_limit: state.activeWebChatsLimit,
    media_storage_bytes_used: state.mediaStorageBytesUsed,
    media_storage_bytes_limit: state.mediaStorageBytesLimit,
    knowledge_storage_bytes_used: state.knowledgeStorageBytesUsed,
    knowledge_storage_bytes_limit: state.knowledgeStorageBytesLimit,
    last_computed_at: state.lastComputedAt,
    created_at: state.createdAt,
    updated_at: state.updatedAt
  };
}

function toRawCounter(counter: MockTokenBudgetPeriodCounter): Record<string, unknown> {
  return {
    id: counter.id,
    workspace_id: counter.workspaceId,
    period_started_at: counter.periodStartedAt,
    period_ends_at: counter.periodEndsAt,
    used_credits: counter.usedCredits,
    limit_credits: counter.limitCredits,
    last_computed_at: counter.lastComputedAt,
    created_at: counter.createdAt,
    updated_at: counter.updatedAt
  };
}

function applyStateUpdate(state: MockState, data: Record<string, unknown>): MockState {
  const nextState = { ...state };
  if ("tokenBudgetUsed" in data) {
    nextState.tokenBudgetUsed = data.tokenBudgetUsed as bigint;
  }
  if ("tokenBudgetLimit" in data) {
    nextState.tokenBudgetLimit = (data.tokenBudgetLimit as bigint | null | undefined) ?? null;
  }
  if ("costOrTokenDrivingToolClassUnitsLimit" in data) {
    nextState.costOrTokenDrivingToolClassUnitsLimit =
      (data.costOrTokenDrivingToolClassUnitsLimit as number | null | undefined) ?? null;
  }
  if ("activeWebChatsLimit" in data) {
    nextState.activeWebChatsLimit = (data.activeWebChatsLimit as number | null | undefined) ?? null;
  }
  if ("mediaStorageBytesLimit" in data) {
    nextState.mediaStorageBytesLimit =
      (data.mediaStorageBytesLimit as bigint | null | undefined) ?? null;
  }
  if ("knowledgeStorageBytesLimit" in data) {
    nextState.knowledgeStorageBytesLimit =
      (data.knowledgeStorageBytesLimit as bigint | null | undefined) ?? null;
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
  nextState.lastComputedAt = new Date("2026-04-06T00:00:01.000Z");
  nextState.updatedAt = new Date("2026-04-06T00:00:01.000Z");
  return nextState;
}

function applyCounterUpdate(
  counter: MockTokenBudgetPeriodCounter,
  data: Record<string, unknown>
): MockTokenBudgetPeriodCounter {
  const nextCounter = { ...counter };
  const usedCreditsUpdate = data.usedCredits as { increment: bigint } | undefined;
  nextCounter.usedCredits += usedCreditsUpdate?.increment ?? BigInt(0);
  nextCounter.limitCredits = (data.limitCredits as bigint | null | undefined) ?? null;
  nextCounter.lastComputedAt = new Date("2026-04-06T00:00:01.000Z");
  nextCounter.updatedAt = new Date("2026-04-06T00:00:01.000Z");
  return nextCounter;
}

function createRepositoryHarness(options?: {
  initialState?: MockState | null;
  initialCounter?: MockTokenBudgetPeriodCounter | null;
  failFirstTransactions?: number;
  raceOnStateCreate?: boolean;
  raceOnCounterCreate?: boolean;
}) {
  let state = options?.initialState ?? null;
  let counter = options?.initialCounter ?? null;
  let transactionCalls = 0;
  let stateCreateCalls = 0;
  let counterCreateCalls = 0;
  let stateLockQueries = 0;
  let counterLockQueries = 0;
  let raceOnStateCreate = options?.raceOnStateCreate ?? false;
  let raceOnCounterCreate = options?.raceOnCounterCreate ?? false;
  const eventWrites: EventWrite[] = [];

  const repository = new PrismaWorkspaceQuotaAccountingRepository({
    $transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
      transactionCalls += 1;
      if (transactionCalls <= (options?.failFirstTransactions ?? 0)) {
        throw new Prisma.PrismaClientKnownRequestError("transaction conflict", {
          code: "P2034",
          clientVersion: "test"
        });
      }

      return callback({
        $queryRaw: async (query: { strings?: string[] }) => {
          const sql = Array.isArray(query?.strings) ? query.strings.join(" ") : String(query);
          if (sql.includes("workspace_quota_accounting_state")) {
            stateLockQueries += 1;
            return state === null ? [] : [toRawState(state)];
          }
          if (sql.includes("workspace_token_budget_period_counters")) {
            counterLockQueries += 1;
            return counter === null ? [] : [toRawCounter(counter)];
          }
          throw new Error(`Unexpected raw query: ${sql}`);
        },
        workspaceQuotaAccountingState: {
          create: async ({ data }: { data: Partial<MockState> }) => {
            stateCreateCalls += 1;
            if (raceOnStateCreate) {
              raceOnStateCreate = false;
              state = buildState(data);
              throw new Prisma.PrismaClientKnownRequestError("duplicate state", {
                code: "P2002",
                clientVersion: "test"
              });
            }
            state = buildState(data);
            return state;
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            if (state === null) {
              throw new Error("quota state must be locked or created before update");
            }
            state = applyStateUpdate(state, data);
            return state;
          }
        },
        workspaceTokenBudgetPeriodCounter: {
          create: async ({ data }: { data: Partial<MockTokenBudgetPeriodCounter> }) => {
            counterCreateCalls += 1;
            if (raceOnCounterCreate) {
              raceOnCounterCreate = false;
              counter = buildCounter(data);
              throw new Prisma.PrismaClientKnownRequestError("duplicate counter", {
                code: "P2002",
                clientVersion: "test"
              });
            }
            counter = buildCounter(data);
            return counter;
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            if (counter === null) {
              throw new Error("token counter must be locked or created before update");
            }
            counter = applyCounterUpdate(counter, data);
            return counter;
          }
        },
        workspaceQuotaUsageEvent: {
          create: async ({ data }: { data: EventWrite }) => {
            eventWrites.push(data);
            return {};
          }
        }
      });
    }
  } as never);

  return {
    repository,
    eventWrites,
    getTransactionCalls: () => transactionCalls,
    getStateCreateCalls: () => stateCreateCalls,
    getCounterCreateCalls: () => counterCreateCalls,
    getStateLockQueries: () => stateLockQueries,
    getCounterLockQueries: () => counterLockQueries
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

async function runRetriesConflictingTransactionAndLocksRows(): Promise<void> {
  const periodStartedAt = new Date("2026-05-01T00:00:00.000Z");
  const periodEndsAt = new Date("2026-06-01T00:00:00.000Z");
  const harness = createRepositoryHarness({
    initialState: buildState({ tokenBudgetUsed: BigInt(95) }),
    initialCounter: buildCounter({
      periodStartedAt,
      periodEndsAt,
      usedCredits: BigInt(95)
    }),
    failFirstTransactions: 1
  });

  const result = await harness.repository.applyTokenBudgetUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    periodStartedAt,
    periodEndsAt,
    delta: BigInt(12),
    source: "web_chat_turn_sync",
    metadata: { estimator: "chars_div_4_ceil_v1" },
    limits: buildLimits()
  });

  assert.equal(harness.getTransactionCalls(), 2);
  assert.equal(harness.getCounterLockQueries(), 1);
  assert.equal(harness.getStateLockQueries(), 1);
  assert.equal(result.appliedDelta, BigInt(5));
  assert.equal(result.capped, true);
  assert.equal(result.counter.usedCredits, BigInt(100));
  assert.equal(result.state.tokenBudgetUsed, BigInt(100));
  assert.equal(harness.eventWrites.length, 1);
  assert.equal(harness.eventWrites[0]?.dimension, "token_budget");
  assert.equal(harness.eventWrites[0]?.delta, BigInt(5));
}

async function runCreatesMissingRowsAfterRace(): Promise<void> {
  const periodStartedAt = new Date("2026-05-01T00:00:00.000Z");
  const periodEndsAt = new Date("2026-06-01T00:00:00.000Z");
  const harness = createRepositoryHarness({
    initialState: null,
    initialCounter: null,
    raceOnStateCreate: true,
    raceOnCounterCreate: true
  });

  const result = await harness.repository.applyTokenBudgetUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    periodStartedAt,
    periodEndsAt,
    delta: BigInt(12),
    source: "web_chat_turn_sync",
    metadata: null,
    limits: buildLimits()
  });

  assert.equal(harness.getCounterCreateCalls(), 1);
  assert.equal(harness.getStateCreateCalls(), 1);
  assert.equal(harness.getCounterLockQueries(), 2);
  assert.equal(harness.getStateLockQueries(), 2);
  assert.equal(result.appliedDelta, BigInt(12));
  assert.equal(result.capped, false);
  assert.equal(result.counter.usedCredits, BigInt(12));
  assert.equal(result.state.tokenBudgetUsed, BigInt(12));
}

async function runReleasesKnowledgeStorageAgainstLockedState(): Promise<void> {
  const harness = createRepositoryHarness({
    initialState: buildState({ knowledgeStorageBytesUsed: BigInt(7) }),
    failFirstTransactions: 1
  });

  const result = await harness.repository.releaseKnowledgeStorageUsage({
    workspaceId: "ws-1",
    assistantId: "assistant-1",
    userId: "user-1",
    delta: BigInt(12),
    source: "assistant_reset_knowledge_cleanup",
    metadata: null,
    limits: buildLimits()
  });

  assert.equal(harness.getTransactionCalls(), 2);
  assert.equal(harness.getStateLockQueries(), 1);
  assert.equal(result.releasedDelta, BigInt(7));
  assert.equal(result.state.knowledgeStorageBytesUsed, BigInt(0));
  assert.equal(harness.eventWrites.length, 1);
  assert.equal(harness.eventWrites[0]?.dimension, "knowledge_storage_bytes");
  assert.equal(harness.eventWrites[0]?.delta, BigInt(-7));
}

async function main(): Promise<void> {
  await runRetriesConflictingTransactionAndLocksRows();
  await runCreatesMissingRowsAfterRace();
  await runReleasesKnowledgeStorageAgainstLockedState();
}

void main();
