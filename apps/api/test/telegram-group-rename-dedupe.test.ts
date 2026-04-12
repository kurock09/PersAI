import assert from "node:assert/strict";
import { SyncTelegramGroupMembershipService } from "../src/modules/workspace-management/application/sync-telegram-group-membership.service";

async function run(): Promise<void> {
  const updateManyCalls: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  const previousAppEnv = process.env.APP_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousClerkSecretKey = process.env.CLERK_SECRET_KEY;
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = "test-clerk-secret";

  try {
    const service = new SyncTelegramGroupMembershipService({
      assistantTelegramGroup: {
        findUnique: async () => ({ title: "Bots" }),
        updateMany: async (input: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updateManyCalls.push(input);
          return { count: 1 };
        },
        upsert: async () => ({})
      }
    } as never);

    await service.execute({
      assistantId: "assistant-1",
      telegramChatId: "chat-1",
      title: "Alex, Jarvis и MASHA",
      event: "joined"
    });

    assert.equal(updateManyCalls.length, 1);
    assert.deepEqual(updateManyCalls[0]?.where.title, { in: ["Bots", "Alex, Jarvis и MASHA"] });
  } finally {
    if (previousAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousAppEnv;
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousClerkSecretKey === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = previousClerkSecretKey;
    }
  }

  console.log("telegram-group-rename-dedupe tests passed");
}

void run();
