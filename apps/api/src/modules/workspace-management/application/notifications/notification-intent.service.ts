import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { NotificationLifecycleStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import type {
  CreateNotificationIntentInput,
  NotificationIntentRecord
} from "./notification-platform.types";
import { NotificationRoutingService } from "./notification-routing.service";
import { ResolveWorkspaceNotificationChannelsService } from "./resolve-workspace-notification-channels.service";

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
    private readonly routing: NotificationRoutingService,
    private readonly channelResolver: ResolveWorkspaceNotificationChannelsService
  ) {}

  /**
   * Create a new notification intent.
   * Applies deduplication (idempotent on dedupeKey), quiet-hours deferral,
   * policy resolution, and persists to notification_intents.
   */
  async createIntent(input: CreateNotificationIntentInput): Promise<NotificationIntentRecord> {
    // Resolve global policy + quiet hours through the resolver so a fresh DB
    // (no operator edits yet) still picks up `notification-defaults.ts` rather
    // than silently dropping intents.
    const policy = await this.channelResolver.resolvePolicy(input.source);
    const quietHours = await this.channelResolver.resolveQuietHours();

    // Honour operator "disabled" toggle. Producers that hard-code a source
    // cannot bypass this gate — they must not call createIntent at all when
    // the policy is disabled. The only exception is when the caller explicitly
    // passes `allowedChannels` and the source is not a user-visible source
    // (e.g. internal operational events bypass nothing — operator controls them).
    if (!policy.enabled) {
      this.logger.log({
        event: "notification.intent.skipped_policy_disabled",
        workspaceId: input.workspaceId,
        source: input.source
      });
      // Return a no-op sentinel — callers only need the id for deduplication;
      // a skipped intent is never persisted so there is nothing to claim.
      return {
        id: "skipped",
        workspaceId: input.workspaceId,
        assistantId: input.assistantId ?? null,
        userId: input.userId ?? null,
        source: input.source,
        class: input.class,
        priority: input.priority,
        lifecycleStatus: NotificationLifecycleStatus.skipped,
        renderStrategy: input.renderStrategy,
        renderInstructionRef: input.renderInstructionRef ?? null,
        templateId: input.templateId ?? null,
        factPayload: input.factPayload,
        policySnapshot: { source: policy.source, enabled: false },
        allowedChannels: [],
        escalationAfterMinutes: null,
        escalationChannel: null,
        dedupeKey: input.dedupeKey ?? null,
        scheduledAt: null,
        respectQuietHours: false,
        surface: null,
        surfaceThreadKey: null,
        chatId: null,
        traceId: input.traceId ?? null,
        failureReason: "policy_disabled",
        createdAt: new Date(),
        claimedAt: null,
        deliveredAt: null,
        deadLetteredAt: null
      };
    }

    const resolvedChannels =
      input.allowedChannels && input.allowedChannels.length > 0
        ? input.allowedChannels
        : policy.channels;

    const policySnapshot: Prisma.InputJsonValue = {
      source: policy.source,
      enabled: policy.enabled,
      channels: policy.channels,
      cooldownMinutes: policy.cooldownMinutes,
      maxPerDay: policy.maxPerDay,
      escalationAfterMinutes: policy.escalationAfterMinutes,
      escalationChannel: policy.escalationChannel,
      respectQuietHours: policy.respectQuietHours,
      renderStrategy: policy.renderStrategy
    };

    const respectQuietHours = input.respectQuietHours ?? policy.respectQuietHours;
    const deferUntil = this.routing.computeQuietHoursDeferral({
      intent: { priority: input.priority, respectQuietHours },
      quietHours: quietHours.enabled
        ? {
            enabled: quietHours.enabled,
            startLocal: quietHours.startLocal,
            endLocal: quietHours.endLocal,
            timezoneMode: quietHours.timezoneMode,
            defaultTimezone: quietHours.defaultTimezone,
            appliesToSources: quietHours.appliesToSources
          }
        : null,
      source: input.source
    });

    const lifecycleStatus = deferUntil ? ("deferred_quiet_hours" as const) : ("pending" as const);

    const escalationAfterMinutes = input.escalationAfterMinutes ?? policy.escalationAfterMinutes;

    const escalationChannel = input.escalationChannel ?? policy.escalationChannel;

    // Deduplication: when a dedupeKey is provided, the (workspaceId, dedupeKey)
    // pair is unique forever (Prisma `@@unique`). We MUST treat any existing
    // row with the same key as the canonical intent — including ones that
    // already finished (delivered / failed / skipped / dead_letter). Otherwise
    // a recurring producer (e.g. idle reengagement scheduler) that derives
    // dedupeKey from a slow-changing fact (latest user message timestamp)
    // would race the unique constraint on every tick after the first delivery.
    // To re-fire, the producer must include a fresh component (period, hour,
    // etc.) in its dedupeKey.
    if (input.dedupeKey) {
      const existing = await this.prisma.notificationIntent.findUnique({
        where: {
          workspaceId_dedupeKey: {
            workspaceId: input.workspaceId,
            dedupeKey: input.dedupeKey
          }
        }
      });
      if (existing) {
        this.logger.log({
          event: "notification.intent.deduplicated",
          intentId: existing.id,
          workspaceId: input.workspaceId,
          source: input.source,
          dedupeKey: input.dedupeKey,
          existingStatus: existing.lifecycleStatus
        });
        return this.toRecord(existing);
      }
    }

    let created;
    try {
      created = await this.prisma.notificationIntent.create({
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
    } catch (err) {
      // P2002 = unique constraint violation. Two concurrent producers raced
      // past the dedupe lookup with the same (workspaceId, dedupeKey). Return
      // whichever row won the insert so callers see idempotent behaviour.
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002" && input.dedupeKey) {
        const winner = await this.prisma.notificationIntent.findUnique({
          where: {
            workspaceId_dedupeKey: {
              workspaceId: input.workspaceId,
              dedupeKey: input.dedupeKey
            }
          }
        });
        if (winner) {
          this.logger.log({
            event: "notification.intent.deduplicated_race_p2002",
            intentId: winner.id,
            workspaceId: input.workspaceId,
            source: input.source,
            dedupeKey: input.dedupeKey
          });
          return this.toRecord(winner);
        }
      }
      throw err;
    }

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
      channelCount: resolvedChannels.length
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
