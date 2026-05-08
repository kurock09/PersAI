import assert from "node:assert/strict";
import { PersaiIdleReengagementSchedulerService } from "../src/modules/workspace-management/application/persai-idle-reengagement-scheduler.service";
import { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";

type IntentCreate = {
  source: string;
  class: string;
  priority: string;
  factPayload: Record<string, unknown>;
};

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
}

function createScheduler(
  prisma: FakeIdlePrisma,
  decision: "push" | "no_push" = "push"
): PersaiIdleReengagementSchedulerService {
  const notificationIntentService = {
    createIntent: async (input: IntentCreate) => {
      prisma.intentCreates.push(input);
      return { id: "intent-1", lifecycleStatus: "pending", dedupeKey: null };
    }
  } as unknown as NotificationIntentService;

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
        const task = (input as { task: { brief: string } }).task;
        assert.ok(task.brief.includes("Context packet"));
        return {
          ok: true,
          result: {
            decision,
            pushText: decision === "push" ? "Still thinking about the launch with you." : null,
            rationale: "Context supports a light nudge.",
            confidence: "medium",
            toolRunText: null,
            artifacts: [],
            usage: null,
            rawText: null
          }
        };
      }
    } as never,
    notificationIntentService
  );
}

async function runPushCreatesIntentTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, "push");

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.intentCreates.length, 1);
  const intent = prisma.intentCreates[0] as Record<string, unknown>;
  assert.equal(intent["source"], "idle_reengagement");
  assert.equal(intent["class"], "conversational");
  assert.equal(intent["priority"], "skippable");
  const payload = intent["factPayload"] as Record<string, unknown>;
  assert.equal(payload["pushText"], "Still thinking about the launch with you.");
}

async function runCooldownSkipsTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  prisma.recentIntentExists = true;
  const scheduler = createScheduler(prisma, "push");

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 0);
  assert.equal(prisma.intentCreates.length, 0);
}

async function runNoPushDoesNotCreateIntentTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, "no_push");

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.intentCreates.length, 0);
}

async function run(): Promise<void> {
  await runPushCreatesIntentTest();
  await runCooldownSkipsTest();
  await runNoPushDoesNotCreateIntentTest();
  console.log("idle reengagement scheduler tests passed");
}

void run();
