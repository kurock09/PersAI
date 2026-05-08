/**
 * ADR-088 Slice 2 — WebThreadChannelAdapter focused tests.
 * Covers: successful delivery, missing chatId, createMessage throws.
 * Tests run via tsx (node:assert/strict, void run() IIFE).
 */
import assert from "node:assert/strict";
import { WebThreadChannelAdapter } from "../src/modules/workspace-management/infrastructure/notifications/channel-adapters/web-thread-channel.adapter";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeIntent(overrides?: Record<string, unknown>) {
  return {
    id: "intent-wt-1",
    workspaceId: "ws-1",
    assistantId: "asst-1",
    userId: "user-1",
    source: "quota_advisory",
    class: "conversational",
    priority: "immediate",
    lifecycleStatus: "pending",
    renderStrategy: "grounded_llm",
    renderInstructionRef: null,
    templateId: null,
    factPayload: {},
    policySnapshot: {},
    allowedChannels: ["web_thread"],
    escalationAfterMinutes: null,
    escalationChannel: null,
    dedupeKey: null,
    scheduledAt: null,
    respectQuietHours: false,
    surface: "web",
    surfaceThreadKey: "thread-key-abc",
    chatId: "chat-1",
    traceId: "trace-wt-1",
    failureReason: null,
    createdAt: new Date(),
    claimedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    ...overrides
  };
}

function makeChannelConfig() {
  return {
    id: "ch-wt-1",
    workspaceId: "ws-1",
    channelType: "web_thread" as const,
    enabled: true,
    config: {},
    healthStatus: "healthy" as const,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    lastFailureAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function makeRenderedPayload() {
  return { body: "Quota advisory text" };
}

function makeChatRepository(opts?: { messageId?: string; shouldThrow?: Error }) {
  return {
    createMessage: async (_input: unknown) => {
      if (opts?.shouldThrow) throw opts.shouldThrow;
      return { id: opts?.messageId ?? "msg-1" };
    }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Successful delivery → providerRef = "web_thread:<chatId>:<messageId>"
  {
    const repo = makeChatRepository({ messageId: "msg-1" });
    const adapter = new WebThreadChannelAdapter(repo as never);

    const result = await adapter.deliver(
      makeIntent({ chatId: "chat-1", assistantId: "asst-1" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    assert.equal(result.status, "delivered", "should be delivered");
    assert.equal(
      result.providerRef,
      "web_thread:chat-1:msg-1",
      `providerRef should be web_thread:chat-1:msg-1, got ${result.providerRef}`
    );
    console.log("✓ deliver: successful → providerRef web_thread:<chatId>:<messageId>");
  }

  // 2. Missing chatId → status: "failed", reason: web_thread_context_missing
  {
    const repo = makeChatRepository();
    const adapter = new WebThreadChannelAdapter(repo as never);

    const result = await adapter.deliver(
      makeIntent({ chatId: null }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    assert.equal(result.status, "failed", "no chatId → failed");
    assert.equal(
      result.error?.["reason"],
      "web_thread_context_missing",
      `reason should be web_thread_context_missing, got ${result.error?.["reason"]}`
    );
    console.log("✓ deliver: missing chatId → web_thread_context_missing");
  }

  // 3. createMessage throws → status: "failed"
  {
    const repo = makeChatRepository({ shouldThrow: new Error("DB error") });
    const adapter = new WebThreadChannelAdapter(repo as never);

    let result: Awaited<ReturnType<typeof adapter.deliver>>;
    try {
      result = await adapter.deliver(
        makeIntent({ chatId: "chat-1", assistantId: "asst-1" }) as never,
        makeRenderedPayload(),
        makeChannelConfig()
      );
    } catch {
      result = { status: "failed" };
    }

    assert.equal(result.status, "failed", "createMessage throw → failed");
    console.log("✓ deliver: createMessage throws → status=failed");
  }

  console.log("\n✅ All WebThreadChannelAdapter tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
