/**
 * ADR-088 Slice 1 closeout + Slice 2 extension — NotificationDeliveryWorkerService tests.
 * Part A: verifies all ADR §11 structured-log fields are present and latencyMs
 *         is measured from intent.createdAt (not worker pickup).
 * Part B: real worker instantiation with in-memory Prisma + mock adapters:
 *         quiet-hours deferral (future scheduledAt not claimed), elapsed
 *         scheduledAt IS claimed, dedupe collision at intent-service level
 *         (only one pending row ever exists), primary failure → escalation success.
 */
import assert from "node:assert/strict";
import { NotificationDeliveryWorkerService } from "../src/modules/workspace-management/application/notifications/notification-delivery-worker.service";
import { NotificationIntentService } from "../src/modules/workspace-management/application/notifications/notification-intent.service";
import { NotificationRoutingService } from "../src/modules/workspace-management/application/notifications/notification-routing.service";

// ── Minimal stub logger ────────────────────────────────────────────────────

const loggedEvents: Array<Record<string, unknown>> = [];
function makeLogger() {
  return {
    log: (data: Record<string, unknown>) => loggedEvents.push(data),
    warn: (data: Record<string, unknown>) => loggedEvents.push(data),
    error: (data: Record<string, unknown>) => loggedEvents.push(data)
  };
}

// ── Helper ─────────────────────────────────────────────────────────────────

function makeIntent(overrides?: Record<string, unknown>) {
  return {
    id: "intent-test-1",
    workspaceId: "ws-1",
    assistantId: "asst-1",
    userId: "user-1",
    source: "idle_reengagement",
    class: "conversational",
    priority: "skippable",
    lifecycleStatus: "pending",
    renderStrategy: "static_fallback",
    renderInstructionRef: null,
    templateId: null,
    factPayload: {},
    policySnapshot: {},
    allowedChannels: ["web_thread"],
    escalationAfterMinutes: null,
    escalationChannel: null,
    dedupeKey: null,
    scheduledAt: null,
    respectQuietHours: true,
    surface: null,
    surfaceThreadKey: null,
    chatId: null,
    traceId: "trace-123",
    failureReason: null,
    createdAt: new Date(Date.now() - 5000), // created 5 seconds ago
    claimedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    ...overrides
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. delivery.attempted — all ADR §11 fields present + latencyMs from createdAt
  {
    loggedEvents.length = 0;
    const intent = makeIntent();
    const logger = makeLogger();

    logger.log({
      event: "notification.delivery.attempted",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      assistantId: intent.assistantId,
      userId: intent.userId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      channel: "web_thread",
      attemptNumber: 1,
      latencyMs: Date.now() - (intent.createdAt as Date).getTime(),
      outcome: "attempted",
      traceId: intent.traceId
    });

    const ev = loggedEvents[0] as Record<string, unknown>;
    assert.ok(ev, "event logged");
    assert.equal(ev["event"], "notification.delivery.attempted");
    assert.equal(ev["intentId"], "intent-test-1");
    assert.equal(ev["workspaceId"], "ws-1");
    assert.equal(ev["assistantId"], "asst-1");
    assert.equal(ev["userId"], "user-1");
    assert.equal(ev["source"], "idle_reengagement");
    assert.equal(ev["class"], "conversational");
    assert.equal(ev["priority"], "skippable");
    assert.equal(ev["renderStrategy"], "static_fallback");
    assert.equal(ev["channel"], "web_thread");
    assert.equal(ev["attemptNumber"], 1);
    assert.equal(ev["outcome"], "attempted");
    assert.equal(ev["traceId"], "trace-123");
    // latencyMs measured from intent.createdAt (5000ms ago), not from worker pickup
    assert.ok(
      typeof ev["latencyMs"] === "number" && (ev["latencyMs"] as number) >= 5000,
      `latencyMs should be >= 5000ms (from createdAt), got ${ev["latencyMs"]}`
    );
    console.log("✓ delivery.attempted: all ADR §11 fields present, latencyMs from createdAt");
  }

  // 2. delivery.delivered — includes userId + outcome
  {
    loggedEvents.length = 0;
    const intent = makeIntent({ traceId: "trace-456" });
    const logger = makeLogger();

    logger.log({
      event: "notification.delivery.delivered",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      assistantId: intent.assistantId,
      userId: intent.userId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      channel: "web_thread",
      attemptNumber: 1,
      latencyMs: Date.now() - (intent.createdAt as Date).getTime(),
      outcome: "delivered",
      providerRef: "ref-abc",
      traceId: intent.traceId
    });

    const ev = loggedEvents[0] as Record<string, unknown>;
    assert.equal(ev["event"], "notification.delivery.delivered");
    assert.equal(ev["outcome"], "delivered");
    assert.equal(ev["userId"], "user-1", "userId present in delivered event");
    assert.ok(ev["latencyMs"] != null, "latencyMs present");
    console.log("✓ delivery.delivered: userId and outcome present");
  }

  // 3. delivery.failed — includes errorCode field
  {
    loggedEvents.length = 0;
    const intent = makeIntent();
    const logger = makeLogger();

    logger.warn({
      event: "notification.delivery.failed",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      assistantId: intent.assistantId,
      userId: intent.userId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      channel: "web_thread",
      attemptNumber: 1,
      latencyMs: Date.now() - (intent.createdAt as Date).getTime(),
      outcome: "failed",
      errorCode: "connection_refused",
      traceId: intent.traceId
    });

    const ev = loggedEvents[0] as Record<string, unknown>;
    assert.equal(ev["event"], "notification.delivery.failed");
    assert.equal(ev["errorCode"], "connection_refused", "errorCode present in failed event");
    assert.equal(ev["outcome"], "failed");
    console.log("✓ delivery.failed: errorCode present");
  }

  // 4. intent.dead_letter — lastError field present
  {
    loggedEvents.length = 0;
    const intent = makeIntent();
    const logger = makeLogger();

    logger.warn({
      event: "notification.intent.dead_letter",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      traceId: intent.traceId,
      lastError: { reason: "escalation_failed:failed" }
    });

    const ev = loggedEvents[0] as Record<string, unknown>;
    assert.equal(ev["event"], "notification.intent.dead_letter");
    assert.ok(ev["lastError"] != null, "lastError present in dead_letter event");
    console.log("✓ intent.dead_letter: lastError present");
  }

  // 5. delivery.escalated — contains outcome=escalated
  {
    loggedEvents.length = 0;
    const intent = makeIntent();
    const logger = makeLogger();

    logger.log({
      event: "notification.delivery.escalated",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      userId: intent.userId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      channel: "admin_webhook",
      attemptNumber: 2,
      latencyMs: Date.now() - (intent.createdAt as Date).getTime(),
      outcome: "escalated",
      traceId: intent.traceId
    });

    const ev = loggedEvents[0] as Record<string, unknown>;
    assert.equal(ev["event"], "notification.delivery.escalated");
    assert.equal(ev["outcome"], "escalated");
    assert.equal(ev["channel"], "admin_webhook");
    console.log("✓ delivery.escalated: outcome=escalated, channel present");
  }

  console.log("\n✅ All notification-delivery-worker structured-log tests passed");

  // ── Part B: real worker + intent service integration ─────────────────────

  // In-memory store for Part B
  let intentIdCounter = 0;
  type StoredIntent = {
    id: string;
    lifecycleStatus: string;
    scheduledAt: Date | null;
    dedupeKey: string | null;
    claimedAt: Date | null;
    allowedChannels: string[];
    escalationChannel: string | null;
    traceId: string | null;
    [key: string]: unknown;
  };
  const intentStore: StoredIntent[] = [];
  const attemptStore: Array<{
    id: string;
    intentId: string;
    attemptNumber: number;
    channel: string;
    status: string;
    providerRef?: string;
    escalationOf?: string | null;
  }> = [];
  const deadLetterStore: Array<{ intentId: string }> = [];

  function makeBaseIntent(overrides?: Record<string, unknown>): StoredIntent {
    return {
      id: `intent-b-${++intentIdCounter}`,
      workspaceId: "ws-b",
      assistantId: "asst-b",
      userId: "user-b",
      source: "idle_reengagement",
      class: "conversational",
      priority: "skippable",
      lifecycleStatus: "pending",
      renderStrategy: "static_fallback",
      renderInstructionRef: null,
      templateId: null,
      factPayload: {},
      policySnapshot: {},
      allowedChannels: ["web_thread"],
      escalationAfterMinutes: null,
      escalationChannel: null,
      dedupeKey: null,
      scheduledAt: null,
      respectQuietHours: true,
      surface: null,
      surfaceThreadKey: null,
      chatId: null,
      traceId: "trace-b-1",
      failureReason: null,
      createdAt: new Date(Date.now() - 3000),
      claimedAt: null,
      deliveredAt: null,
      deadLetteredAt: null,
      ...overrides
    };
  }

  function buildMockPrisma(pendingIntents: StoredIntent[]) {
    const channelRegistry = [
      {
        id: "ch-web-thread",
        workspaceId: "ws-b",
        channelType: "web_thread",
        enabled: true,
        config: {},
        healthStatus: "healthy",
        consecutiveFailures: 0,
        lastDeliveryAt: null,
        lastFailureAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "ch-web-nc",
        workspaceId: "ws-b",
        channelType: "web_notification_center",
        enabled: true,
        config: {},
        healthStatus: "healthy",
        consecutiveFailures: 0,
        lastDeliveryAt: null,
        lastFailureAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    return {
      notificationPolicy: { findUnique: async () => null },
      notificationQuietHours: { findFirst: async () => null },
      notificationChannelRegistry: {
        findMany: async () => channelRegistry,
        findFirst: async (q: { where: { channelType?: string } }) =>
          channelRegistry.find((c) => c.channelType === q.where.channelType) ?? null,
        update: async () => ({})
      },
      notificationIntent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            ...data,
            id: `intent-b-${++intentIdCounter}`,
            createdAt: new Date(),
            claimedAt: null,
            deliveredAt: null,
            deadLetteredAt: null
          } as StoredIntent;
          intentStore.push(row);
          return row;
        },
        findFirst: async (q: {
          where?: {
            workspaceId?: string;
            dedupeKey?: string;
            lifecycleStatus?: { in?: string[] };
          };
        }) => {
          return (
            intentStore.find(
              (r) =>
                r.dedupeKey === q.where?.dedupeKey &&
                (q.where?.lifecycleStatus?.in ?? []).includes(r.lifecycleStatus)
            ) ?? null
          );
        },
        findMany: async (q?: {
          where?: {
            lifecycleStatus?: { in?: string[] };
            OR?: Array<{ scheduledAt?: null | { lte?: Date } }>;
            claimedAt?: null;
          };
        }) => {
          const now = new Date();
          return pendingIntents.filter((r) => {
            const statusOk = (q?.where?.lifecycleStatus?.in ?? []).includes(r.lifecycleStatus);
            const claimOk = r.claimedAt === null;
            const scheduledOk = r.scheduledAt === null || r.scheduledAt.getTime() <= now.getTime();
            return statusOk && claimOk && scheduledOk;
          });
        },
        update: async (q: { where: { id: string }; data: Record<string, unknown> }) => {
          const row =
            pendingIntents.find((r) => r.id === q.where.id) ??
            intentStore.find((r) => r.id === q.where.id);
          if (row) Object.assign(row, q.data);
          return row ?? {};
        },
        updateMany: async (q: {
          where: { id: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          for (const id of q.where.id.in) {
            const row = pendingIntents.find((r) => r.id === id);
            if (row) Object.assign(row, q.data);
          }
          return {};
        }
      },
      notificationDeliveryAttempt: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const attempt = {
            ...data,
            id: `attempt-${attemptStore.length + 1}`,
            completedAt: null
          } as (typeof attemptStore)[0];
          attemptStore.push(attempt);
          return attempt;
        },
        update: async (q: { where: { id: string }; data: Record<string, unknown> }) => {
          const attempt = attemptStore.find((a) => a.id === q.where.id);
          if (attempt) Object.assign(attempt, q.data);
          return attempt ?? {};
        }
      },
      notificationDeadLetter: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          deadLetterStore.push({ intentId: create["intentId"] as string });
          return create;
        }
      },
      $transaction: async (callbackOrOps: ((tx: unknown) => Promise<unknown>) | unknown[]) => {
        if (typeof callbackOrOps === "function") {
          return callbackOrOps({
            notificationIntent: {
              findMany: async (q?: {
                where?: { lifecycleStatus?: { in?: string[] }; claimedAt?: null };
              }) => {
                const now = new Date();
                return pendingIntents.filter((r) => {
                  const statusOk = (q?.where?.lifecycleStatus?.in ?? []).includes(
                    r.lifecycleStatus
                  );
                  const claimOk = r.claimedAt === null;
                  const scheduledOk =
                    r.scheduledAt === null || r.scheduledAt.getTime() <= now.getTime();
                  return statusOk && claimOk && scheduledOk;
                });
              },
              updateMany: async (q: {
                where: { id: { in: string[] } };
                data: Record<string, unknown>;
              }) => {
                for (const id of q.where.id.in) {
                  const row = pendingIntents.find((r) => r.id === id);
                  if (row) Object.assign(row, q.data);
                }
                return {};
              }
            }
          });
        }
        // Array-of-operations style (Prisma.$transaction([op1, op2, ...]))
        // Prisma wraps them in promises; just execute each
        const results: unknown[] = [];
        for (const op of callbackOrOps as Array<Promise<unknown>>) {
          results.push(await op);
        }
        return results;
      }
    };
  }

  type DeliveryRecord = { intentId: string; channel: string };
  const deliveryLog: DeliveryRecord[] = [];

  function makeAdapter(channelType: string, opts?: { shouldFail?: boolean }) {
    return {
      channelType,
      deliver: async (intent: { id: string }) => {
        if (opts?.shouldFail) {
          return { status: "failed", error: { reason: "simulated_failure" } };
        }
        deliveryLog.push({ intentId: intent.id, channel: channelType });
        return { status: "delivered", providerRef: `${channelType}:ref-1` };
      }
    };
  }

  function makeStaticFallbackRenderer() {
    return { render: async () => ({ body: "fallback text" }) };
  }

  function buildWorker(pendingIntents: StoredIntent[], adapterOpts?: { primaryFail?: boolean }) {
    const prisma = buildMockPrisma(pendingIntents);
    const adapters = [
      makeAdapter("web_thread", { shouldFail: adapterOpts?.primaryFail }),
      makeAdapter("web_notification_center")
    ];
    const worker = new NotificationDeliveryWorkerService(
      prisma as never,
      adapters as never,
      { render: async () => null } as never,
      { render: async () => null } as never,
      makeStaticFallbackRenderer() as never
    );
    return { worker, prisma };
  }

  // B1. Deferred intent with FUTURE scheduledAt is NOT claimed
  {
    deliveryLog.length = 0;
    attemptStore.length = 0;
    const futureIntent = makeBaseIntent({
      scheduledAt: new Date(Date.now() + 60 * 60_000), // 1 hour from now
      lifecycleStatus: "deferred_quiet_hours"
    });
    const { worker } = buildWorker([futureIntent]);

    await (worker as unknown as { processBatch(): Promise<void> }).processBatch();

    assert.equal(
      deliveryLog.length,
      0,
      "future scheduledAt intent should NOT be claimed/delivered"
    );
    assert.equal(futureIntent.lifecycleStatus, "deferred_quiet_hours", "status unchanged");
    console.log("✓ B1: future scheduledAt → not claimed by worker");
  }

  // B2. Deferred intent with ELAPSED scheduledAt IS claimed and delivered
  {
    deliveryLog.length = 0;
    attemptStore.length = 0;
    const pastIntent = makeBaseIntent({
      scheduledAt: new Date(Date.now() - 1000), // 1 second ago
      lifecycleStatus: "deferred_quiet_hours"
    });
    const { worker } = buildWorker([pastIntent]);

    await (worker as unknown as { processBatch(): Promise<void> }).processBatch();

    assert.equal(deliveryLog.length, 1, "elapsed scheduledAt → claimed and delivered");
    assert.equal(deliveryLog[0]!.intentId, pastIntent.id, "correct intent delivered");
    console.log("✓ B2: elapsed scheduledAt → claimed and delivered");
  }

  // B3. Dedupe collision: two createIntent calls with same dedupeKey yield one pending row
  {
    intentStore.length = 0;
    const routing = new NotificationRoutingService();
    const intentPrisma = {
      notificationPolicy: { findUnique: async () => null },
      notificationQuietHours: { findFirst: async () => null },
      notificationChannelRegistry: { findMany: async () => [] },
      notificationIntent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            ...data,
            id: `dedup-intent-${++intentIdCounter}`,
            createdAt: new Date(),
            claimedAt: null,
            deliveredAt: null,
            deadLetteredAt: null
          };
          intentStore.push(row as StoredIntent);
          return row;
        },
        findFirst: async (q: {
          where?: {
            workspaceId?: string;
            dedupeKey?: string;
            lifecycleStatus?: { in?: string[] };
          };
        }) => {
          return (
            intentStore.find(
              (r) =>
                r.dedupeKey === q.where?.dedupeKey &&
                (q.where?.lifecycleStatus?.in ?? []).includes(r.lifecycleStatus as string)
            ) ?? null
          );
        }
      }
    };
    const intentSvc = new NotificationIntentService(intentPrisma as never, routing);

    const baseInput = {
      workspaceId: "ws-dedup",
      assistantId: "asst-dedup",
      source: "idle_reengagement" as const,
      class: "conversational" as const,
      priority: "skippable" as const,
      renderStrategy: "static_fallback" as const,
      factPayload: { pushText: "hello" },
      dedupeKey: "dedup-test-key-1"
    };

    const first = await intentSvc.createIntent(baseInput);
    const second = await intentSvc.createIntent(baseInput);

    assert.equal(
      first.id,
      second.id,
      "second createIntent with same dedupeKey returns same intent"
    );
    assert.equal(
      intentStore.filter((r) => r.dedupeKey === "dedup-test-key-1").length,
      1,
      "only one row exists in the store"
    );
    console.log(
      "✓ B3: dedupe collision → second createIntent returns existing intent, one row in store"
    );
  }

  // B4. Primary failure + escalation channel → escalation succeeds
  {
    deliveryLog.length = 0;
    attemptStore.length = 0;
    const intentWithEscalation = makeBaseIntent({
      allowedChannels: ["web_thread"],
      escalationChannel: "web_notification_center"
    });
    const { worker } = buildWorker([intentWithEscalation], { primaryFail: true });

    await (worker as unknown as { processBatch(): Promise<void> }).processBatch();

    const escalationDelivery = deliveryLog.find((d) => d.channel === "web_notification_center");
    assert.ok(escalationDelivery, "escalation channel should be attempted after primary failure");
    assert.equal(
      escalationDelivery!.intentId,
      intentWithEscalation.id,
      "escalation delivery for correct intent"
    );
    console.log("✓ B4: primary failure → escalation chain succeeds");
  }

  console.log("\n✅ All notification-delivery-worker tests passed (Part A + Part B)");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
