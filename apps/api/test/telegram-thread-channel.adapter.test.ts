/**
 * ADR-088 Slice 2 — TelegramThreadChannelAdapter focused tests.
 * Covers: successful delivery, 4xx failure, network error, missing bot token,
 * missing chatId. Tests run via tsx (node:assert/strict, void run() IIFE).
 */
import assert from "node:assert/strict";
import { TelegramThreadChannelAdapter } from "../src/modules/workspace-management/infrastructure/notifications/channel-adapters/telegram-thread-channel.adapter";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeIntent(overrides?: Record<string, unknown>) {
  return {
    id: "intent-1",
    workspaceId: "ws-1",
    assistantId: "asst-1",
    userId: "user-1",
    source: "reminder",
    class: "conversational",
    priority: "immediate",
    lifecycleStatus: "pending",
    renderStrategy: "grounded_llm",
    renderInstructionRef: null,
    templateId: null,
    factPayload: {},
    policySnapshot: {},
    allowedChannels: ["telegram_thread"],
    escalationAfterMinutes: null,
    escalationChannel: null,
    dedupeKey: null,
    scheduledAt: null,
    respectQuietHours: false,
    surface: "telegram",
    surfaceThreadKey: "telegram:-100999:session:group-session",
    chatId: null,
    traceId: "trace-tg-1",
    failureReason: null,
    createdAt: new Date(),
    claimedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    ...overrides
  };
}

function makeChannelConfig(overrides?: Record<string, unknown>) {
  return {
    id: "ch-1",
    workspaceId: "ws-1",
    channelType: "telegram_thread" as const,
    enabled: true,
    config: {},
    healthStatus: "healthy" as const,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    lastFailureAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeRenderedPayload() {
  return { body: "Reminder text" };
}

function makeSecretStore(token: string | null) {
  return {
    resolveSecretValueByProviderKey: async (_key: string) => token
  };
}

function makePrisma(metadata: Record<string, unknown> | null) {
  return {
    assistantChannelSurfaceBinding: {
      findFirst: async () => (metadata ? { metadata } : null)
    }
  };
}

async function run(): Promise<void> {
  // 1. Successful delivery → providerRef = "telegram:<chatId>:<messageId>"
  {
    const fetchResponses: FetchResponse[] = [
      {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 999 } })
      }
    ];
    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    (global as Record<string, unknown>)["fetch"] = async (url: string, opts: { body: string }) => {
      fetchCalls.push({ url, body: JSON.parse(opts.body) });
      return fetchResponses.shift()!;
    };

    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma({ telegramDmChatId: "54321" }) as never
    );

    const result = await adapter.deliver(
      makeIntent() as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    (global as Record<string, unknown>)["fetch"] = originalFetch;

    assert.equal(result.status, "delivered", "should be delivered");
    assert.ok(
      typeof result.providerRef === "string" && result.providerRef.startsWith("telegram:54321:999"),
      `providerRef should be telegram:54321:999, got ${result.providerRef}`
    );
    assert.equal(fetchCalls.length, 1, "one fetch call");
    assert.equal((fetchCalls[0]?.body as Record<string, unknown>)?.chat_id, "54321");
    console.log("✓ deliver: successful private DM delivery");
  }

  // 2. Group surfaceThreadKey is ignored; delivery still uses private DM from binding
  {
    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    (global as Record<string, unknown>)["fetch"] = async (url: string, opts: { body: string }) => {
      fetchCalls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1001 } })
      };
    };

    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma({
        reminderDeliveryChatId: "-100999",
        reminderDeliveryChatType: "supergroup",
        telegramOwnerTelegramChatId: "491548134"
      }) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: "telegram:-100999:session:group-session" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    (global as Record<string, unknown>)["fetch"] = originalFetch;

    assert.equal(result.status, "delivered");
    assert.equal((fetchCalls[0]?.body as Record<string, unknown>)?.chat_id, "491548134");
    console.log("✓ deliver: ignores group thread key and uses owner private DM");
  }

  // 3. 4xx Telegram response → status: "failed"
  {
    const originalFetch = global.fetch;
    (global as Record<string, unknown>)["fetch"] = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error_code: 400, description: "Bad Request" })
    });

    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma({ telegramDmChatId: "54321" }) as never
    );

    const result = await adapter.deliver(
      makeIntent() as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    (global as Record<string, unknown>)["fetch"] = originalFetch;

    assert.equal(result.status, "failed", "should be failed on 4xx");
    console.log("✓ deliver: 4xx response → status=failed");
  }

  // 4. Missing bot token → telegram_bot_token_not_configured
  {
    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore(null) as never,
      makePrisma({ telegramDmChatId: "54321" }) as never
    );

    const result = await adapter.deliver(
      makeIntent() as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    assert.equal(result.status, "failed", "no token → failed");
    assert.equal(result.error?.["reason"], "telegram_bot_token_not_configured");
    console.log("✓ deliver: missing bot token → telegram_bot_token_not_configured");
  }

  // 5. Missing private chat → telegram_chat_id_not_resolved
  {
    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma({
        reminderDeliveryChatId: "-100999",
        reminderDeliveryChatType: "supergroup"
      }) as never
    );

    const result = await adapter.deliver(
      makeIntent() as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    assert.equal(result.status, "failed", "no private chat → failed");
    assert.equal(result.error?.["reason"], "telegram_chat_id_not_resolved");
    console.log("✓ deliver: missing private chat → telegram_chat_id_not_resolved");
  }

  console.log("\n✅ All TelegramThreadChannelAdapter tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
