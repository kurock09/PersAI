import assert from "node:assert/strict";
import { EnforceAbuseRateLimitService } from "../src/modules/workspace-management/application/enforce-abuse-rate-limit.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type {
  AssistantAbuseAssistantState,
  AssistantAbuseGuardState
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
  process.env.ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE = "2";
  process.env.ABUSE_USER_BLOCK_REQUESTS_PER_MINUTE = "6";
  process.env.ABUSE_ASSISTANT_SLOWDOWN_REQUESTS_PER_MINUTE = "10";
  process.env.ABUSE_ASSISTANT_BLOCK_REQUESTS_PER_MINUTE = "20";
  process.env.ABUSE_SLOWDOWN_SECONDS = "30";
  process.env.ABUSE_TEMP_BLOCK_SECONDS = "300";
  process.env.ABUSE_QUOTA_SLOWDOWN_PERCENT = "90";
  process.env.ABUSE_QUOTA_BLOCK_PERCENT = "100";
}

async function run(): Promise<void> {
  ensureApiConfigEnv();
  let userState: AssistantAbuseGuardState | null = null;
  let assistantState: AssistantAbuseAssistantState | null = null;
  const service = new EnforceAbuseRateLimitService(
    {
      findUserState: async () => userState,
      findAssistantState: async () => assistantState,
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
      applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 })
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
        lastComputedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    } as never
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
      applyAdminUnblock: async () => ({ userRows: 0, assistantRows: 0 })
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
    } as never
  );

  await service.enforceAndRegisterAttempt({
    assistant,
    surface: "web_chat"
  });

  assert.equal(userState?.blockedUntil, null);
  assert.equal(userState?.slowedUntil, null);
  assert.equal(userState?.blockReason, null);
}

void run();
void runQuotaPressurePersistedClearedWhenHealthy();
