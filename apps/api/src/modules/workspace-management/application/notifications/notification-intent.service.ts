import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import type {
  CreateNotificationIntentInput,
  NotificationIntentRecord
} from "./notification-platform.types";
import { NotificationRoutingService } from "./notification-routing.service";

/**
 * Single entry point for creating notification intents.
 * All notification producers call this and only this.
 * ADR-088 §Service architecture.
 */
@Injectable()
export class NotificationIntentService {
  private readonly logger = new Logger(NotificationIntentService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly routing: NotificationRoutingService
  ) {}

  /**
   * Create a new notification intent.
   * Applies deduplication (idempotent on dedupeKey), quiet-hours deferral,
   * policy resolution, and persists to notification_intents.
   */
  async createIntent(input: CreateNotificationIntentInput): Promise<NotificationIntentRecord> {
    // Resolve global policy snapshot for this source
    const policyRow = await this.prisma.notificationPolicy.findUnique({
      where: { source: input.source }
    });

    const quietHoursRow = await this.prisma.notificationQuietHours.findFirst({});

    const channelRegistryRows = await this.prisma.notificationChannelRegistry.findMany({
      where: { enabled: true }
    });

    const resolvedChannels =
      input.allowedChannels && input.allowedChannels.length > 0
        ? input.allowedChannels
        : (policyRow?.channels ?? []);

    const policySnapshot: Prisma.InputJsonValue = policyRow
      ? {
          source: policyRow.source,
          enabled: policyRow.enabled,
          channels: policyRow.channels,
          cooldownMinutes: policyRow.cooldownMinutes,
          maxPerDay: policyRow.maxPerDay,
          escalationAfterMinutes: policyRow.escalationAfterMinutes,
          escalationChannel: policyRow.escalationChannel,
          respectQuietHours: policyRow.respectQuietHours,
          renderStrategy: policyRow.renderStrategy
        }
      : { source: input.source };

    // Determine quiet-hours deferral
    const respectQuietHours = input.respectQuietHours ?? policyRow?.respectQuietHours ?? true;
    const deferUntil = this.routing.computeQuietHoursDeferral({
      intent: { priority: input.priority, respectQuietHours },
      quietHours: quietHoursRow
        ? {
            enabled: quietHoursRow.enabled,
            startLocal: quietHoursRow.startLocal,
            endLocal: quietHoursRow.endLocal,
            timezoneMode: quietHoursRow.timezoneMode,
            defaultTimezone: quietHoursRow.defaultTimezone,
            appliesToSources: quietHoursRow.appliesToSources
          }
        : null,
      source: input.source
    });

    const lifecycleStatus = deferUntil ? ("deferred_quiet_hours" as const) : ("pending" as const);

    const escalationAfterMinutes =
      input.escalationAfterMinutes ?? policyRow?.escalationAfterMinutes ?? null;

    const escalationChannel = input.escalationChannel ?? policyRow?.escalationChannel ?? null;

    // Upsert with deduplication if dedupeKey provided
    if (input.dedupeKey) {
      const existing = await this.prisma.notificationIntent.findFirst({
        where: {
          workspaceId: input.workspaceId,
          dedupeKey: input.dedupeKey,
          lifecycleStatus: {
            in: ["pending", "claimed", "deferred_quiet_hours", "deferred_rate_limit"]
          }
        }
      });
      if (existing) {
        this.logger.log({
          event: "notification.intent.deduplicated",
          intentId: existing.id,
          workspaceId: input.workspaceId,
          source: input.source,
          dedupeKey: input.dedupeKey
        });
        return this.toRecord(existing);
      }
    }

    const created = await this.prisma.notificationIntent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId ?? null,
        userId: input.userId ?? null,
        source: input.source,
        class: input.class,
        priority: input.priority,
        lifecycleStatus,
        renderStrategy: input.renderStrategy,
        renderInstructionRef: input.renderInstructionRef ?? null,
        templateId: input.templateId ?? null,
        factPayload: input.factPayload as Prisma.InputJsonValue,
        policySnapshot,
        allowedChannels: resolvedChannels,
        escalationAfterMinutes,
        escalationChannel,
        dedupeKey: input.dedupeKey ?? null,
        scheduledAt: input.scheduledAt ?? deferUntil ?? null,
        respectQuietHours,
        surface: input.surface ?? null,
        surfaceThreadKey: input.surfaceThreadKey ?? null,
        chatId: input.chatId ?? null,
        traceId: input.traceId ?? null
      }
    });

    const record = this.toRecord(created);

    const logEvent = deferUntil ? "notification.intent.deferred" : "notification.intent.created";
    this.logger.log({
      event: logEvent,
      intentId: record.id,
      workspaceId: record.workspaceId,
      assistantId: record.assistantId,
      source: record.source,
      class: record.class,
      priority: record.priority,
      renderStrategy: record.renderStrategy,
      lifecycleStatus: record.lifecycleStatus,
      traceId: record.traceId,
      dedupeKey: record.dedupeKey,
      channelCount: resolvedChannels.length,
      channelHealth: channelRegistryRows.map((r) => ({
        type: r.channelType,
        health: r.healthStatus
      }))
    });

    return record;
  }

  private toRecord(row: {
    id: string;
    workspaceId: string;
    assistantId: string | null;
    userId: string | null;
    source: string;
    class: string;
    priority: string;
    lifecycleStatus: string;
    renderStrategy: string;
    renderInstructionRef: string | null;
    templateId: string | null;
    factPayload: unknown;
    policySnapshot: unknown;
    allowedChannels: string[];
    escalationAfterMinutes: number | null;
    escalationChannel: string | null;
    dedupeKey: string | null;
    scheduledAt: Date | null;
    respectQuietHours: boolean;
    surface: string | null;
    surfaceThreadKey: string | null;
    chatId: string | null;
    traceId: string | null;
    failureReason: string | null;
    createdAt: Date;
    claimedAt: Date | null;
    deliveredAt: Date | null;
    deadLetteredAt: Date | null;
  }): NotificationIntentRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      assistantId: row.assistantId,
      userId: row.userId,
      source: row.source as NotificationIntentRecord["source"],
      class: row.class as NotificationIntentRecord["class"],
      priority: row.priority as NotificationIntentRecord["priority"],
      lifecycleStatus: row.lifecycleStatus as NotificationIntentRecord["lifecycleStatus"],
      renderStrategy: row.renderStrategy as NotificationIntentRecord["renderStrategy"],
      renderInstructionRef: row.renderInstructionRef,
      templateId: row.templateId,
      factPayload: (row.factPayload as Record<string, unknown>) ?? {},
      policySnapshot: (row.policySnapshot as Record<string, unknown>) ?? {},
      allowedChannels: row.allowedChannels,
      escalationAfterMinutes: row.escalationAfterMinutes,
      escalationChannel: row.escalationChannel,
      dedupeKey: row.dedupeKey,
      scheduledAt: row.scheduledAt,
      respectQuietHours: row.respectQuietHours,
      surface: row.surface,
      surfaceThreadKey: row.surfaceThreadKey,
      chatId: row.chatId,
      traceId: row.traceId,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      claimedAt: row.claimedAt,
      deliveredAt: row.deliveredAt,
      deadLetteredAt: row.deadLetteredAt
    };
  }
}
