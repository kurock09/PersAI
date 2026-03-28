import assert from "node:assert/strict";
import { InternalRuntimeConfigGenerationController } from "../src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller";

async function run(): Promise<void> {
  const updateManyCalls: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  const previousGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const previousAppEnv = process.env.APP_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousClerkSecretKey = process.env.CLERK_SECRET_KEY;
  process.env.OPENCLAW_GATEWAY_TOKEN = "test-token";
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = "test-clerk-secret";

  try {
    const controller = new InternalRuntimeConfigGenerationController(
      { current: async () => 1 } as never,
      { findById: async () => null } as never,
      { findLatestByAssistantId: async () => null } as never,
      { findLatestByAssistantId: async () => null } as never,
      { execute: async () => undefined } as never,
      {
        parseInput: () => ({ assistantId: "assistant-1" }),
        execute: async () => undefined
      } as never,
      {
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
      } as never
    );

    const response = await controller.handleTelegramGroupUpdate(
      { headers: { authorization: "Bearer test-token" } },
      {
        assistantId: "assistant-1",
        telegramChatId: "chat-1",
        title: "Alex, Jarvis и MASHA",
        event: "joined"
      }
    );

    assert.deepEqual(response, { ok: true });
    assert.equal(updateManyCalls.length, 1);
    assert.deepEqual(updateManyCalls[0]?.where.title, { in: ["Bots", "Alex, Jarvis и MASHA"] });
  } finally {
    if (previousGatewayToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = previousGatewayToken;
    }
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
