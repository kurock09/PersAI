/**
 * ADR-088 Slice 2 — QuotaAdvisoryFollowUpService focused tests.
 * Covers: web turn allowedChannels=["web_thread"], telegram turn allowedChannels=["telegram_thread"],
 * no_push decision returns null, traceId forwarded to createIntent.
 * Tests run via tsx (node:assert/strict, void run() IIFE).
 */
import assert from "node:assert/strict";
import { QuotaAdvisoryFollowUpService } from "../src/modules/workspace-management/application/quota-advisory-follow-up.service";

// ── In-memory mocks ────────────────────────────────────────────────────────

type CapturedIntentInput = Record<string, unknown>;
const capturedIntents: CapturedIntentInput[] = [];

function makeNotificationIntentService() {
  return {
    createIntent: async (input: CapturedIntentInput) => {
      capturedIntents.push(input);
      return { id: `intent-${capturedIntents.length}`, lifecycleStatus: "pending", ...input };
    }
  };
}

function makeQuotaStatusService(decision: "push" | "no_push") {
  const candidates =
    decision === "push"
      ? [{ deliveryState: "eligible", dedupeKey: "quota:token_budget:user-1" }]
      : [];
  return {
    execute: async () => ({
      advisoryCandidates: candidates,
      currentPlan: { name: "free" },
      advisories: {},
      visiblePlans: [],
      monthlyMediaQuotas: [],
      tools: [],
      buckets: []
    })
  };
}

function makeEvaluateOutcome(pushText: string | null) {
  return {
    ok: true,
    result: {
      decision: pushText !== null ? "push" : "no_push",
      pushText
    }
  };
}

function makeRuntimeTaskClient(pushText: string | null) {
  return {
    evaluate: async () => makeEvaluateOutcome(pushText)
  };
}

function makeAssistantRepository() {
  return {
    findById: async (id: string) => ({ id, draftDisplayName: "TestBot" })
  };
}

function makePrisma() {
  return {
    notificationPolicy: {
      findUnique: async () => null
    },
    assistant: {
      findUnique: async () => ({
        draftDisplayName: "TestBot",
        user: { displayName: "Alex" },
        workspace: { locale: "en", timezone: "UTC" }
      })
    },
    assistantChatMessage: {
      findMany: async () => []
    }
  };
}

function makeSpecService() {
  return {
    resolveCurrent: async () => ({
      runtimeBundleDocument: { model: "gpt-4o" },
      layers: [{ runtimeAssignment: { effectiveTier: "paid" } }]
    })
  };
}

function buildService(
  pushText: string | null,
  decision: "push" | "no_push" = pushText !== null ? "push" : "no_push"
) {
  capturedIntents.length = 0;
  const svc = new QuotaAdvisoryFollowUpService(
    makeAssistantRepository() as never,
    makePrisma() as never,
    makeSpecService() as never,
    makeQuotaStatusService(decision) as never,
    makeRuntimeTaskClient(pushText) as never,
    makeNotificationIntentService() as never
  );
  return svc;
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Web turn → allowedChannels=["web_thread"], surface="web"
  {
    capturedIntents.length = 0;
    const svc = buildService("You are approaching your token limit.");

    const result = await svc.maybeCreateFollowUp({
      assistantId: "asst-1",
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      surface: "web",
      surfaceThreadKey: "web:thread-key-abc",
      mainAssistantMessage: "Here is your result.",
      traceId: "trace-web-turn-1"
    });

    assert.ok(result !== null, "web turn should produce an intent");
    assert.ok(result?.intentId, "intentId present");
    assert.equal(capturedIntents.length, 1, "createIntent called once");
    const captured = capturedIntents[0]!;
    // allowedChannels is no longer hardcoded by the producer — policy decides
    // (current_thread), so we only check that surface context is forwarded
    // so the delivery worker can expand current_thread at runtime.
    assert.equal(captured["surface"], "web", "surface=web");
    assert.equal(captured["chatId"], "chat-1", "chatId forwarded for current_thread expansion");
    assert.equal(captured["traceId"], "trace-web-turn-1", "traceId forwarded");
    assert.ok(captured["dedupeKey"], "dedupeKey populated");
    assert.deepEqual(
      (captured["factPayload"] as { candidateDedupeKeys?: string[] }).candidateDedupeKeys,
      ["quota:token_budget:user-1"]
    );
    console.log(
      "✓ web turn: surface/chatId forwarded for current_thread expansion, traceId forwarded"
    );
  }

  // 2. Telegram turn → allowedChannels=["telegram_thread"], surface="telegram"
  {
    capturedIntents.length = 0;
    const svc = buildService("You are approaching your token limit.");

    const result = await svc.maybeCreateFollowUp({
      assistantId: "asst-1",
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-tg-1",
      surface: "telegram",
      surfaceThreadKey: "12345",
      mainAssistantMessage: "Here is your result.",
      traceId: "trace-tg-turn-1"
    });

    assert.ok(result !== null, "telegram turn should produce an intent");
    const captured = capturedIntents[0]!;
    // allowedChannels is no longer hardcoded — policy decides (current_thread).
    // We verify surface context is forwarded for delivery worker expansion.
    assert.equal(captured["surface"], "telegram", "surface=telegram");
    assert.equal(captured["chatId"], "chat-tg-1", "chatId forwarded for current_thread expansion");
    assert.equal(captured["traceId"], "trace-tg-turn-1", "traceId forwarded for telegram");
    console.log(
      "✓ telegram turn: surface/chatId forwarded for current_thread expansion, traceId forwarded"
    );
  }

  // 3. LLM decides no_push → returns null, no createIntent call
  {
    capturedIntents.length = 0;
    const svc = buildService(null, "no_push");

    const result = await svc.maybeCreateFollowUp({
      assistantId: "asst-1",
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      surface: "web",
      surfaceThreadKey: "web:thread-key-abc",
      mainAssistantMessage: "Here is your result.",
      traceId: "trace-no-push"
    });

    assert.equal(result, null, "no_push decision → null");
    assert.equal(capturedIntents.length, 0, "no createIntent call on no_push");
    console.log("✓ no_push decision: returns null, no createIntent call");
  }

  // 4. No eligible advisory candidates → returns null without calling createIntent
  {
    capturedIntents.length = 0;
    const svc = new QuotaAdvisoryFollowUpService(
      makeAssistantRepository() as never,
      makePrisma() as never,
      makeSpecService() as never,
      makeQuotaStatusService("no_push") as never,
      makeRuntimeTaskClient("some text") as never,
      makeNotificationIntentService() as never
    );

    const result = await svc.maybeCreateFollowUp({
      assistantId: "asst-1",
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      surface: "web",
      surfaceThreadKey: "web:thread-key-abc",
      mainAssistantMessage: "Here is your result.",
      traceId: null
    });

    assert.equal(result, null, "no eligible candidates → null");
    assert.equal(capturedIntents.length, 0, "no createIntent if no candidates");
    console.log("✓ no eligible candidates: returns null, no createIntent call");
  }

  console.log("\n✅ All QuotaAdvisoryFollowUpService tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
