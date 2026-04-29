import assert from "node:assert/strict";
import { PersaiIdleReengagementSchedulerService } from "../src/modules/workspace-management/application/persai-idle-reengagement-scheduler.service";

class FakeIdlePrisma {
  policies = [
    {
      workspaceId: "ws-1",
      enabled: true,
      idleHours: 24,
      cooldownHours: 72,
      llmInstruction: "Be warm and contextual.",
      updatedAt: new Date("2026-04-29T00:00:00.000Z")
    }
  ];
  existingRecentOutbox = false;
  outboxCreates: unknown[] = [];

  workspaceNotificationPolicy = {
    findMany: async () => this.policies
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

  assistantNotificationOutbox = {
    findFirst: async () => (this.existingRecentOutbox ? { id: "outbox-existing" } : null),
    findUnique: async () => null,
    create: async ({ data }: { data: unknown }) => {
      this.outboxCreates.push(data);
      return { id: "outbox-1", status: "pending" };
    }
  };

  assistantMemoryRegistryItem = {
    findMany: async () => [{ summary: "Launch follow-up is open", createdAt: new Date() }]
  };
}

function createScheduler(
  prisma: FakeIdlePrisma,
  decision: "push" | "no_push" = "push"
): PersaiIdleReengagementSchedulerService {
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
    {
      enqueue: async (input: unknown) => {
        prisma.outboxCreates.push(input);
        return { id: "outbox-1", status: "pending", dedupeKey: "idle", created: true };
      }
    } as never
  );
}

async function runPushEnqueuesTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, "push");

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.outboxCreates.length, 1);
  const input = prisma.outboxCreates[0] as { source: string; status: string; text: string };
  assert.equal(input.source, "idle_reengagement");
  assert.equal(input.status, "ok");
  assert.equal(input.text, "Still thinking about the launch with you.");
}

async function runCooldownSkipsTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  prisma.existingRecentOutbox = true;
  const scheduler = createScheduler(prisma, "push");

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 0);
  assert.equal(prisma.outboxCreates.length, 0);
}

async function runNoPushRecordsSkippedDedupeTest(): Promise<void> {
  const prisma = new FakeIdlePrisma();
  const scheduler = createScheduler(prisma, "no_push");

  const processed = await scheduler.processDueIdleReengagementBatch(1);

  assert.equal(processed, 1);
  const input = prisma.outboxCreates[0] as { source: string; status: string; text?: string };
  assert.equal(input.source, "idle_reengagement");
  assert.equal(input.status, "skipped");
  assert.equal(input.text, undefined);
}

async function run(): Promise<void> {
  await runPushEnqueuesTest();
  await runCooldownSkipsTest();
  await runNoPushRecordsSkippedDedupeTest();
  console.log("idle reengagement scheduler tests passed");
}

void run();
