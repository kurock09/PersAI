/**
 * ADR-088 Slice 2 — WebNotificationCenterChannelAdapter focused tests.
 * Covers: findOrCreateChatBySurfaceThread with system:notifications key,
 * providerRef format, createMessage call.
 * Tests run via tsx (node:assert/strict, void run() IIFE).
 */
import assert from "node:assert/strict";
import { WebNotificationCenterChannelAdapter } from "../src/modules/workspace-management/infrastructure/notifications/channel-adapters/web-notification-center-channel.adapter";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeIntent(overrides?: Record<string, unknown>) {
  return {
    id: "intent-wnc-1",
    workspaceId: "ws-1",
    assistantId: "asst-1",
    userId: "user-1",
    source: "idle_reengagement",
    class: "conversational",
    priority: "skippable",
    lifecycleStatus: "pending",
    renderStrategy: "grounded_llm",
    renderInstructionRef: null,
    templateId: null,
    factPayload: {},
    policySnapshot: {},
    allowedChannels: ["web_notification_center"],
    escalationAfterMinutes: null,
    escalationChannel: null,
    dedupeKey: null,
    scheduledAt: null,
    respectQuietHours: true,
    surface: "web",
    surfaceThreadKey: null,
    chatId: null,
    traceId: "trace-wnc-1",
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
    id: "ch-wnc-1",
    workspaceId: "ws-1",
    channelType: "web_notification_center" as const,
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
  return { body: "You have been idle for a while." };
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Successful delivery:
  //    findOrCreateChatBySurfaceThread called with surfaceThreadKey === "system:notifications"
  //    providerRef === "web_nc:<chatId>:<messageId>"
  {
    const findOrCreateCalls: Array<{ surfaceThreadKey: string }> = [];
    const createMessageCalls: Array<{ chatId: string }> = [];

    const chatRepo = {
      findOrCreateChatBySurfaceThread: async (input: { surfaceThreadKey: string }) => {
        findOrCreateCalls.push(input);
        return { id: "chat-sys" };
      },
      createMessage: async (input: { chatId: string }) => {
        createMessageCalls.push(input);
        return { id: "msg-1" };
      }
    };

    const prisma = {
      assistant: {
        findUnique: async () => ({ userId: "user-1" })
      }
    };

    const adapter = new WebNotificationCenterChannelAdapter(chatRepo as never, prisma as never);

    const result = await adapter.deliver(
      makeIntent({ userId: "user-1" }) as never,
      makeRenderedPayload(),
      makeChannelConfig()
    );

    assert.equal(result.status, "delivered", "should be delivered");
    assert.equal(result.providerRef, "web_nc:chat-sys:msg-1", "providerRef matches");
    assert.equal(findOrCreateCalls.length, 1, "findOrCreate called once");
    assert.equal(
      findOrCreateCalls[0]!.surfaceThreadKey,
      "system:notifications",
      "called with system:notifications thread key"
    );
    assert.equal(createMessageCalls.length, 1, "createMessage called once");
    assert.equal(
      createMessageCalls[0]!.chatId,
      "chat-sys",
      "createMessage receives correct chatId"
    );
    console.log(
      "✓ deliver: findOrCreateChatBySurfaceThread with system:notifications, providerRef web_nc:<chatId>:<messageId>"
    );
  }

  console.log("\n✅ All WebNotificationCenterChannelAdapter tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
