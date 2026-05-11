import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaAssistantAbuseGuardRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-abuse-guard.repository";

const attemptedAt = new Date("2026-04-05T23:30:00.000Z");

async function runRetriesSerializableDistributedAttempt(): Promise<void> {
  let transactionCalls = 0;
  let lockCalls = 0;
  const repository = new PrismaAssistantAbuseGuardRepository({
    $transaction: async (
      callback: (tx: {
        $queryRaw: <T = unknown>() => Promise<T>;
        assistantAbuseGuardState: {
          create: typeof assistantAbuseGuardState.create;
          update: typeof assistantAbuseGuardState.update;
        };
        assistantAbuseAssistantState: {
          create: typeof assistantAbuseAssistantState.create;
          update: typeof assistantAbuseAssistantState.update;
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
        $queryRaw: async () => {
          lockCalls += 1;
          return (lockCalls === 1 ? [buildRawUserState()] : [buildRawAssistantState()]) as never;
        },
        assistantAbuseGuardState,
        assistantAbuseAssistantState
      });
    }
  } as never);

  const result = await repository.registerDistributedAttempt({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    surface: "web_chat",
    attemptedAt,
    windowMs: 60_000,
    quotaDecision: {
      blockedUntil: null,
      slowedUntil: null,
      reason: null
    },
    userSlowdownRequestsPerMinute: 2,
    userBlockRequestsPerMinute: 10,
    assistantSlowdownRequestsPerMinute: 10,
    assistantBlockRequestsPerMinute: 20,
    tempBlockSeconds: 300,
    slowdownSeconds: 30
  });

  assert.equal(transactionCalls, 2);
  assert.equal(lockCalls, 2);
  assert.equal(result.userState.requestCount, 2);
  assert.equal(result.assistantState.requestCount, 2);
  assert.equal(result.finalReason, "user_request_rate_limit_slowdown");
  assert.notEqual(result.finalSlowedUntil, null);
}

async function runCreatesMissingDistributedRowsWithBootstrapWindow(): Promise<void> {
  let userCreateCalls = 0;
  let assistantCreateCalls = 0;
  let userBootstrapWindowStartedAt: Date | null = null;
  let assistantBootstrapWindowStartedAt: Date | null = null;
  let lockCalls = 0;

  const repository = new PrismaAssistantAbuseGuardRepository({
    $transaction: async (
      callback: (tx: {
        $queryRaw: <T = unknown>() => Promise<T>;
        assistantAbuseGuardState: {
          create: typeof assistantAbuseGuardState.create;
          update: typeof assistantAbuseGuardState.update;
        };
        assistantAbuseAssistantState: {
          create: typeof assistantAbuseAssistantState.create;
          update: typeof assistantAbuseAssistantState.update;
        };
      }) => Promise<unknown>
    ) =>
      callback({
        $queryRaw: async () => {
          lockCalls += 1;
          return [] as never;
        },
        assistantAbuseGuardState: {
          ...assistantAbuseGuardState,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            userCreateCalls += 1;
            userBootstrapWindowStartedAt = data.windowStartedAt as Date;
            return buildUserState({
              windowStartedAt: data.windowStartedAt as Date,
              requestCount: data.requestCount as number,
              slowedUntil: data.slowedUntil as Date | null,
              blockedUntil: data.blockedUntil as Date | null,
              blockReason: data.blockReason as string | null,
              adminOverrideUntil: data.adminOverrideUntil as Date | null,
              lastSeenAt: data.lastSeenAt as Date
            });
          }
        },
        assistantAbuseAssistantState: {
          ...assistantAbuseAssistantState,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            assistantCreateCalls += 1;
            assistantBootstrapWindowStartedAt = data.windowStartedAt as Date;
            return buildAssistantState({
              windowStartedAt: data.windowStartedAt as Date,
              requestCount: data.requestCount as number,
              slowedUntil: data.slowedUntil as Date | null,
              blockedUntil: data.blockedUntil as Date | null,
              blockReason: data.blockReason as string | null,
              adminOverrideUntil: data.adminOverrideUntil as Date | null,
              lastSeenAt: data.lastSeenAt as Date
            });
          }
        }
      })
  } as never);

  const result = await repository.registerDistributedAttempt({
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    surface: "web_chat",
    attemptedAt,
    windowMs: 60_000,
    quotaDecision: {
      blockedUntil: null,
      slowedUntil: null,
      reason: null
    },
    userSlowdownRequestsPerMinute: 2,
    userBlockRequestsPerMinute: 10,
    assistantSlowdownRequestsPerMinute: 10,
    assistantBlockRequestsPerMinute: 20,
    tempBlockSeconds: 300,
    slowdownSeconds: 30
  });

  assert.equal(lockCalls, 2);
  assert.equal(userCreateCalls, 1);
  assert.equal(assistantCreateCalls, 1);
  assert.equal(userBootstrapWindowStartedAt?.getTime(), attemptedAt.getTime() - 60_000 - 1);
  assert.equal(assistantBootstrapWindowStartedAt?.getTime(), attemptedAt.getTime() - 60_000 - 1);
  assert.equal(result.userState.requestCount, 1);
  assert.equal(result.assistantState.requestCount, 1);
  assert.equal(result.finalReason, null);
}

function buildUserState(
  overrides: Partial<{
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }> = {}
) {
  return {
    id: "user-state-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    surface: "web_chat" as const,
    windowStartedAt: overrides.windowStartedAt ?? new Date("2026-04-05T23:29:30.000Z"),
    requestCount: overrides.requestCount ?? 1,
    slowedUntil: overrides.slowedUntil ?? null,
    blockedUntil: overrides.blockedUntil ?? null,
    blockReason: overrides.blockReason ?? null,
    adminOverrideUntil: overrides.adminOverrideUntil ?? null,
    lastSeenAt: overrides.lastSeenAt ?? new Date("2026-04-05T23:29:30.000Z"),
    createdAt: new Date("2026-04-05T23:29:30.000Z"),
    updatedAt: new Date("2026-04-05T23:29:30.000Z")
  };
}

function buildAssistantState(
  overrides: Partial<{
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }> = {}
) {
  return {
    id: "assistant-state-1",
    assistantId: "assistant-1",
    surface: "web_chat" as const,
    windowStartedAt: overrides.windowStartedAt ?? new Date("2026-04-05T23:29:30.000Z"),
    requestCount: overrides.requestCount ?? 1,
    slowedUntil: overrides.slowedUntil ?? null,
    blockedUntil: overrides.blockedUntil ?? null,
    blockReason: overrides.blockReason ?? null,
    adminOverrideUntil: overrides.adminOverrideUntil ?? null,
    lastSeenAt: overrides.lastSeenAt ?? new Date("2026-04-05T23:29:30.000Z"),
    createdAt: new Date("2026-04-05T23:29:30.000Z"),
    updatedAt: new Date("2026-04-05T23:29:30.000Z")
  };
}

function buildRawUserState() {
  return {
    id: "user-state-1",
    assistant_id: "assistant-1",
    user_id: "user-1",
    workspace_id: "ws-1",
    surface: "web_chat" as const,
    window_started_at: new Date("2026-04-05T23:29:30.000Z"),
    request_count: 1,
    slowed_until: null,
    blocked_until: null,
    block_reason: null,
    admin_override_until: null,
    last_seen_at: new Date("2026-04-05T23:29:30.000Z"),
    created_at: new Date("2026-04-05T23:29:30.000Z"),
    updated_at: new Date("2026-04-05T23:29:30.000Z")
  };
}

function buildRawAssistantState() {
  return {
    id: "assistant-state-1",
    assistant_id: "assistant-1",
    surface: "web_chat" as const,
    window_started_at: new Date("2026-04-05T23:29:30.000Z"),
    request_count: 1,
    slowed_until: null,
    blocked_until: null,
    block_reason: null,
    admin_override_until: null,
    last_seen_at: new Date("2026-04-05T23:29:30.000Z"),
    created_at: new Date("2026-04-05T23:29:30.000Z"),
    updated_at: new Date("2026-04-05T23:29:30.000Z")
  };
}

const assistantAbuseGuardState = {
  create: async ({ data }: { data: Record<string, unknown> }) =>
    buildUserState({
      windowStartedAt: data.windowStartedAt as Date,
      requestCount: data.requestCount as number,
      slowedUntil: data.slowedUntil as Date | null,
      blockedUntil: data.blockedUntil as Date | null,
      blockReason: data.blockReason as string | null,
      adminOverrideUntil: data.adminOverrideUntil as Date | null,
      lastSeenAt: data.lastSeenAt as Date
    }),
  update: async ({ data }: { data: Record<string, unknown> }) =>
    buildUserState({
      windowStartedAt: data.windowStartedAt as Date,
      requestCount: data.requestCount as number,
      slowedUntil: data.slowedUntil as Date | null,
      blockedUntil: data.blockedUntil as Date | null,
      blockReason: data.blockReason as string | null,
      adminOverrideUntil: data.adminOverrideUntil as Date | null,
      lastSeenAt: data.lastSeenAt as Date
    })
};

const assistantAbuseAssistantState = {
  create: async ({ data }: { data: Record<string, unknown> }) =>
    buildAssistantState({
      windowStartedAt: data.windowStartedAt as Date,
      requestCount: data.requestCount as number,
      slowedUntil: data.slowedUntil as Date | null,
      blockedUntil: data.blockedUntil as Date | null,
      blockReason: data.blockReason as string | null,
      adminOverrideUntil: data.adminOverrideUntil as Date | null,
      lastSeenAt: data.lastSeenAt as Date
    }),
  update: async ({ data }: { data: Record<string, unknown> }) =>
    buildAssistantState({
      windowStartedAt: data.windowStartedAt as Date,
      requestCount: data.requestCount as number,
      slowedUntil: data.slowedUntil as Date | null,
      blockedUntil: data.blockedUntil as Date | null,
      blockReason: data.blockReason as string | null,
      adminOverrideUntil: data.adminOverrideUntil as Date | null,
      lastSeenAt: data.lastSeenAt as Date
    })
};

async function runPeerDomainMapsSnakeCaseRawQueryResult(): Promise<void> {
  const now = new Date("2026-04-06T00:00:00.000Z");
  const repository = new PrismaAssistantAbuseGuardRepository({
    $queryRaw: async () => [
      {
        id: "peer-raw-1",
        assistant_id: "assistant-raw-1",
        surface: "telegram",
        peer_key: "thread-42",
        window_started_at: now,
        request_count: 3,
        admin_override_until: null,
        last_seen_at: now,
        created_at: now,
        updated_at: now
      }
    ]
  } as never);

  const result = await repository.registerPeerAttempt({
    assistantId: "assistant-raw-1",
    surface: "telegram",
    peerKey: "thread-42",
    attemptedAt: now,
    windowStartedAfter: new Date(now.getTime() - 60_000)
  });

  assert.equal(result.assistantId, "assistant-raw-1");
  assert.equal(result.peerKey, "thread-42");
  assert.equal(result.requestCount, 3);
  assert.equal(result.adminOverrideUntil, null);
  assert.deepEqual(result.windowStartedAt, now);
  assert.deepEqual(result.lastSeenAt, now);
}

async function runPeerDomainNormalizesUndefinedAdminOverrideToNull(): Promise<void> {
  const now = new Date("2026-04-06T00:00:00.000Z");
  const repository = new PrismaAssistantAbuseGuardRepository({
    $queryRaw: async () => [
      {
        id: "peer-undef-1",
        assistant_id: "assistant-undef-1",
        surface: "telegram",
        peer_key: "thread-99",
        window_started_at: now,
        request_count: 1,
        last_seen_at: now,
        created_at: now,
        updated_at: now
        // admin_override_until intentionally missing → undefined
      }
    ]
  } as never);

  const result = await repository.registerPeerAttempt({
    assistantId: "assistant-undef-1",
    surface: "telegram",
    peerKey: "thread-99",
    attemptedAt: now,
    windowStartedAfter: new Date(now.getTime() - 60_000)
  });

  assert.equal(result.adminOverrideUntil, null, "undefined must be normalized to null");
}

void runRetriesSerializableDistributedAttempt();
void runCreatesMissingDistributedRowsWithBootstrapWindow();
void runPeerDomainMapsSnakeCaseRawQueryResult();
void runPeerDomainNormalizesUndefinedAdminOverrideToNull();
