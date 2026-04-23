import assert from "node:assert/strict";
import { PersaiScheduledActionSchedulerService } from "../src/modules/workspace-management/application/persai-scheduled-action-scheduler.service";
import type {
  ProactivePushPolicyDecision,
  ProactivePushPolicyInput,
  ProactivePushPolicyService
} from "../src/modules/workspace-management/application/proactive-push-policy.service";

type SchedulerRow = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  externalRef: string;
  title: string;
  audience: "user" | "assistant";
  actionType: string | null;
  actionPayloadJson: unknown;
  nextRunAt: Date | null;
  payloadText: string | null;
  scheduleJson: unknown;
  controlStatus: "active" | "disabled" | "cancelled";
  disabledAt?: Date | null;
  cancelledAt?: Date | null;
  retryAfterAt: Date | null;
  schedulerClaimToken: string | null;
  schedulerClaimEpoch: number | null;
  schedulerClaimedAt: Date | null;
  schedulerClaimExpiresAt: Date | null;
  createdAt: Date;
  lastFiredAt: Date | null;
  lastAnsweredCheckAt: Date | null;
  consecutiveUnanswered: number;
  workspaceTimezone: string | null;
  // ADR-074 F1: shared per-task attempt counter for backoff + dead-letter.
  attemptCount: number;
  lastErrorMessage?: string | null;
  lastErrorAt?: Date | null;
};

// ADR-074 Slice T1: a tiny fake that records every policy invocation so the
// tests can assert (a) that the assistant audience never invokes the gate
// and (b) that the gate's decisions are honoured atomically with the claim
// release.
class FakeProactivePushPolicyService {
  calls: ProactivePushPolicyInput[] = [];
  nextDecision: ProactivePushPolicyDecision = {
    action: "allow",
    consecutiveUnansweredAfter: 0,
    lastAnsweredCheckAtAfter: null
  };

  evaluateProactivePush(input: ProactivePushPolicyInput): ProactivePushPolicyDecision {
    this.calls.push(input);
    return this.nextDecision;
  }
}

function defaultRowFields(): {
  userId: string;
  workspaceId: string;
  lastFiredAt: Date | null;
  lastAnsweredCheckAt: Date | null;
  consecutiveUnanswered: number;
  workspaceTimezone: string | null;
  attemptCount: number;
  lastErrorMessage: string | null;
  lastErrorAt: Date | null;
} {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    workspaceTimezone: "UTC",
    attemptCount: 0,
    lastErrorMessage: null,
    lastErrorAt: null
  };
}

class FakeHandleInternalCronFireService {
  calls: unknown[] = [];
  shouldThrow = false;

  async execute(input: unknown) {
    this.calls.push(input);
    if (this.shouldThrow) {
      throw new Error("delivery failed");
    }
    return { ok: true, deliveredTo: "web" };
  }
}

class FakeRunScheduledAssistantActionService {
  calls: unknown[] = [];
  shouldThrow = false;

  async execute(input: unknown) {
    this.calls.push(input);
    if (this.shouldThrow) {
      throw new Error("assistant action failed");
    }
  }
}

class FakeBumpConfigGenerationService {
  constructor(public currentEpoch = 1) {}

  async bumpReminderSchedulerEpoch() {
    this.currentEpoch += 1;
    return this.currentEpoch;
  }

  async currentReminderSchedulerEpoch() {
    return this.currentEpoch;
  }
}

class FakeWorkspaceManagementPrismaService {
  // ADR-074 Slice T1: scheduler now reads `assistantChatMessage.findFirst`
  // for the latest user-authored message when evaluating the proactive-push
  // policy gate. Tests can override `latestUserMessageAt` to exercise the
  // mute-release path.
  assistantChatMessage = {
    findFirst: async (_args: unknown) => {
      void _args;
      return this.latestUserMessageAt === null ? null : { createdAt: this.latestUserMessageAt };
    }
  };

  latestUserMessageAt: Date | null = null;

  constructor(
    public rows: SchedulerRow[],
    private readonly getCurrentEpoch: () => number
  ) {}

  assistantTaskRegistryItem = {
    updateMany: async ({
      where,
      data
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = this.rows.find(
        (entry) =>
          entry.id === where.id &&
          entry.schedulerClaimToken === where.schedulerClaimToken &&
          entry.schedulerClaimEpoch === where.schedulerClaimEpoch
      );
      if (!row) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = this.rows.length;
      this.rows = this.rows.filter(
        (entry) =>
          !(
            entry.id === where.id &&
            entry.schedulerClaimToken === where.schedulerClaimToken &&
            entry.schedulerClaimEpoch === where.schedulerClaimEpoch
          )
      );
      return { count: before - this.rows.length };
    }
  };

  async $transaction<T>(
    callback: (tx: {
      $queryRaw: (_sql: unknown) => Promise<
        Array<{
          id: string;
          assistantId: string;
          userId: string;
          workspaceId: string;
          externalRef: string;
          title: string;
          audience: "user" | "assistant";
          actionType: string | null;
          actionPayloadJson: unknown;
          nextRunAt: Date;
          payloadText: string;
          scheduleJson: unknown;
          lastFiredAt: Date | null;
          lastAnsweredCheckAt: Date | null;
          consecutiveUnanswered: number;
          workspaceTimezone: string | null;
        }>
      >;
      assistantTaskRegistryItem: {
        update: (params: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => Promise<void>;
      };
    }) => Promise<T>
  ): Promise<T> {
    const tx = {
      $queryRaw: async () => {
        const now = Date.now();
        return this.rows
          .filter(
            (row) =>
              row.controlStatus === "active" &&
              row.nextRunAt !== null &&
              row.nextRunAt.getTime() <= now &&
              row.externalRef &&
              row.payloadText &&
              row.scheduleJson &&
              (row.retryAfterAt === null || row.retryAfterAt.getTime() <= now) &&
              (row.schedulerClaimExpiresAt === null ||
                row.schedulerClaimExpiresAt.getTime() <= now ||
                (row.schedulerClaimEpoch ?? 0) < this.getCurrentEpoch())
          )
          .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime())
          .map((row) => ({
            id: row.id,
            assistantId: row.assistantId,
            userId: row.userId,
            workspaceId: row.workspaceId,
            externalRef: row.externalRef,
            title: row.title,
            audience: row.audience,
            actionType: row.actionType,
            actionPayloadJson: row.actionPayloadJson,
            nextRunAt: row.nextRunAt!,
            payloadText: row.payloadText!,
            scheduleJson: row.scheduleJson,
            lastFiredAt: row.lastFiredAt,
            lastAnsweredCheckAt: row.lastAnsweredCheckAt,
            consecutiveUnanswered: row.consecutiveUnanswered,
            workspaceTimezone: row.workspaceTimezone,
            attemptCount: row.attemptCount
          }));
      },
      assistantTaskRegistryItem: {
        update: async ({
          where,
          data
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const row = this.rows.find((entry) => entry.id === where.id);
          if (!row) {
            throw new Error("row not found");
          }
          Object.assign(row, data);
        }
      }
    };
    return callback(tx);
  }
}

async function runSuccessBatchTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-1",
        assistantId: "assistant-1",
        externalRef: "job-1",
        title: "Release reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Проверить релиз",
        scheduleJson: {
          kind: "every",
          everyMs: 60_000,
          anchorMs: dueAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.equal(assistantRunner.calls.length, 0);
  assert.deepEqual(handler.calls[0], {
    assistantId: "assistant-1",
    jobId: "job-1",
    action: "finished",
    status: "ok",
    summary: "Проверить релиз",
    runAtMs: dueAt.getTime(),
    nextRunAtMs: dueAt.getTime() + 60_000
  });
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null);
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
  assert.equal(prisma.rows[0]?.retryAfterAt, null);
  assert.equal(prisma.rows[0]?.nextRunAt?.getTime(), dueAt.getTime() + 60_000);
}

async function runRecurringBoundaryAdvanceTest(): Promise<void> {
  const everyMs = 60_000;
  const dueAt = new Date(Date.now() - 60_000);
  const anchorAt = new Date(dueAt.getTime() - everyMs);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-boundary",
        assistantId: "assistant-1",
        externalRef: "job-boundary",
        title: "Boundary reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Boundary case reminder",
        scheduleJson: {
          kind: "every",
          everyMs,
          anchorMs: anchorAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(anchorAt.getTime() - everyMs)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.deepEqual(handler.calls[0], {
    assistantId: "assistant-1",
    jobId: "job-boundary",
    action: "finished",
    status: "ok",
    summary: "Boundary case reminder",
    runAtMs: dueAt.getTime(),
    nextRunAtMs: dueAt.getTime() + everyMs
  });
  assert.equal(prisma.rows[0]?.nextRunAt?.getTime(), dueAt.getTime() + everyMs);
}

async function runOneTimeUserReminderDeletedAfterDeliveryTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-one-time-user",
        assistantId: "assistant-1",
        externalRef: "job-one-time-user",
        title: "One-time reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "One-time user reminder",
        scheduleJson: {
          kind: "at",
          at: dueAt.toISOString()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.equal(assistantRunner.calls.length, 0);
  assert.equal(prisma.rows.length, 0);
}

async function runFailureRetryTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-2",
        assistantId: "assistant-1",
        externalRef: "job-2",
        title: "Broken reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Упавший reminder",
        scheduleJson: {
          kind: "at",
          at: dueAt.toISOString()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  handler.shouldThrow = true;
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.equal(assistantRunner.calls.length, 0);
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null);
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
  assert.ok(prisma.rows[0]?.retryAfterAt instanceof Date);
  assert.ok((prisma.rows[0]?.retryAfterAt?.getTime() ?? 0) > Date.now());
}

async function runAssistantFailureRetryTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-assistant-retry",
        assistantId: "assistant-1",
        externalRef: "job-assistant-retry",
        title: "Assistant retry reminder",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Assistant action should retry while below limit.",
        scheduleJson: {
          kind: "at",
          at: dueAt.toISOString()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch,
    {
      "job-assistant-retry": 2
    }
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  assistantRunner.shouldThrow = true;
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 1);
  assert.equal(prisma.rows[0]?.controlStatus, "active");
  assert.ok(prisma.rows[0]?.retryAfterAt instanceof Date);
}

async function runRecurringAssistantSuccessSkipsPastIntervalsTest(): Promise<void> {
  const everyMs = 60_000;
  const dueAt = new Date(Date.now() - 5 * everyMs);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-assistant-recurring-success",
        assistantId: "assistant-1",
        externalRef: "job-assistant-recurring-success",
        title: "Assistant recurring success",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Assistant recurring action should skip missed slots after success.",
        scheduleJson: {
          kind: "every",
          everyMs
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - everyMs)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 1);
  assert.equal(prisma.rows[0]?.controlStatus, "active");
  assert.equal(prisma.rows[0]?.retryAfterAt, null);
  assert.ok((prisma.rows[0]?.nextRunAt?.getTime() ?? 0) > Date.now());
}

async function runRecurringAssistantFailureAdvancesTest(): Promise<void> {
  const everyMs = 60_000;
  const dueAt = new Date(Date.now() - 5 * everyMs);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-assistant-recurring-failure",
        assistantId: "assistant-1",
        externalRef: "job-assistant-recurring-failure",
        title: "Assistant recurring failure",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Assistant recurring action should advance after a failed fire.",
        scheduleJson: {
          kind: "every",
          everyMs
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - everyMs)
      }
    ],
    () => epochs.currentEpoch,
    {
      "job-assistant-recurring-failure": 1
    }
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  assistantRunner.shouldThrow = true;
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 1);
  assert.equal(prisma.rows[0]?.controlStatus, "active");
  assert.equal(prisma.rows[0]?.retryAfterAt, null);
  assert.ok((prisma.rows[0]?.nextRunAt?.getTime() ?? 0) > Date.now());
}

async function runRecurringAssistantFailureDoesNotDisableAtReceiptCapTest(): Promise<void> {
  const everyMs = 60_000;
  const dueAt = new Date(Date.now() - 5 * everyMs);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-assistant-recurring-cap",
        assistantId: "assistant-1",
        externalRef: "job-assistant-recurring-cap",
        title: "Assistant recurring cap",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText:
          "Recurring assistant action should not auto-disable at the one-shot receipt cap.",
        scheduleJson: {
          kind: "every",
          everyMs
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        // ADR-074 F1: even at the new dead-letter limit, a recurring assistant
        // task must NOT disable — it advances to the next slot instead.
        attemptCount: 4,
        createdAt: new Date(dueAt.getTime() - everyMs)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  assistantRunner.shouldThrow = true;
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 1);
  assert.equal(prisma.rows[0]?.controlStatus, "active");
  assert.equal(prisma.rows[0]?.disabledAt ?? null, null);
  assert.equal(prisma.rows[0]?.retryAfterAt, null);
  assert.ok((prisma.rows[0]?.nextRunAt?.getTime() ?? 0) > Date.now());
}

async function runAssistantFailureExhaustionTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  // ADR-074 F1: previously this test plumbed `failedReceiptsByExternalRef: 5`
  // to flip the receipt-counting branch; the new contract is a single
  // per-task `attemptCount` column and we disable when `nextAttempt >= 5`,
  // so this row already has 4 prior attempts (the 5th is about to be bumped).
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-assistant-stop",
        assistantId: "assistant-1",
        externalRef: "job-assistant-stop",
        title: "Assistant exhausted reminder",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Assistant action should stop after failed retries.",
        scheduleJson: {
          kind: "at",
          at: dueAt.toISOString()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        attemptCount: 4,
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  assistantRunner.shouldThrow = true;
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 1);
  assert.equal(prisma.rows[0]?.controlStatus, "disabled");
  assert.equal(prisma.rows[0]?.nextRunAt, null);
  assert.equal(prisma.rows[0]?.retryAfterAt, null);
  assert.ok(prisma.rows[0]?.disabledAt instanceof Date);
}

async function runEpochResetReclaimTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(5);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-3",
        assistantId: "assistant-1",
        externalRef: "job-3",
        title: "Epoch reclaim reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Нужно переизбрать claim",
        scheduleJson: {
          kind: "every",
          everyMs: 60_000,
          anchorMs: dueAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: "stale-token",
        schedulerClaimEpoch: 4,
        schedulerClaimedAt: new Date(),
        schedulerClaimExpiresAt: new Date(Date.now() + 60_000),
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 1);
  assert.equal(assistantRunner.calls.length, 0);
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null);
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
}

async function runEpochBumpSkipsOldWorkerTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(7);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-4",
        assistantId: "assistant-1",
        externalRef: "job-4",
        title: "Epoch stale reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Старый worker не должен доставить",
        scheduleJson: {
          kind: "every",
          everyMs: 60_000,
          anchorMs: dueAt.getTime()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const claimed = await service.processDueJobsBatch(1);
  assert.equal(claimed, 1);

  prisma.rows[0]!.schedulerClaimToken = "epoch-stale-token";
  prisma.rows[0]!.schedulerClaimEpoch = 7;
  prisma.rows[0]!.schedulerClaimedAt = new Date();
  prisma.rows[0]!.schedulerClaimExpiresAt = new Date(Date.now() + 60_000);

  epochs.currentEpoch = 8;
  handler.calls = [];

  // Simulate a worker still holding the old epoch claim: it should not deliver again once epoch moved.
  await (
    service as unknown as { processClaimedTask: (task: unknown) => Promise<void> }
  ).processClaimedTask({
    id: "task-4",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    externalRef: "job-4",
    title: "Epoch stale reminder",
    audience: "user",
    actionType: null,
    actionPayload: null,
    nextRunAt: dueAt,
    payloadText: "Старый worker не должен доставить",
    schedule: {
      kind: "every",
      everyMs: 60_000,
      anchorMs: dueAt.getTime()
    },
    claimToken: "epoch-stale-token",
    claimEpoch: 7,
    lastFiredAt: null,
    lastAnsweredCheckAt: null,
    consecutiveUnanswered: 0,
    workspaceTimezone: "UTC"
  });

  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 0);
}

async function runAssistantActionBatchTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-5",
        assistantId: "assistant-1",
        externalRef: "job-5",
        title: "Project follow-up",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: { topic: "project" },
        nextRunAt: dueAt,
        payloadText: "Check whether a project follow-up would be useful.",
        scheduleJson: {
          kind: "at",
          at: dueAt.toISOString()
        },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(handler.calls.length, 0);
  assert.equal(assistantRunner.calls.length, 1);
  assert.deepEqual(assistantRunner.calls[0], {
    assistantId: "assistant-1",
    externalRef: "job-5",
    title: "Project follow-up",
    actionType: "follow_up",
    actionPayload: { topic: "project" },
    payloadText: "Check whether a project follow-up would be useful.",
    runAtMs: dueAt.getTime()
  });
  // ADR-074 F4 (no-silent-hidden-run): the row is now KEPT and flipped to
  // controlStatus="disabled" instead of being hard-deleted, so a completed
  // one-shot assistant_check stays visible in the admin task list.
  assert.equal(prisma.rows.length, 1);
  const completedRow = prisma.rows[0];
  assert.ok(completedRow !== undefined, "expected the one-shot row to remain after completion");
  assert.equal(completedRow.id, "task-5");
  assert.equal(completedRow.controlStatus, "disabled");
  assert.equal(completedRow.nextRunAt, null);
  assert.ok(
    completedRow.disabledAt instanceof Date,
    "disabledAt must be set as a completion breadcrumb"
  );
  assert.equal(
    completedRow.attemptCount,
    0,
    "attemptCount=0 distinguishes 'completed' from 'disabled-after-exhausted'"
  );
  assert.equal(
    completedRow.lastErrorMessage,
    null,
    "lastErrorMessage must remain null on a clean completion"
  );
}

// ADR-074 Slice T1 hard constraint #11 + #12: assistant audience is
// unrestricted — the policy mock MUST NOT be invoked for it.
async function runAssistantAudienceSkipsPolicyGateTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-skip-policy",
        assistantId: "assistant-1",
        externalRef: "job-skip-policy",
        title: "Assistant follow-up",
        audience: "assistant",
        actionType: "follow_up",
        actionPayloadJson: { topic: "ops" },
        nextRunAt: dueAt,
        payloadText: "Assistant-side scheduled action.",
        scheduleJson: { kind: "at", at: dueAt.toISOString() },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(assistantRunner.calls.length, 1, "assistant-side action runs");
  assert.equal(
    handler.calls.length,
    0,
    "handleInternalCronFire is not invoked for assistant audience"
  );
  assert.equal(
    policy.calls.length,
    0,
    "proactive-push policy MUST NOT be consulted on the assistant audience path"
  );
}

// ADR-074 Slice T1 hard constraints #9 + #11 + #12: user-audience push that
// the policy defers must (a) NOT call handleInternalCronFire, (b) bump the
// row's `nextRunAt` to the policy's `deferUntil`, and (c) write back the
// new counter / answered-check fields atomically with the claim release.
async function runUserAudienceDeferredByPolicyTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-deferred",
        assistantId: "assistant-deferred",
        externalRef: "job-deferred",
        title: "Deferred reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Should be deferred by quiet-hours.",
        scheduleJson: { kind: "every", everyMs: 60_000, anchorMs: dueAt.getTime() },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  const deferUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
  policy.nextDecision = {
    action: "defer",
    deferUntil,
    reason: "quiet_hours",
    consecutiveUnansweredAfter: 0,
    lastAnsweredCheckAtAfter: null
  };
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(policy.calls.length, 1, "policy gate consulted on user audience");
  assert.equal(handler.calls.length, 0, "no user-visible dispatch when deferred");
  assert.equal(
    prisma.rows[0]?.nextRunAt?.getTime(),
    deferUntil.getTime(),
    "nextRunAt bumped to deferUntil"
  );
  assert.equal(prisma.rows[0]?.lastFiredAt, null, "lastFiredAt NOT bumped on defer");
  assert.equal(prisma.rows[0]?.schedulerClaimToken, null, "claim released");
  assert.equal(prisma.rows[0]?.schedulerClaimEpoch, null);
}

// ADR-074 Slice T1 hard constraint #12: lastFiredAt is bumped atomically
// with the existing claim-release ONLY after the user-visible dispatch
// succeeds.
async function runUserAudienceAllowedBumpsLastFiredAtAtomicallyTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-allowed",
        assistantId: "assistant-allowed",
        externalRef: "job-allowed",
        title: "Allowed reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Should fire once and bump lastFiredAt.",
        scheduleJson: { kind: "every", everyMs: 60_000, anchorMs: dueAt.getTime() },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  policy.nextDecision = {
    action: "allow",
    consecutiveUnansweredAfter: 0,
    lastAnsweredCheckAtAfter: null
  };
  const before = Date.now();
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  const count = await service.processDueJobsBatch();

  assert.equal(count, 1);
  assert.equal(policy.calls.length, 1, "policy consulted exactly once");
  assert.equal(handler.calls.length, 1, "user-visible dispatch fires");
  const row = prisma.rows[0];
  assert.ok(row?.lastFiredAt instanceof Date, "lastFiredAt bumped on success");
  assert.ok((row?.lastFiredAt?.getTime() ?? 0) >= before, "lastFiredAt is set to a fresh `now`");
  assert.equal(row?.schedulerClaimToken, null, "claim released atomically");
  assert.equal(row?.schedulerClaimEpoch, null);
  assert.equal(row?.consecutiveUnanswered, 0, "counter persisted from policy decision");
}

// ADR-074 Slice T1 hard constraint #12: a failed dispatch must NOT bump
// lastFiredAt even though the policy allowed the push.
async function runUserAudienceFailedDispatchSkipsLastFiredBumpTest(): Promise<void> {
  const dueAt = new Date(Date.now() - 60_000);
  const epochs = new FakeBumpConfigGenerationService(3);
  const prisma = new FakeWorkspaceManagementPrismaService(
    [
      {
        id: "task-failed",
        assistantId: "assistant-failed",
        externalRef: "job-failed",
        title: "Failed reminder",
        audience: "user",
        actionType: null,
        actionPayloadJson: null,
        nextRunAt: dueAt,
        payloadText: "Dispatch will throw.",
        scheduleJson: { kind: "every", everyMs: 60_000, anchorMs: dueAt.getTime() },
        controlStatus: "active",
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        ...defaultRowFields(),
        createdAt: new Date(dueAt.getTime() - 60_000)
      }
    ],
    () => epochs.currentEpoch
  );
  const handler = new FakeHandleInternalCronFireService();
  handler.shouldThrow = true;
  const assistantRunner = new FakeRunScheduledAssistantActionService();
  const policy = new FakeProactivePushPolicyService();
  policy.nextDecision = {
    action: "allow",
    consecutiveUnansweredAfter: 0,
    lastAnsweredCheckAtAfter: null
  };
  const service = new PersaiScheduledActionSchedulerService(
    prisma as never,
    handler as never,
    epochs as never,
    assistantRunner as never,
    policy as unknown as ProactivePushPolicyService
  );

  await service.processDueJobsBatch();

  const row = prisma.rows[0];
  assert.equal(row?.lastFiredAt, null, "lastFiredAt MUST NOT be bumped on dispatch failure");
  assert.ok(row?.retryAfterAt instanceof Date, "row deferred to retry window");
}

async function run(): Promise<void> {
  await runSuccessBatchTest();
  await runRecurringBoundaryAdvanceTest();
  await runOneTimeUserReminderDeletedAfterDeliveryTest();
  await runFailureRetryTest();
  await runAssistantFailureRetryTest();
  await runRecurringAssistantSuccessSkipsPastIntervalsTest();
  await runRecurringAssistantFailureAdvancesTest();
  await runRecurringAssistantFailureDoesNotDisableAtReceiptCapTest();
  await runAssistantFailureExhaustionTest();
  await runEpochResetReclaimTest();
  await runEpochBumpSkipsOldWorkerTest();
  await runAssistantActionBatchTest();
  await runAssistantAudienceSkipsPolicyGateTest();
  await runUserAudienceDeferredByPolicyTest();
  await runUserAudienceAllowedBumpsLastFiredAtAtomicallyTest();
  await runUserAudienceFailedDispatchSkipsLastFiredBumpTest();
}

void run();
