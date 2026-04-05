import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaAssistantAbuseGuardRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-assistant-abuse-guard.repository";

const attemptedAt = new Date("2026-04-05T23:30:00.000Z");

async function runRetriesSerializableDistributedAttempt(): Promise<void> {
  let transactionCalls = 0;
  const repository = new PrismaAssistantAbuseGuardRepository({
    $transaction: async (
      callback: (tx: {
        assistantAbuseGuardState: {
          findUnique: typeof assistantAbuseGuardState.findUnique;
          upsert: typeof assistantAbuseGuardState.upsert;
        };
        assistantAbuseAssistantState: {
          findUnique: typeof assistantAbuseAssistantState.findUnique;
          upsert: typeof assistantAbuseAssistantState.upsert;
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
  assert.equal(result.userState.requestCount, 2);
  assert.equal(result.assistantState.requestCount, 2);
  assert.equal(result.finalReason, "user_request_rate_limit_slowdown");
  assert.notEqual(result.finalSlowedUntil, null);
}

const assistantAbuseGuardState = {
  findUnique: async () => ({
    id: "user-state-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    surface: "web_chat" as const,
    windowStartedAt: new Date("2026-04-05T23:29:30.000Z"),
    requestCount: 1,
    slowedUntil: null,
    blockedUntil: null,
    blockReason: null,
    adminOverrideUntil: null,
    lastSeenAt: new Date("2026-04-05T23:29:30.000Z"),
    createdAt: new Date("2026-04-05T23:29:30.000Z"),
    updatedAt: new Date("2026-04-05T23:29:30.000Z")
  }),
  upsert: async ({
    create,
    update
  }: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => ({
    id: "user-state-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    surface: "web_chat" as const,
    windowStartedAt: (update.windowStartedAt ?? create.windowStartedAt) as Date,
    requestCount: (update.requestCount ?? create.requestCount) as number,
    slowedUntil: (update.slowedUntil ?? create.slowedUntil) as Date | null,
    blockedUntil: (update.blockedUntil ?? create.blockedUntil) as Date | null,
    blockReason: (update.blockReason ?? create.blockReason) as string | null,
    adminOverrideUntil: (update.adminOverrideUntil ?? create.adminOverrideUntil) as Date | null,
    lastSeenAt: (update.lastSeenAt ?? create.lastSeenAt) as Date,
    createdAt: attemptedAt,
    updatedAt: attemptedAt
  })
};

const assistantAbuseAssistantState = {
  findUnique: async () => ({
    id: "assistant-state-1",
    assistantId: "assistant-1",
    surface: "web_chat" as const,
    windowStartedAt: new Date("2026-04-05T23:29:30.000Z"),
    requestCount: 1,
    slowedUntil: null,
    blockedUntil: null,
    blockReason: null,
    adminOverrideUntil: null,
    lastSeenAt: new Date("2026-04-05T23:29:30.000Z"),
    createdAt: new Date("2026-04-05T23:29:30.000Z"),
    updatedAt: new Date("2026-04-05T23:29:30.000Z")
  }),
  upsert: async ({
    create,
    update
  }: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => ({
    id: "assistant-state-1",
    assistantId: "assistant-1",
    surface: "web_chat" as const,
    windowStartedAt: (update.windowStartedAt ?? create.windowStartedAt) as Date,
    requestCount: (update.requestCount ?? create.requestCount) as number,
    slowedUntil: (update.slowedUntil ?? create.slowedUntil) as Date | null,
    blockedUntil: (update.blockedUntil ?? create.blockedUntil) as Date | null,
    blockReason: (update.blockReason ?? create.blockReason) as string | null,
    adminOverrideUntil: (update.adminOverrideUntil ?? create.adminOverrideUntil) as Date | null,
    lastSeenAt: (update.lastSeenAt ?? create.lastSeenAt) as Date,
    createdAt: attemptedAt,
    updatedAt: attemptedAt
  })
};

void runRetriesSerializableDistributedAttempt();
