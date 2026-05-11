/**
 * ADR-088 Slice 2 — TelegramThreadChannelAdapter focused tests.
 * Covers: successful delivery, 4xx failure, network error, missing bot token,
 * missing chatId. Tests run via tsx (node:assert/strict, void run() IIFE).
 */
import assert from "node:assert/strict";
import { TelegramThreadChannelAdapter } from "../src/modules/workspace-management/infrastructure/notifications/channel-adapters/telegram-thread-channel.adapter";

// ── Helpers ────────────────────────────────────────────────────────────────

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
    surfaceThreadKey: "12345",
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

function makePrisma(chatId: string | null) {
  return {
    assistantChannelSurfaceBinding: {
      findFirst: async () => (chatId ? { metadata: { telegramDmChatId: chatId } } : null)
    }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

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
      makePrisma(null) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: "54321" }) as never,
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
    assert.ok((fetchCalls[0]!.url as string).includes("bot-token-123"), "bot token in URL");
    console.log("✓ deliver: successful → providerRef telegram:<chatId>:<messageId>");
  }

  // 2. 4xx Telegram response → status: "failed", error includes httpStatus
  {
    const originalFetch = global.fetch;
    (global as Record<string, unknown>)["fetch"] = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error_code: 400, description: "Bad Request" })
    });

    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma(null) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: "54321" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    (global as Record<string, unknown>)["fetch"] = originalFetch;

    assert.equal(result.status, "failed", "should be failed on 4xx");
    assert.ok(result.error != null, "error present");
    assert.ok(
      "httpStatus" in result.error! || "reason" in result.error!,
      "error has errorCode or reason"
    );
    console.log("✓ deliver: 4xx response → status=failed, error present");
  }

  // 2.1 Runtime thread key should resolve to the underlying Telegram chat id.
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
      makePrisma(null) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: "telegram:54321:session:rotated-session" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    (global as Record<string, unknown>)["fetch"] = originalFetch;

    assert.equal(result.status, "delivered", "runtime thread key should still deliver");
    assert.equal(
      (fetchCalls[0]?.body as Record<string, unknown>)?.chat_id,
      "54321",
      "adapter should unwrap runtime thread key back to Telegram chat id"
    );
    console.log("✓ deliver: runtime thread key resolves to Telegram chat id");
  }

  // 3. Network fetch rejection → status: "failed"
  {
    const originalFetch = global.fetch;
    (global as Record<string, unknown>)["fetch"] = async () => {
      throw new Error("Network unreachable");
    };

    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma(null) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: "54321" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    (global as Record<string, unknown>)["fetch"] = originalFetch;

    assert.equal(result.status, "failed", "network error → failed");
    console.log("✓ deliver: network rejection → status=failed");
  }

  // 4. Missing bot token → status: "failed", reason telegram_bot_token_not_configured
  {
    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore(null) as never,
      makePrisma(null) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: "54321" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    assert.equal(result.status, "failed", "no token → failed");
    assert.ok(
      result.error?.["reason"] === "telegram_bot_token_not_configured",
      `reason should be telegram_bot_token_not_configured, got ${result.error?.["reason"]}`
    );
    console.log("✓ deliver: missing bot token → telegram_bot_token_not_configured");
  }

  // 5. Missing chatId (no surfaceThreadKey, no configChatId, no binding) → status: "failed"
  //    reason: telegram_chat_id_not_resolved
  {
    const adapter = new TelegramThreadChannelAdapter(
      makeSecretStore("bot-token-123") as never,
      makePrisma(null) as never
    );

    const result = await adapter.deliver(
      makeIntent({ surfaceThreadKey: null, assistantId: null }) as never,
      makeRenderedPayload(),
      makeChannelConfig({ config: {} })
    );

    assert.equal(result.status, "failed", "no chatId → failed");
    assert.ok(
      result.error?.["reason"] === "telegram_chat_id_not_resolved",
      `reason should be telegram_chat_id_not_resolved, got ${result.error?.["reason"]}`
    );
    console.log("✓ deliver: missing chatId → telegram_chat_id_not_resolved");
  }

  console.log("\n✅ All TelegramThreadChannelAdapter tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
