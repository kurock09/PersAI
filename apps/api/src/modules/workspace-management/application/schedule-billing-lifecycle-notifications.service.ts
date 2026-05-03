import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantNotificationOutboxService } from "./assistant-notification-outbox.service";
import { ManageAdminBillingLifecycleSettingsService } from "./manage-admin-billing-lifecycle-settings.service";
import type {
  BillingLifecycleNotificationCode,
  BillingLifecycleNotificationPolicy,
  BillingLifecycleNotificationRule
} from "./billing-lifecycle-settings";

const BILLING_NOTIFICATION_POLL_INTERVAL_MS = 60_000;
const BILLING_NOTIFICATION_BATCH_SIZE = 20;

type LifecycleEventRow = {
  id: string;
  workspaceId: string;
  userId: string | null;
  subscriptionId: string | null;
  eventCode: string;
  nextStatus: string | null;
  nextPlanCode: string | null;
  nextPeriodEndsAt: Date | null;
  createdAt: Date;
  metadata: unknown;
  user: { email: string } | null;
  subscription: { graceEndsAt: Date | null; trialEndsAt: Date | null } | null;
};

type AssistantRef = {
  id: string;
  userId: string;
  workspaceId: string;
};

type NotificationIntent = {
  notificationCode: BillingLifecycleNotificationCode | "billing_reminder";
  scheduledFor: Date;
  relevantDate: Date | null;
};

type NotificationCopy = {
  subject: string;
  text: string;
};

function subtractDays(value: Date, days: number): Date {
  return new Date(value.getTime() - days * 86_400_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class ScheduleBillingLifecycleNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleBillingLifecycleNotificationsService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly settingsService: ManageAdminBillingLifecycleSettingsService,
    private readonly assistantNotificationOutboxService: AssistantNotificationOutboxService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(BILLING_NOTIFICATION_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async scheduleForLifecycleEventIds(eventIds: string[]): Promise<void> {
    for (const eventId of eventIds) {
      await this.scheduleForLifecycleEventId(eventId);
    }
    await this.processDueAssistantNotificationJobs();
  }

  async scheduleForLifecycleEventId(eventId: string): Promise<void> {
    const event = await this.prisma.workspaceSubscriptionLifecycleEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        subscriptionId: true,
        eventCode: true,
        nextStatus: true,
        nextPlanCode: true,
        nextPeriodEndsAt: true,
        createdAt: true,
        metadata: true,
        user: { select: { email: true } },
        subscription: { select: { graceEndsAt: true, trialEndsAt: true } }
      }
    });
    if (event === null) {
      return;
    }

    const settings = await this.settingsService.resolveSettings();
    const intents = this.resolveNotificationIntents(event, settings.notificationPolicy);
    if (intents.length === 0) {
      return;
    }

    const assistant = await this.resolveAssistant(event.workspaceId, event.userId);
    const planDisplayName = await this.resolvePlanDisplayName(event.nextPlanCode);

    for (const intent of intents) {
      const copy = this.renderStaticCopy({
        notificationCode: intent.notificationCode,
        planDisplayName,
        status: event.nextStatus,
        relevantDate: intent.relevantDate
      });
      await this.createEmailJob(event, intent, copy);
      if (settings.notificationPolicy.assistantPushEnabled) {
        await this.createAssistantNotificationJob(event, assistant, intent, copy);
      }
    }
  }

  async processDueAssistantNotificationJobs(
    limit = BILLING_NOTIFICATION_BATCH_SIZE
  ): Promise<number> {
    const jobs = await this.prisma.billingLifecycleNotificationJob.findMany({
      where: {
        channel: "assistant_notification",
        status: "pending",
        scheduledFor: { lte: new Date() },
        assistantId: { not: null }
      },
      orderBy: { scheduledFor: "asc" },
      take: Math.max(1, Math.floor(limit))
    });

    let processed = 0;
    for (const job of jobs) {
      try {
        const outbox = await this.assistantNotificationOutboxService.enqueue({
          assistantId: job.assistantId!,
          source: "billing_lifecycle",
          sourceId: job.id,
          status: "ok",
          text: job.text,
          metadata: {
            billingLifecycleNotificationJobId: job.id,
            notificationCode: job.notificationCode,
            lifecycleEventId: job.lifecycleEventId,
            channel: job.channel,
            scheduledFor: job.scheduledFor.toISOString()
          },
          dedupeKey: `billing_lifecycle:${job.id}:assistant_notification`
        });
        await this.prisma.billingLifecycleNotificationJob.update({
          where: { id: job.id },
          data: {
            status: "enqueued",
            assistantNotificationOutboxId: outbox.id,
            enqueuedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        processed += 1;
      } catch (error) {
        await this.prisma.billingLifecycleNotificationJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            failedAt: new Date(),
            lastErrorCode: "assistant_outbox_enqueue_failed",
            lastErrorMessage: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
    return processed;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      this.scheduleNext(BILLING_NOTIFICATION_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      const processed = await this.processDueAssistantNotificationJobs();
      if (processed > 0) {
        this.logger.log(`Enqueued ${processed} billing lifecycle notification job(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Billing lifecycle notification scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
      this.scheduleNext(BILLING_NOTIFICATION_POLL_INTERVAL_MS);
    }
  }

  private resolveNotificationIntents(
    event: LifecycleEventRow,
    policy: BillingLifecycleNotificationPolicy
  ): NotificationIntent[] {
    const rules = new Map(policy.rules.map((rule) => [rule.notificationCode, rule]));
    const intent = (
      notificationCode: BillingLifecycleNotificationCode,
      relevantDate: Date | null,
      defaultScheduledFor: Date
    ): NotificationIntent | null => {
      const rule = rules.get(notificationCode);
      if (rule === undefined || !rule.enabled) {
        return null;
      }
      const scheduledFor = this.resolveScheduledFor(rule, relevantDate, defaultScheduledFor);
      return { notificationCode, scheduledFor, relevantDate };
    };

    const trialEndsAt = event.subscription?.trialEndsAt ?? event.nextPeriodEndsAt;
    const graceEndsAt = event.subscription?.graceEndsAt ?? null;
    const candidates: Array<NotificationIntent | null> = [];
    if (event.eventCode === "trial_started" && trialEndsAt !== null) {
      candidates.push(intent("trial_ending", trialEndsAt, event.createdAt));
    }
    if (event.eventCode === "trial_extended" && trialEndsAt !== null) {
      candidates.push(intent("trial_ending", trialEndsAt, event.createdAt));
    }
    if (event.eventCode === "trial_expired") {
      candidates.push(intent("trial_expired", event.createdAt, event.createdAt));
    }
    if (event.eventCode === "renewal_failed") {
      candidates.push(intent("renewal_failed", event.createdAt, event.createdAt));
    }
    if (event.eventCode === "grace_started" && graceEndsAt !== null) {
      candidates.push(intent("grace_ending", graceEndsAt, event.createdAt));
    }
    if (event.eventCode === "grace_extended" && graceEndsAt !== null) {
      candidates.push(intent("grace_ending", graceEndsAt, event.createdAt));
    }
    if (event.eventCode === "grace_expired") {
      candidates.push(intent("grace_expired", event.createdAt, event.createdAt));
    }
    if (event.eventCode === "payment_recovered") {
      candidates.push(intent("payment_recovered", event.createdAt, event.createdAt));
    }
    if (event.eventCode === "billing_reminder_requested") {
      candidates.push({
        notificationCode: "billing_reminder",
        scheduledFor: event.createdAt,
        relevantDate: event.createdAt
      });
    }
    return candidates.filter((candidate): candidate is NotificationIntent => candidate !== null);
  }

  private resolveScheduledFor(
    rule: BillingLifecycleNotificationRule,
    relevantDate: Date | null,
    defaultScheduledFor: Date
  ): Date {
    if (rule.offsetDays === null || relevantDate === null) {
      return defaultScheduledFor;
    }
    return subtractDays(relevantDate, rule.offsetDays);
  }

  private async createEmailJob(
    event: LifecycleEventRow,
    intent: NotificationIntent,
    copy: NotificationCopy
  ): Promise<void> {
    await this.upsertJob({
      event,
      intent,
      copy,
      channel: "email",
      assistant: null,
      recipientEmail: event.user?.email ?? null,
      status: event.user?.email ? "pending" : "skipped",
      skipReason: event.user?.email ? null : "missing_user_email"
    });
  }

  private async createAssistantNotificationJob(
    event: LifecycleEventRow,
    assistant: AssistantRef | null,
    intent: NotificationIntent,
    copy: NotificationCopy
  ): Promise<void> {
    await this.upsertJob({
      event,
      intent,
      copy,
      channel: "assistant_notification",
      assistant,
      recipientEmail: null,
      status: assistant === null ? "skipped" : "pending",
      skipReason: assistant === null ? "assistant_notification_unavailable" : null
    });
  }

  private async upsertJob(input: {
    event: LifecycleEventRow;
    intent: NotificationIntent;
    copy: NotificationCopy;
    channel: "email" | "assistant_notification";
    assistant: AssistantRef | null;
    recipientEmail: string | null;
    status: "pending" | "skipped";
    skipReason: string | null;
  }): Promise<void> {
    const now = new Date();
    const dedupeKey = [
      "billing_lifecycle",
      input.channel,
      input.intent.notificationCode,
      input.event.id
    ].join(":");
    const createData = {
      workspaceId: input.event.workspaceId,
      userId: input.event.userId,
      assistantId: input.assistant?.id ?? null,
      subscriptionId: input.event.subscriptionId,
      lifecycleEventId: input.event.id,
      eventCode: input.event.eventCode,
      notificationCode: input.intent.notificationCode,
      channel: input.channel,
      status: input.status,
      dedupeKey,
      scheduledFor: input.intent.scheduledFor,
      recipientEmail: input.recipientEmail,
      subject: input.copy.subject,
      text: input.copy.text,
      metadata: this.toJsonValue({
        schema: "persai.billingLifecycleNotificationJob.v1",
        lifecycleEventId: input.event.id,
        lifecycleEventMetadata: isRecord(input.event.metadata) ? input.event.metadata : {},
        relevantDate: input.intent.relevantDate?.toISOString() ?? null,
        skipReason: input.skipReason
      }),
      ...(input.status === "skipped" ? { skippedAt: now, lastErrorCode: input.skipReason } : {})
    };

    if (this.isReschedulableNotificationCode(input.intent.notificationCode)) {
      const reschedulableStatuses: Array<"pending" | "skipped"> = ["pending", "skipped"];
      const activeWhere = {
        workspaceId: input.event.workspaceId,
        subscriptionId: input.event.subscriptionId,
        channel: input.channel,
        notificationCode: input.intent.notificationCode,
        status: { in: reschedulableStatuses }
      };
      const existing = await this.prisma.billingLifecycleNotificationJob.findFirst({
        where: activeWhere,
        orderBy: [{ createdAt: "desc" }]
      });
      if (existing !== null) {
        await this.prisma.billingLifecycleNotificationJob.update({
          where: { id: existing.id },
          data: {
            assistantId: input.assistant?.id ?? null,
            lifecycleEventId: input.event.id,
            eventCode: input.event.eventCode,
            status: input.status,
            scheduledFor: input.intent.scheduledFor,
            recipientEmail: input.recipientEmail,
            subject: input.copy.subject,
            text: input.copy.text,
            metadata: createData.metadata,
            assistantNotificationOutboxId: null,
            enqueuedAt: null,
            skippedAt: input.status === "skipped" ? now : null,
            failedAt: null,
            lastErrorCode: input.status === "skipped" ? input.skipReason : null,
            lastErrorMessage: null
          }
        });
        await this.prisma.billingLifecycleNotificationJob.updateMany({
          where: {
            ...activeWhere,
            id: { not: existing.id }
          },
          data: {
            status: "skipped",
            skippedAt: now,
            lastErrorCode: "rescheduled_by_lifecycle_extension",
            lastErrorMessage: "Superseded by a newer billing lifecycle extension."
          }
        });
        return;
      }
    }

    await this.prisma.billingLifecycleNotificationJob.upsert({
      where: { dedupeKey },
      create: createData,
      update: {}
    });
  }

  private async resolveAssistant(
    workspaceId: string,
    userId: string | null
  ): Promise<AssistantRef | null> {
    return this.prisma.assistant.findFirst({
      where: {
        workspaceId,
        ...(userId === null ? {} : { userId })
      },
      select: { id: true, userId: true, workspaceId: true }
    });
  }

  private async resolvePlanDisplayName(planCode: string | null): Promise<string> {
    if (planCode === null) {
      return "current plan";
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { displayName: true }
    });
    return plan?.displayName ?? planCode;
  }

  private renderStaticCopy(input: {
    notificationCode: BillingLifecycleNotificationCode | "billing_reminder";
    planDisplayName: string;
    status: string | null;
    relevantDate: Date | null;
  }): NotificationCopy {
    const dateText = input.relevantDate?.toISOString() ?? "now";
    const facts = `Plan: ${input.planDisplayName}. Status: ${input.status ?? "billing lifecycle update"}. Date: ${dateText}.`;
    switch (input.notificationCode) {
      case "trial_ending":
        return {
          subject: "Your PersAI trial is ending soon",
          text: `${facts} Your trial is ending soon. To keep paid features active, choose a paid plan before the trial ends.`
        };
      case "trial_expired":
        return {
          subject: "Your PersAI trial ended",
          text: `${facts} Your trial ended and your workspace moved to the configured fallback plan. You can restore paid access by upgrading.`
        };
      case "renewal_failed":
        return {
          subject: "PersAI payment renewal failed",
          text: `${facts} Payment renewal failed. Paid access remains active during grace; update payment to avoid fallback.`
        };
      case "grace_ending":
        return {
          subject: "PersAI grace period is ending soon",
          text: `${facts} Your payment recovery grace period is ending soon. Update payment to keep paid access active.`
        };
      case "grace_expired":
        return {
          subject: "PersAI workspace moved to fallback plan",
          text: `${facts} Grace expired and your workspace moved to the configured fallback plan. Restore payment to recover paid access.`
        };
      case "payment_recovered":
        return {
          subject: "PersAI payment recovered",
          text: `${facts} Payment recovered and paid access is active for the current billing period.`
        };
      case "billing_reminder":
        return {
          subject: "PersAI billing reminder",
          text: `${facts} This is a manual billing reminder from PersAI support. Review the current billing state and take action if you want to keep or restore paid access.`
        };
    }
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isReschedulableNotificationCode(
    value: BillingLifecycleNotificationCode | "billing_reminder"
  ): value is BillingLifecycleNotificationCode {
    return value === "trial_ending" || value === "grace_ending";
  }
}
