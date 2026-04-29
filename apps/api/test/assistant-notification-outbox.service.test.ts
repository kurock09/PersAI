import assert from "node:assert/strict";
import { AssistantNotificationOutboxSchedulerService } from "../src/modules/workspace-management/application/assistant-notification-outbox-scheduler.service";
import { AssistantNotificationOutboxService } from "../src/modules/workspace-management/application/assistant-notification-outbox.service";

type OutboxRow = {
  id: string;
  assistantId: string;
  source: "user_reminder" | "background_task" | "idle_reengagement" | "system_event";
  sourceId: string;
  dedupeKey: string;
  status: "pending" | "in_progress" | "delivered" | "failed" | "skipped" | "dead_letter";
  deliveryStatus: "ok" | "error" | "skipped";
  text: string | null;
  artifactsJson: unknown;
  metadataJson: unknown;
  attemptCount: number;
  schedulerClaimToken: string | null;
  deliveryResultJson?: unknown;
  deliveryTarget?: string | null;
  retryAfterAt?: Date | null;
  deadLetteredAt?: Date | null;
};

class FakeOutboxPrisma {
  assistants = new Map([
    ["assistant-1", { id: "assistant-1", userId: "user-1", workspaceId: "ws-1" }]
  ]);
  rows: OutboxRow[] = [];
  backgroundRunUpdates: unknown[] = [];

  assistant = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.assistants.get(where.id) ?? null
  };

  assistantNotificationOutbox = {
    findUnique: async ({ where }: { where: { dedupeKey: string } }) => {
      const row = this.rows.find((item) => item.dedupeKey === where.dedupeKey);
      return row ? { id: row.id, status: row.status } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: OutboxRow = {
        id: `outbox-${this.rows.length + 1}`,
        assistantId: String(data.assistantId),
        source: data.source as OutboxRow["source"],
        sourceId: String(data.sourceId),
        dedupeKey: String(data.dedupeKey),
        status: data.status as OutboxRow["status"],
        deliveryStatus: data.deliveryStatus as OutboxRow["deliveryStatus"],
        text: typeof data.text === "string" ? data.text : null,
        artifactsJson: data.artifactsJson,
        metadataJson: data.metadataJson,
        attemptCount: 0,
        schedulerClaimToken: null
      };
      this.rows.push(row);
      return { id: row.id, status: row.status };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === where.id);
      assert.ok(row, "row exists");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data
    }: {
      where: { id: string; schedulerClaimToken?: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) return { count: 0 };
      if (
        where.schedulerClaimToken !== undefined &&
        where.schedulerClaimToken !== row.schedulerClaimToken
      ) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }
  };

  assistantBackgroundTaskRun = {
    updateMany: async (input: unknown) => {
      this.backgroundRunUpdates.push(input);
      return { count: 1 };
    }
  };

  $transaction = async <T>(callback: (tx: this) => Promise<T>): Promise<T> => callback(this);

  $queryRaw = async (): Promise<unknown[]> =>
    this.rows
      .filter((row) => row.status === "pending" || row.status === "in_progress")
      .map((row) => ({
        id: row.id,
        assistantId: row.assistantId,
        source: row.source,
        sourceId: row.sourceId,
        deliveryStatus: row.deliveryStatus,
        text: row.text,
        artifactsJson: row.artifactsJson,
        metadataJson: row.metadataJson,
        attemptCount: row.attemptCount
      }));
}

async function runEnqueueDedupeTest(): Promise<void> {
  const prisma = new FakeOutboxPrisma();
  const service = new AssistantNotificationOutboxService(prisma as never);

  const first = await service.enqueue({
    assistantId: "assistant-1",
    source: "user_reminder",
    sourceId: "job-1",
    status: "ok",
    text: "Wake up"
  });
  const second = await service.enqueue({
    assistantId: "assistant-1",
    source: "user_reminder",
    sourceId: "job-1",
    status: "ok",
    text: "Wake up"
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.id, second.id);
  assert.equal(prisma.rows.length, 1);
}

async function runSchedulerDeliveryAndRunUpdateTest(): Promise<void> {
  const prisma = new FakeOutboxPrisma();
  prisma.rows.push({
    id: "outbox-1",
    assistantId: "assistant-1",
    source: "background_task",
    sourceId: "task-1",
    dedupeKey: "background_task:task-1:run",
    status: "pending",
    deliveryStatus: "ok",
    text: "Threshold crossed",
    artifactsJson: [],
    metadataJson: { backgroundTaskRunId: "run-1" },
    attemptCount: 0,
    schedulerClaimToken: null
  });
  const service = new AssistantNotificationOutboxSchedulerService(
    prisma as never,
    {
      deliver: async () => ({ target: "web", deliveredAt: "2026-04-29T00:00:00.000Z" })
    } as never
  );

  const processed = await service.processDueNotificationsBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.rows[0].status, "delivered");
  assert.equal(prisma.rows[0].deliveryTarget, "web");
  assert.equal(prisma.backgroundRunUpdates.length, 1);
}

async function runSchedulerDeadLetterTest(): Promise<void> {
  const prisma = new FakeOutboxPrisma();
  prisma.rows.push({
    id: "outbox-1",
    assistantId: "assistant-1",
    source: "user_reminder",
    sourceId: "job-1",
    dedupeKey: "user_reminder:assistant-1:job-1",
    status: "pending",
    deliveryStatus: "ok",
    text: "Wake up",
    artifactsJson: [],
    metadataJson: {},
    attemptCount: 4,
    schedulerClaimToken: null
  });
  const service = new AssistantNotificationOutboxSchedulerService(
    prisma as never,
    {
      deliver: async () => {
        throw new Error("Telegram unavailable");
      }
    } as never
  );

  const processed = await service.processDueNotificationsBatch(1);

  assert.equal(processed, 1);
  assert.equal(prisma.rows[0].status, "dead_letter");
  assert.equal(prisma.rows[0].attemptCount, 5);
  assert.ok(prisma.rows[0].deadLetteredAt instanceof Date);
}

async function run(): Promise<void> {
  await runEnqueueDedupeTest();
  await runSchedulerDeliveryAndRunUpdateTest();
  await runSchedulerDeadLetterTest();
  console.log("assistant notification outbox tests passed");
}

void run();
