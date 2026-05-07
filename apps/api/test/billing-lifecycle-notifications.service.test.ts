import assert from "node:assert/strict";
import { ScheduleBillingLifecycleNotificationsService } from "../src/modules/workspace-management/application/schedule-billing-lifecycle-notifications.service";
import { DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY } from "../src/modules/workspace-management/application/billing-lifecycle-settings";
import type { AssistantNotificationOutboxService } from "../src/modules/workspace-management/application/assistant-notification-outbox.service";
import type { ManageAdminBillingLifecycleSettingsService } from "../src/modules/workspace-management/application/manage-admin-billing-lifecycle-settings.service";

async function run(): Promise<void> {
  const jobs: Array<Record<string, unknown>> = [];
  const outboxInputs: Array<Record<string, unknown>> = [];
  const eventsById = {
    "event-1": {
      id: "event-1",
      workspaceId: "ws-1",
      userId: "user-1",
      subscriptionId: "sub-1",
      eventCode: "renewal_failed",
      nextStatus: "grace_period",
      nextPlanCode: "pro",
      nextPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      metadata: {},
      user: { email: "user@example.com" },
      subscription: { graceEndsAt: new Date("2026-05-08T00:00:00.000Z"), trialEndsAt: null }
    },
    "event-2": {
      id: "event-2",
      workspaceId: "ws-1",
      userId: "user-1",
      subscriptionId: "sub-1",
      eventCode: "billing_reminder_requested",
      nextStatus: "expired_fallback",
      nextPlanCode: "starter",
      nextPeriodEndsAt: null,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      metadata: { adminAction: "send_billing_reminder" },
      user: { email: "user@example.com" },
      subscription: { graceEndsAt: null, trialEndsAt: null }
    },
    "event-3": {
      id: "event-3",
      workspaceId: "ws-1",
      userId: "user-1",
      subscriptionId: "sub-1",
      eventCode: "grace_started",
      nextStatus: "grace_period",
      nextPlanCode: "pro",
      nextPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      metadata: {},
      user: { email: "user@example.com" },
      subscription: { graceEndsAt: new Date("2026-05-08T00:00:00.000Z"), trialEndsAt: null }
    },
    "event-4": {
      id: "event-4",
      workspaceId: "ws-1",
      userId: "user-1",
      subscriptionId: "sub-1",
      eventCode: "grace_extended",
      nextStatus: "grace_period",
      nextPlanCode: "pro",
      nextPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z"),
      createdAt: new Date("2026-05-04T00:00:00.000Z"),
      metadata: {},
      user: { email: "user@example.com" },
      subscription: { graceEndsAt: new Date("2026-05-12T00:00:00.000Z"), trialEndsAt: null }
    }
  } as const;
  const prisma = {
    workspaceSubscriptionLifecycleEvent: {
      async findUnique(args: { where: { id: keyof typeof eventsById } }) {
        return eventsById[args.where.id] ?? null;
      }
    },
    assistant: {
      async findFirst() {
        return { id: "assistant-1", userId: "user-1", workspaceId: "ws-1" };
      }
    },
    planCatalogPlan: {
      async findUnique() {
        return { displayName: "Pro" };
      }
    },
    billingLifecycleNotificationJob: {
      async upsert(args: { create: Record<string, unknown> }) {
        const existing = jobs.find((job) => job.dedupeKey === args.create.dedupeKey);
        if (existing === undefined) {
          jobs.push({
            id: `job-${jobs.length + 1}`,
            createdAt: new Date(`2026-05-03T00:00:${String(jobs.length).padStart(2, "0")}.000Z`),
            ...args.create
          });
        }
        return {};
      },
      async findFirst(args: {
        where: {
          workspaceId: string;
          subscriptionId: string | null;
          channel: string;
          notificationCode: string;
          status: { in: string[] };
        };
      }) {
        const matches = jobs.filter(
          (job) =>
            job.workspaceId === args.where.workspaceId &&
            job.subscriptionId === args.where.subscriptionId &&
            job.channel === args.where.channel &&
            job.notificationCode === args.where.notificationCode &&
            args.where.status.in.includes(String(job.status))
        );
        return matches.at(-1) ?? null;
      },
      async findMany(args: {
        where?: {
          channel?: string;
          status?: string;
          scheduledFor?: { lte: Date };
          assistantId?: { not: null };
        };
      }) {
        return jobs.filter((job) => {
          if (
            args.where?.channel !== undefined &&
            String(job.channel) !== String(args.where.channel)
          ) {
            return false;
          }
          if (
            args.where?.status !== undefined &&
            String(job.status) !== String(args.where.status)
          ) {
            return false;
          }
          if (args.where?.scheduledFor?.lte instanceof Date) {
            const scheduledFor = job.scheduledFor;
            if (!(scheduledFor instanceof Date) || scheduledFor > args.where.scheduledFor.lte) {
              return false;
            }
          }
          if (args.where?.assistantId?.not === null) {
            return job.assistantId !== null && job.assistantId !== undefined;
          }
          return true;
        });
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const index = jobs.findIndex((job) => job.id === args.where.id);
        assert.notEqual(index, -1);
        jobs[index] = { ...jobs[index], ...args.data };
        return jobs[index];
      },
      async updateMany(args: {
        where: {
          workspaceId: string;
          subscriptionId: string | null;
          channel: string;
          notificationCode: string;
          status: { in: string[] };
          id: { not: string };
        };
        data: Record<string, unknown>;
      }) {
        let count = 0;
        for (let index = 0; index < jobs.length; index += 1) {
          const job = jobs[index];
          if (
            job.workspaceId === args.where.workspaceId &&
            job.subscriptionId === args.where.subscriptionId &&
            job.channel === args.where.channel &&
            job.notificationCode === args.where.notificationCode &&
            args.where.status.in.includes(String(job.status)) &&
            job.id !== args.where.id.not
          ) {
            jobs[index] = { ...job, ...args.data };
            count += 1;
          }
        }
        return { count };
      }
    }
  };
  const service = new ScheduleBillingLifecycleNotificationsService(
    prisma as never,
    {
      async resolveSettings() {
        return {
          schema: "persai.billingLifecycleSettings.v2",
          gracePeriodDays: 5,
          globalFallbackPlanCode: "starter",
          notificationPolicy: {
            ...DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY,
            assistantPushEnabled: true
          },
          updatedAt: "2026-05-03T00:00:00.000Z"
        };
      }
    } as Pick<
      ManageAdminBillingLifecycleSettingsService,
      "resolveSettings"
    > as ManageAdminBillingLifecycleSettingsService,
    {
      async enqueue(input: Record<string, unknown>) {
        outboxInputs.push(input);
        return {
          id: "outbox-1",
          status: "pending",
          dedupeKey: String(input.dedupeKey),
          created: true
        };
      }
    } as Pick<AssistantNotificationOutboxService, "enqueue"> as AssistantNotificationOutboxService
  );

  await service.scheduleForLifecycleEventIds(["event-1"]);
  await service.scheduleForLifecycleEventIds(["event-2"]);
  await service.scheduleForLifecycleEventIds(["event-3"]);
  await service.scheduleForLifecycleEventIds(["event-4"]);

  assert.equal(jobs.length, 7);
  assert.equal(jobs[0]?.channel, "email");
  assert.equal(jobs[0]?.status, "pending");
  assert.equal(jobs[0]?.recipientEmail, "user@example.com");
  assert.equal(jobs[1]?.channel, "assistant_notification");
  assert.equal(jobs[1]?.status, "enqueued");
  assert.equal(jobs[1]?.assistantNotificationOutboxId, "outbox-1");
  assert.equal(outboxInputs[0]?.source, "billing_lifecycle");
  assert.match(String(outboxInputs[0]?.text), /Payment renewal failed/);
  assert.equal(jobs[2]?.notificationCode, "billing_reminder");
  assert.equal(jobs[3]?.notificationCode, "billing_reminder");
  assert.match(String(outboxInputs[1]?.text), /manual billing reminder/i);

  const graceEndingJobs = jobs.filter((job) => job.notificationCode === "grace_ending");
  assert.equal(graceEndingJobs.length, 3);
  assert.equal(graceEndingJobs[0]?.channel, "email");
  assert.equal(graceEndingJobs[0]?.lifecycleEventId, "event-4");
  assert.equal(graceEndingJobs[0]?.status, "pending");
  assert.equal(
    (graceEndingJobs[0]?.scheduledFor as Date).toISOString(),
    "2026-05-11T00:00:00.000Z"
  );
  assert.equal(graceEndingJobs[1]?.channel, "assistant_notification");
  assert.equal(graceEndingJobs[1]?.lifecycleEventId, "event-3");
  assert.equal(graceEndingJobs[1]?.status, "enqueued");
  assert.equal(
    (graceEndingJobs[1]?.scheduledFor as Date).toISOString(),
    "2026-05-07T00:00:00.000Z"
  );
  assert.equal(graceEndingJobs[2]?.channel, "assistant_notification");
  assert.equal(graceEndingJobs[2]?.lifecycleEventId, "event-4");
  assert.equal(graceEndingJobs[2]?.status, "pending");
  assert.equal(
    (graceEndingJobs[2]?.scheduledFor as Date).toISOString(),
    "2026-05-11T00:00:00.000Z"
  );
}

void run();
