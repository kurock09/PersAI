import assert from "node:assert/strict";
import { EnforceAbuseRateLimitService } from "../src/modules/workspace-management/application/enforce-abuse-rate-limit.service";
import type {
  RegisterDistributedAbuseAttemptInput,
  RegisterDistributedAbuseAttemptResult
} from "../src/modules/workspace-management/domain/assistant-abuse-guard.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type {
  AssistantAbuseAssistantState,
  AssistantAbuseGuardState,
  AssistantAbusePeerState
} from "../src/modules/workspace-management/domain/assistant-abuse-guard.entity";

const assistant: Assistant = {
  id: "assistant-abuse-1",
  userId: "user-abuse-1",
  workspaceId: "ws-abuse-1",
  draftDisplayName: null,
  draftInstructions: null,
  draftUpdatedAt: null,
  applyStatus: "succeeded",
  applyTargetVersionId: null,
  applyAppliedVersionId: null,
  applyRequestedAt: null,
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function ensureApiConfigEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://local:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "clerk_test_secret";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-api-token";
  process.env.ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE = "2";
  process.env.ABUSE_USER_BLOCK_REQUESTS_PER_MINUTE = "6";
  process.env.ABUSE_ASSISTANT_SLOWDOWN_REQUESTS_PER_MINUTE = "10";
  process.env.ABUSE_ASSISTANT_BLOCK_REQUESTS_PER_MINUTE = "20";
  process.env.ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE = "2";
  process.env.ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE = "4";
  process.env.ABUSE_SLOWDOWN_SECONDS = "30";
  process.env.ABUSE_TEMP_BLOCK_SECONDS = "300";
  process.env.ABUSE_QUOTA_SLOWDOWN_PERCENT = "90";
  process.env.ABUSE_QUOTA_BLOCK_PERCENT = "100";
}

function buildPeerState(input: {
  assistantId: string;
  surface: "web_chat" | "telegram" | "whatsapp" | "max";
  peerKey: string;
  requestCount: number;
  attemptedAt: Date;
  adminOverrideUntil?: Date | null;
}): AssistantAbusePeerState {
  return {
    id: `${input.assistantId}:${input.surface}:${input.peerKey}`,
    assistantId: input.assistantId,
    surface: input.surface,
    peerKey: input.peerKey,
    windowStartedAt: input.attemptedAt,
    requestCount: input.requestCount,
    adminOverrideUntil: input.adminOverrideUntil ?? null,
    lastSeenAt: input.attemptedAt,
    createdAt: input.attemptedAt,
    updatedAt: input.attemptedAt
  };
}

function trackLimitsMatchingQuotaRepo(
  tokenLimit: bigint,
  toolLimit: number
): TrackWorkspaceQuotaUsageStub {
  return {
    resolveEffectiveLimitsForAssistant: async () => ({
      tokenBudgetLimit: tokenLimit,
      costOrTokenDrivingToolClassUnitsLimit: toolLimit,
      activeWebChatsLimit: 20,
      mediaStorageBytesLimit: BigInt(104_857_600)
    })
  };
}

type TrackWorkspaceQuotaUsageStub = {
  resolveEffectiveLimitsForAssistant: (assistant: Assistant) => Promise<{
    tokenBudgetLimit: bigint | null;
    costOrTokenDrivingToolClassUnitsLimit: number | null;
    activeWebChatsLimit: number | null;
    mediaStorageBytesLimit: bigint | null;
  }>;
};

async function run(): Promise<void> {
  ensureApiConfigEnv();
  let userState: AssistantAbuseGuardState | null = null;
  let assistantState: AssistantAbuseAssistantState | null = null;
  let distributedAttemptCount = 0;
  const service = new EnforceAbuseRateLimitService(
    {
      findUserState: async () => userState,
      findAssistantState: async () => assistantState,
      registerPeerAttempt: async ({ assistantId, surface, peerKey, attemptedAt }) =>
        buildPeerState({
          assistantId,
          surface,
          peerKey,
          requestCount: 1,
          attemptedAt
        }),
      registerDistributedAttempt: async (
        input: RegisterDistributedAbuseAttemptInput
      ): Promise<RegisterDistributedAbuseAttemptResult> => {
        distributedAttemptCount += 1;
        const finalBlockedUntil = null;
        const finalSlowedUntil =
          distributedAttemptCount >= input.userSlowdownRequestsPerMinute
            ? new Date(input.attemptedAt.getTime() + input.slowdownSeconds * 1000)
            : null;
        userState = {
          id: "user-state-1",
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          surface: input.surface,
          windowStartedAt: input.attemptedAt,
          requestCount: distributedAttemptCount,
          slowedUntil: finalSlowedUntil,
          blockedUntil: finalBlockedUntil,
          blockReason: finalSlowedUntil ? "user_request_rate_limit_slowdown" : null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        assistantState = {
          id: "assistant-state-1",
          assistantId: input.assistantId,
          surface: input.surface,
          windowStartedAt: input.attemptedAt,
          requestCount: distributedAttemptCount,
          slowedUntil: finalSlowedUntil,
          blockedUntil: finalBlockedUntil,
          blockReason: finalSlowedUntil ? "user_request_rate_limit_slowdown" : null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return {
          userState,
          assistantState,
          userBypass: false,
          assistantBypass: false,
          finalBlockedUntil,
          finalSlowedUntil,
          finalReason: finalSlowedUntil ? "user_request_rate_limit_slowdown" : null
        };
      },
      upsertUserState: async (input) => {
        userState = {
          id: "user-state-1",
          ...input,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return userState;
      },
      upsertAssistantState: async (input) => {
        assistantState = {
          id: "assistant-state-1",
          ...input,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return assistantState;
      },
      applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 }),
      applyPeerAdminUnblock: async () => 0
    } as never,
    {
      findByWorkspaceId: async () => ({
        id: "quota-1",
        workspaceId: assistant.workspaceId,
        tokenBudgetUsed: BigInt(100),
        tokenBudgetLimit: BigInt(1000),
        costOrTokenDrivingToolClassUnitsUsed: 10,
        costOrTokenDrivingToolClassUnitsLimit: 1000,
        activeWebChatsCurrent: 0,
        activeWebChatsLimit: 20,
        mediaStorageBytesUsed: BigInt(0),
        mediaStorageBytesLimit: BigInt(104_857_600),
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    } as never,
    trackLimitsMatchingQuotaRepo(BigInt(1000), 1000) as never
  );

  await service.enforceAndRegisterAttempt({
    assistant,
    surface: "web_chat"
  });

  let threw = false;
  try {
    await service.enforceAndRegisterAttempt({
      assistant,
      surface: "web_chat"
    });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
}

async function runQuotaPressurePersistedClearedWhenHealthy(): Promise<void> {
  ensureApiConfigEnv();
  const future = new Date(Date.now() + 3_600_000);
  let userState: AssistantAbuseGuardState | null = {
    id: "user-state-quota",
    assistantId: assistant.id,
    userId: assistant.userId,
    workspaceId: assistant.workspaceId,
    surface: "web_chat",
    windowStartedAt: new Date(Date.now() - 120_000),
    requestCount: 1,
    slowedUntil: null,
    blockedUntil: future,
    blockReason: "quota_pressure_temporary_block",
    adminOverrideUntil: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  let assistantState: AssistantAbuseAssistantState | null = null;
  const service = new EnforceAbuseRateLimitService(
    {
      findUserState: async () => userState,
      findAssistantState: async () => assistantState,
      registerPeerAttempt: async ({ assistantId, surface, peerKey, attemptedAt }) =>
        buildPeerState({
          assistantId,
          surface,
          peerKey,
          requestCount: 1,
          attemptedAt
        }),
      registerDistributedAttempt: async (
        input: RegisterDistributedAbuseAttemptInput
      ): Promise<RegisterDistributedAbuseAttemptResult> => {
        userState = {
          id: "user-state-quota",
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          surface: input.surface,
          windowStartedAt: input.attemptedAt,
          requestCount: 1,
          slowedUntil: null,
          blockedUntil: null,
          blockReason: null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        assistantState = {
          id: "assistant-state-quota",
          assistantId: input.assistantId,
          surface: input.surface,
          windowStartedAt: input.attemptedAt,
          requestCount: 1,
          slowedUntil: null,
          blockedUntil: null,
          blockReason: null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return {
          userState,
          assistantState,
          userBypass: false,
          assistantBypass: false,
          finalBlockedUntil: null,
          finalSlowedUntil: null,
          finalReason: null
        };
      },
      upsertUserState: async (input) => {
        userState = {
          id: "user-state-quota",
          ...input,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return userState;
      },
      upsertAssistantState: async (input) => {
        assistantState = {
          id: "assistant-state-quota",
          ...input,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return assistantState;
      },
      applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 }),
      applyPeerAdminUnblock: async () => 0
    } as never,
    {
      findByWorkspaceId: async () => ({
        id: "quota-healthy",
        workspaceId: assistant.workspaceId,
        tokenBudgetUsed: BigInt(1),
        tokenBudgetLimit: BigInt(1_000_000),
        costOrTokenDrivingToolClassUnitsUsed: 0,
        costOrTokenDrivingToolClassUnitsLimit: 1000,
        activeWebChatsCurrent: 0,
        activeWebChatsLimit: 20,
        mediaStorageBytesUsed: BigInt(0),
        mediaStorageBytesLimit: BigInt(1_000_000),
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    } as never,
    trackLimitsMatchingQuotaRepo(BigInt(1_000_000), 1_000_000) as never
  );

  await service.enforceAndRegisterAttempt({
    assistant,
    surface: "web_chat"
  });

  assert.equal(userState?.blockedUntil, null);
  assert.equal(userState?.slowedUntil, null);
  assert.equal(userState?.blockReason, null);
}

async function runQuotaPressureUsesEffectivePlanLimitsNotStaleSnapshot(): Promise<void> {
  ensureApiConfigEnv();
  let userState: AssistantAbuseGuardState | null = null;
  let assistantState: AssistantAbuseAssistantState | null = null;
  const service = new EnforceAbuseRateLimitService(
    {
      findUserState: async () => userState,
      findAssistantState: async () => assistantState,
      registerPeerAttempt: async ({ assistantId, surface, peerKey, attemptedAt }) =>
        buildPeerState({
          assistantId,
          surface,
          peerKey,
          requestCount: 1,
          attemptedAt
        }),
      registerDistributedAttempt: async (
        input: RegisterDistributedAbuseAttemptInput
      ): Promise<RegisterDistributedAbuseAttemptResult> => {
        userState = {
          id: "user-state-stale",
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          surface: input.surface,
          windowStartedAt: input.attemptedAt,
          requestCount: 1,
          slowedUntil: null,
          blockedUntil: null,
          blockReason: null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        assistantState = {
          id: "assistant-state-stale",
          assistantId: input.assistantId,
          surface: input.surface,
          windowStartedAt: input.attemptedAt,
          requestCount: 1,
          slowedUntil: null,
          blockedUntil: null,
          blockReason: null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return {
          userState,
          assistantState,
          userBypass: false,
          assistantBypass: false,
          finalBlockedUntil: null,
          finalSlowedUntil: null,
          finalReason: null
        };
      },
      upsertUserState: async (input) => {
        userState = {
          id: "user-state-stale",
          ...input,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return userState;
      },
      upsertAssistantState: async (input) => {
        assistantState = {
          id: "assistant-state-stale",
          ...input,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        return assistantState;
      },
      applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 }),
      applyPeerAdminUnblock: async () => 0
    } as never,
    {
      findByWorkspaceId: async () => ({
        id: "quota-stale-snapshot",
        workspaceId: assistant.workspaceId,
        tokenBudgetUsed: BigInt(500),
        tokenBudgetLimit: BigInt(1000),
        costOrTokenDrivingToolClassUnitsUsed: 90,
        costOrTokenDrivingToolClassUnitsLimit: 100,
        activeWebChatsCurrent: 0,
        activeWebChatsLimit: 20,
        mediaStorageBytesUsed: BigInt(0),
        mediaStorageBytesLimit: BigInt(104_857_600),
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    } as never,
    {
      resolveEffectiveLimitsForAssistant: async () => ({
        tokenBudgetLimit: BigInt(10_000),
        costOrTokenDrivingToolClassUnitsLimit: 1000,
        activeWebChatsLimit: 20,
        mediaStorageBytesLimit: BigInt(104_857_600)
      })
    } as never
  );

  await service.enforceAndRegisterAttempt({
    assistant,
    surface: "web_chat"
  });
}

async function runPeerLimitPersistsAcrossServiceInstances(): Promise<void> {
  ensureApiConfigEnv();
  const peerStates = new Map<string, AssistantAbusePeerState>();
  const repository = {
    findUserState: async () => null,
    findAssistantState: async () => null,
    registerPeerAttempt: async ({
      assistantId,
      surface,
      peerKey,
      attemptedAt
    }: {
      assistantId: string;
      surface: "web_chat" | "telegram" | "whatsapp" | "max";
      peerKey: string;
      attemptedAt: Date;
      windowStartedAfter: Date;
    }) => {
      const key = `${assistantId}:${surface}:${peerKey}`;
      const existing = peerStates.get(key);
      const next = buildPeerState({
        assistantId,
        surface,
        peerKey,
        requestCount: (existing?.requestCount ?? 0) + 1,
        attemptedAt
      });
      peerStates.set(key, next);
      return next;
    },
    registerDistributedAttempt: async (
      input: RegisterDistributedAbuseAttemptInput
    ): Promise<RegisterDistributedAbuseAttemptResult> => {
      const count = (peerStates.get("distributed-user")?.requestCount ?? 0) + 1;
      const user = {
        id: "distributed-user",
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        windowStartedAt: input.attemptedAt,
        requestCount: count,
        slowedUntil:
          count >= input.userSlowdownRequestsPerMinute
            ? new Date(input.attemptedAt.getTime() + input.slowdownSeconds * 1000)
            : null,
        blockedUntil:
          count >= input.userBlockRequestsPerMinute
            ? new Date(input.attemptedAt.getTime() + input.tempBlockSeconds * 1000)
            : null,
        blockReason:
          count >= input.userBlockRequestsPerMinute
            ? "user_request_rate_limit_blocked"
            : count >= input.userSlowdownRequestsPerMinute
              ? "user_request_rate_limit_slowdown"
              : null,
        adminOverrideUntil: null,
        lastSeenAt: input.attemptedAt,
        createdAt: input.attemptedAt,
        updatedAt: input.attemptedAt
      } satisfies AssistantAbuseGuardState;
      const assistantAggregate = {
        id: "distributed-assistant",
        assistantId: input.assistantId,
        surface: input.surface,
        windowStartedAt: input.attemptedAt,
        requestCount: count,
        slowedUntil: user.slowedUntil,
        blockedUntil: user.blockedUntil,
        blockReason: user.blockReason,
        adminOverrideUntil: null,
        lastSeenAt: input.attemptedAt,
        createdAt: input.attemptedAt,
        updatedAt: input.attemptedAt
      } satisfies AssistantAbuseAssistantState;
      peerStates.set(
        "distributed-user",
        buildPeerState({
          assistantId: input.assistantId,
          surface: input.surface,
          peerKey: "distributed-user",
          requestCount: count,
          attemptedAt: input.attemptedAt
        })
      );
      return {
        userState: user,
        assistantState: assistantAggregate,
        userBypass: false,
        assistantBypass: false,
        finalBlockedUntil: user.blockedUntil,
        finalSlowedUntil: user.slowedUntil,
        finalReason: user.blockReason
      };
    },
    upsertUserState: async (
      input: Omit<AssistantAbuseGuardState, "id" | "createdAt" | "updatedAt">
    ) => ({
      id: "user-state-peer",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date()
    }),
    upsertAssistantState: async (
      input: Omit<AssistantAbuseAssistantState, "id" | "createdAt" | "updatedAt">
    ) => ({
      id: "assistant-state-peer",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date()
    }),
    applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 }),
    applyPeerAdminUnblock: async () => 0
  };
  const quotaRepository = {
    findByWorkspaceId: async () => ({
      id: "quota-peer",
      workspaceId: assistant.workspaceId,
      tokenBudgetUsed: BigInt(100),
      tokenBudgetLimit: BigInt(1000),
      costOrTokenDrivingToolClassUnitsUsed: 10,
      costOrTokenDrivingToolClassUnitsLimit: 1000,
      activeWebChatsCurrent: 0,
      activeWebChatsLimit: 20,
      mediaStorageBytesUsed: BigInt(0),
      mediaStorageBytesLimit: BigInt(104_857_600),
      lastComputedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    })
  };

  const firstService = new EnforceAbuseRateLimitService(
    repository as never,
    quotaRepository as never,
    trackLimitsMatchingQuotaRepo(BigInt(1000), 1000) as never
  );
  const secondService = new EnforceAbuseRateLimitService(
    repository as never,
    quotaRepository as never,
    trackLimitsMatchingQuotaRepo(BigInt(1000), 1000) as never
  );

  await firstService.enforceAndRegisterAttempt({
    assistant,
    surface: "telegram",
    peerKey: "thread-1"
  });

  let threw = false;
  try {
    await secondService.enforceAndRegisterAttempt({
      assistant,
      surface: "telegram",
      peerKey: "thread-1"
    });
  } catch {
    threw = true;
  }

  assert.equal(threw, true);
}

async function runDistributedAbuseLimitPersistsAcrossServiceInstances(): Promise<void> {
  ensureApiConfigEnv();
  process.env.ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE = "2";

  const distributedCounts = new Map<string, number>();
  const repository = {
    findUserState: async () => null,
    findAssistantState: async () => null,
    registerPeerAttempt: async ({ assistantId, surface, peerKey, attemptedAt }) =>
      buildPeerState({
        assistantId,
        surface,
        peerKey,
        requestCount: 1,
        attemptedAt
      }),
    registerDistributedAttempt: async (
      input: RegisterDistributedAbuseAttemptInput
    ): Promise<RegisterDistributedAbuseAttemptResult> => {
      const key = `${input.assistantId}:${input.userId}:${input.surface}`;
      const nextCount = (distributedCounts.get(key) ?? 0) + 1;
      distributedCounts.set(key, nextCount);
      const slowedUntil =
        nextCount >= input.userSlowdownRequestsPerMinute
          ? new Date(input.attemptedAt.getTime() + input.slowdownSeconds * 1000)
          : null;
      const userState: AssistantAbuseGuardState = {
        id: "user-state-distributed",
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        windowStartedAt: input.attemptedAt,
        requestCount: nextCount,
        slowedUntil,
        blockedUntil: null,
        blockReason: slowedUntil ? "user_request_rate_limit_slowdown" : null,
        adminOverrideUntil: null,
        lastSeenAt: input.attemptedAt,
        createdAt: input.attemptedAt,
        updatedAt: input.attemptedAt
      };
      const assistantState: AssistantAbuseAssistantState = {
        id: "assistant-state-distributed",
        assistantId: input.assistantId,
        surface: input.surface,
        windowStartedAt: input.attemptedAt,
        requestCount: nextCount,
        slowedUntil,
        blockedUntil: null,
        blockReason: slowedUntil ? "user_request_rate_limit_slowdown" : null,
        adminOverrideUntil: null,
        lastSeenAt: input.attemptedAt,
        createdAt: input.attemptedAt,
        updatedAt: input.attemptedAt
      };
      return {
        userState,
        assistantState,
        userBypass: false,
        assistantBypass: false,
        finalBlockedUntil: null,
        finalSlowedUntil: slowedUntil,
        finalReason: slowedUntil ? "user_request_rate_limit_slowdown" : null
      };
    },
    upsertUserState: async (
      input: Omit<AssistantAbuseGuardState, "id" | "createdAt" | "updatedAt">
    ) => ({
      id: "unused-user-state",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date()
    }),
    upsertAssistantState: async (
      input: Omit<AssistantAbuseAssistantState, "id" | "createdAt" | "updatedAt">
    ) => ({
      id: "unused-assistant-state",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date()
    }),
    applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 }),
    applyPeerAdminUnblock: async () => 0
  };
  const quotaRepository = {
    findByWorkspaceId: async () => ({
      id: "quota-distributed",
      workspaceId: assistant.workspaceId,
      tokenBudgetUsed: BigInt(100),
      tokenBudgetLimit: BigInt(1000),
      costOrTokenDrivingToolClassUnitsUsed: 10,
      costOrTokenDrivingToolClassUnitsLimit: 1000,
      activeWebChatsCurrent: 0,
      activeWebChatsLimit: 20,
      mediaStorageBytesUsed: BigInt(0),
      mediaStorageBytesLimit: BigInt(104_857_600),
      lastComputedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    })
  };

  const firstService = new EnforceAbuseRateLimitService(
    repository as never,
    quotaRepository as never,
    trackLimitsMatchingQuotaRepo(BigInt(1000), 1000) as never
  );
  const secondService = new EnforceAbuseRateLimitService(
    repository as never,
    quotaRepository as never,
    trackLimitsMatchingQuotaRepo(BigInt(1000), 1000) as never
  );

  await firstService.enforceAndRegisterAttempt({
    assistant,
    surface: "web_chat"
  });

  let threw = false;
  try {
    await secondService.enforceAndRegisterAttempt({
      assistant,
      surface: "web_chat"
    });
  } catch {
    threw = true;
  }

  assert.equal(threw, true);
}

void run();
void runQuotaPressurePersistedClearedWhenHealthy();
void runQuotaPressureUsesEffectivePlanLimitsNotStaleSnapshot();
void runPeerLimitPersistsAcrossServiceInstances();
void runDistributedAbuseLimitPersistsAcrossServiceInstances();
