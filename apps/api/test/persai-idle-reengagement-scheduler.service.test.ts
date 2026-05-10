import assert from "node:assert/strict";
import { PersaiIdleReengagementSchedulerService } from "../src/modules/workspace-management/application/persai-idle-reengagement-scheduler.service";
import { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";
import type { InternalRuntimeBackgroundTaskEvaluationOutcome } from "../src/modules/workspace-management/application/internal-runtime-background-task.client.service";

type IntentCreate = {
  source: string;
  class: string;
  priority: string;
  factPayload: Record<string, unknown>;
};

class FakeIdleMarker {
  data: {
    latestUserMessageAtSnapshot: Date;
    attemptsForCurrentUserMessage: number;
    nextEligibleEvaluationAt: Date | null;
  } | null = null;

  async findUnique() {
    return this.data;
  }

  upsertCalls: unknown[] = [];

  async upsert(args: { create: unknown; update: unknown }) {
    this.upsertCalls.push(args);
    return args.create;
  }
}

class FakeIdlePrisma {
  notificationPolicies = [
    {
      workspaceId: "ws-1",
      source: "idle_reengagement",
      enabled: true,
      config: {
        idleHours: 24,
        cooldownHours: 72,
        llmInstruction: "Be warm and contextual."
      },
      updatedAt: new Date("2026-04-29T00:00:00.000Z")
    }
  ];
  recentIntentExists = false;
  intentCreates: IntentCreate[] = [];
  idleMarker = new FakeIdleMarker();

  notificationPolicy = {
    findMany: async () => this.notificationPolicies
  };

  notificationIntent = {
    findFirst: async () => (this.recentIntentExists ? { id: "intent-existing" } : null),
    create: async (args: { data: IntentCreate }) => {
      this.intentCreates.push(args.data);
      return { id: "intent-1", lifecycleStatus: "pending", dedupeKey: null };
    }
  };

  assistant = {
    findMany: async () => [{ id: "assistant-1", userId: "user-1", workspaceId: "ws-1" }],
    findUnique: async () => ({
      draftDisplayName: "PersAI",
      draftTraits: { warmth: 0.8 },
      user: { displayName: "Alex" },
      workspace: { locale: "en", timezone: "UTC" }
    })
  };

  assistantChatMessage = {
    findFirst: async () => ({
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      chat: {
        id: "chat-1",
        surface: "web",
        surfaceThreadKey: "default"
      }
    }),
    findMany: async () => [
      { author: "user", content: "Remind me about the launch.", createdAt: new Date() },
      { author: "assistant", content: "I will keep it in mind.", createdAt: new Date() }
    ]
  };

  assistantMemoryRegistryItem = {
    findMany: async () => [{ summary: "Launch follow-up is open", createdAt: new Date() }]
  };

  // ADR-090: Marker support
  assistantIdleEvaluationMarker = {
    findUnique: async () => this.idleMarker.findUnique(),
    upsert: async (args: unknown) => this.idleMarker.upsert(args as never)
  };
}

function createScheduler(
  prisma: FakeIdlePrisma,
  outcomeFactory?: () => InternalRuntimeBackgroundTaskEvaluationOutcome
): PersaiIdleReengagementSchedulerService {
  const notificationIntentService = {
    createIntent: async (input: IntentCreate) => {
      prisma.intentCreates.push(input);
      return { id: "intent-1", lifecycleStatus: "pending", dedupeKey: null };
    }
  } as unknown as NotificationIntentService;

  const defaultOutcomeFactory = (): InternalRuntimeBackgroundTaskEvaluationOutcome => ({
    ok: true,
    result: {
      decision: "push",
      pushText: "Still thinking about the launch with you.",
      rationale: "Context supports a light nudge.",
      confidence: "medium",
      toolRunText: null,
      artifacts: [],
      usage: null,
      rawText: null
    }
  });

  return new PersaiIdleReengagementSchedulerService(
    prisma as never,
    {
      findById: async () => ({ id: "assistant-1", workspaceId: "ws-1", userId: "user-1" })
    } as never,
    {
      resolveCurrent: async () => ({
        runtimeBundleDocument: JSON.stringify({ ok: true }),
        layers: {}
      })
    } as never,
    {
      evaluate: async (input: unknown) => {
        const task = (input as { task: { brief: string; evaluationAttemptId?: string } }).task;
        assert.ok(task.brief.includes("Context packet"));
        // ADR-090: unique evaluationAttemptId must always be provided
        assert.ok(
          typeof task.evaluationAttemptId === "string" && task.evaluationAttemptId.length > 0,
          "evaluationAttemptId must be set in every evaluate() call"
        );
        return (outcomeFactory ?? defaultOutcomeFactory)();
      }
    } as never,
    notificationIntentService
  );
}

// ── Test: push decision creates an intent and upserts a closed marker ─────────

async function runPushCreatesIntentTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma);

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.intentCreates.length, 1);
  const intent = prisma.intentCreates[0] as Record<string, unknown>;
  assert.equal(intent["source"], "idle_reengagement");
  assert.equal(intent["class"], "conversational");
  assert.equal(intent["priority"], "skippable");
  const payload = intent["factPayload"] as Record<string, unknown>;
  assert.equal(payload["pushText"], "Still thinking about the launch with you.");

  // ADR-090: marker must be upserted with attempts = MAX_ATTEMPTS to close the window
  assert.equal(prisma.idleMarker.upsertCalls.length, 1);
  const upsertArgs = (prisma.idleMarker.upsertCalls[0] as { create: Record<string, unknown> })
    .create;
  assert.equal(upsertArgs["attemptsForCurrentUserMessage"], 2, "push must close marker (MAX=2)");
}

// ── Test: secondary cooldown (notificationIntent) skips candidate ─────────────

async function runCooldownSkipsTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  prisma.recentIntentExists = true;
  const scheduler = createScheduler(prisma);

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 0);
  assert.equal(prisma.intentCreates.length, 0);
}

// ── Test: no_push increments attempts ─────────────────────────────────────────

async function runNoPushDoesNotCreateIntentTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, () => ({
    ok: true,
    result: {
      decision: "no_push",
      pushText: null,
      rationale: "Nothing urgent.",
      confidence: "medium",
      toolRunText: null,
      artifacts: [],
      usage: null,
      rawText: null
    }
  }));

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.intentCreates.length, 0);

  // ADR-090: attempts must be incremented (0 → 1)
  assert.equal(prisma.idleMarker.upsertCalls.length, 1);
  const upsertArgs = (prisma.idleMarker.upsertCalls[0] as { create: Record<string, unknown> })
    .create;
  assert.equal(
    upsertArgs["attemptsForCurrentUserMessage"],
    1,
    "no_push should increment attempts to 1"
  );
}

// ── Test: marker with MAX_ATTEMPTS exhausted skips candidate ──────────────────

async function runMarkerExhaustedSkipsTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  // Marker already has 2 attempts (MAX) for the same snapshot
  const latestUserMsgTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
  prisma.idleMarker.data = {
    latestUserMessageAtSnapshot: latestUserMsgTime,
    attemptsForCurrentUserMessage: 2,
    nextEligibleEvaluationAt: null
  };
  // Make findFirst return the same timestamp so snapshot matches
  prisma.assistantChatMessage = {
    ...prisma.assistantChatMessage,
    findFirst: async () => ({
      createdAt: latestUserMsgTime,
      chat: { id: "chat-1", surface: "web", surfaceThreadKey: "default" }
    })
  } as FakeIdlePrisma["assistantChatMessage"];

  const scheduler = createScheduler(prisma);
  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 0, "candidate with exhausted marker must be skipped");
  assert.equal(prisma.intentCreates.length, 0);
}

// ── Test: new user message resets window even if marker attempts are exhausted ─

async function runNewUserMessageResetsWindowTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  // Marker snapshot is OLDER than the actual latest user message → new window opens
  const oldSnapshot = new Date(Date.now() - 50 * 60 * 60 * 1000);
  prisma.idleMarker.data = {
    latestUserMessageAtSnapshot: oldSnapshot,
    attemptsForCurrentUserMessage: 2, // exhausted
    nextEligibleEvaluationAt: null
  };
  // assistantChatMessage.findFirst returns a NEWER message
  // (default implementation already returns Date.now() - 25h which is > oldSnapshot)
  const scheduler = createScheduler(prisma);
  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1, "candidate with newer user message should qualify");
  assert.equal(prisma.intentCreates.length, 1);
}

// ── Test: push decision without pushText must NOT close the marker ───────────

async function runPushWithoutTextDoesNotCloseMarkerTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, () => ({
    ok: true,
    result: {
      decision: "push",
      pushText: "",
      rationale: "Model returned empty pushText.",
      confidence: "low",
      toolRunText: null,
      artifacts: [],
      usage: null,
      rawText: null
    }
  }));

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.intentCreates.length, 0, "blank pushText must not create an intent");
  assert.equal(prisma.idleMarker.upsertCalls.length, 1);
  const upsertArgs = (prisma.idleMarker.upsertCalls[0] as { create: Record<string, unknown> })
    .create;
  assert.equal(
    upsertArgs["attemptsForCurrentUserMessage"],
    1,
    "push-without-text must increment attempts (not close window)"
  );
  assert.equal(
    upsertArgs["lastDecision"],
    "push_missing_text",
    "lastDecision should mark the malformed-push case explicitly"
  );
}

// ── Test: 409 deferred — does NOT burn attempt budget ────────────────────────

async function run409DeferNoBurnTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, () => ({
    ok: false,
    deferred: true,
    status: 409,
    code: "runtime_session_busy",
    message: "Session busy."
  }));

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  // Candidate is processed (returned from findDueCandidates), but no intent
  assert.equal(processed, 1);
  assert.equal(prisma.intentCreates.length, 0, "409 deferred must not create an intent");

  // ADR-090: attempt count must NOT be incremented
  assert.equal(prisma.idleMarker.upsertCalls.length, 1);
  const upsertArgs = (prisma.idleMarker.upsertCalls[0] as { create: Record<string, unknown> })
    .create;
  assert.equal(
    upsertArgs["attemptsForCurrentUserMessage"],
    0,
    "409 deferred must not increment attempt count"
  );
  assert.ok(
    upsertArgs["nextEligibleEvaluationAt"] instanceof Date,
    "nextEligibleEvaluationAt must be set after 409"
  );
}

// ── Test: stale-attempts reset when new user message advances the window ─────
//
// Scenario: marker has 2 attempts (exhausted) for snapshot S1. A new user
// message arrives at S2 > S1. The candidate must qualify with attempts=0,
// AND a `no_push` outcome must increment attempts to 1 (not 3).
async function runStaleAttemptsResetOnNewMessageTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const oldSnapshot = new Date(Date.now() - 50 * 60 * 60 * 1000);
  prisma.idleMarker.data = {
    latestUserMessageAtSnapshot: oldSnapshot,
    attemptsForCurrentUserMessage: 2,
    nextEligibleEvaluationAt: null
  };
  // Default findFirst returns Date.now() - 25h which is newer than oldSnapshot.

  const scheduler = createScheduler(prisma, () => ({
    ok: true,
    result: {
      decision: "no_push",
      pushText: null,
      rationale: "Nothing right now.",
      confidence: "low",
      toolRunText: null,
      artifacts: [],
      usage: null,
      rawText: null
    }
  }));
  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.idleMarker.upsertCalls.length, 1);
  const upsertArgs = (prisma.idleMarker.upsertCalls[0] as { create: Record<string, unknown> })
    .create;
  assert.equal(
    upsertArgs["attemptsForCurrentUserMessage"],
    1,
    "new-message window must reset attempts to 0 then increment to 1 on no_push"
  );
}

async function run(): Promise<void> {
  await runPushCreatesIntentTest();
  await runCooldownSkipsTest();
  await runNoPushDoesNotCreateIntentTest();
  await runMarkerExhaustedSkipsTest();
  await runNewUserMessageResetsWindowTest();
  await runPushWithoutTextDoesNotCloseMarkerTest();
  await run409DeferNoBurnTest();
  await runStaleAttemptsResetOnNewMessageTest();
  console.log("idle reengagement scheduler tests passed (ADR-090)");
}

void run();
