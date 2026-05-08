import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { NOTIFICATION_CHANNEL_ADAPTERS } from "../../infrastructure/notifications/channel-adapters/channel-adapter.interface";
import type { NotificationChannelAdapter } from "../../infrastructure/notifications/channel-adapters/channel-adapter.interface";
import { StaticFallbackRendererService } from "./render/static-fallback-renderer.service";
import { TemplateRendererService } from "./render/template-renderer.service";
import { GroundedLlmRendererService } from "./render/grounded-llm-renderer.service";
import type { NotificationIntentRecord, RenderedPayload } from "./notification-platform.types";

const WORKER_POLL_INTERVAL_MS = 10_000;
const WORKER_BATCH_SIZE = 10;
const WORKER_CLAIM_TTL_MS = 120_000;

/**
 * Single durable worker for notification delivery.
 * Claims pending/scheduled intents, renders, delivers via channel adapters,
 * handles escalation (single hop), marks dead-letter on second failure.
 * ADR-088 §Service architecture – notification-delivery-worker.service.ts.
 */
@Injectable()
export class NotificationDeliveryWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryWorkerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(NOTIFICATION_CHANNEL_ADAPTERS)
    private readonly channelAdapters: NotificationChannelAdapter[],
    private readonly templateRenderer: TemplateRendererService,
    private readonly groundedLlmRenderer: GroundedLlmRendererService,
    private readonly staticFallbackRenderer: StaticFallbackRendererService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(WORKER_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runOnce();
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    if (this.stopped || this.running) {
      this.scheduleNext(WORKER_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      await this.processBatch();
    } catch (err) {
      this.logger.error({ event: "notification.worker.batch_error", error: String(err) });
    } finally {
      this.running = false;
      this.scheduleNext(WORKER_POLL_INTERVAL_MS);
    }
  }

  private async processBatch(): Promise<void> {
    const _claimToken = randomUUID();
    const claimExpiresAt = new Date(Date.now() + WORKER_CLAIM_TTL_MS);
    const now = new Date();

    // Claim a batch of claimable intents atomically
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.notificationIntent.findMany({
        where: {
          lifecycleStatus: { in: ["pending", "deferred_quiet_hours", "deferred_rate_limit"] },
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
          claimedAt: null
        },
        take: WORKER_BATCH_SIZE,
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
      });

      if (rows.length === 0) {
        return [];
      }

      const ids = rows.map((r) => r.id);
      await tx.notificationIntent.updateMany({
        where: { id: { in: ids } },
        data: {
          lifecycleStatus: "claimed",
          claimedAt: now
        }
      });

      return rows;
    });

    for (const row of claimed) {
      const intent = this.rowToRecord(row);
      await this.deliverIntent(intent, claimExpiresAt);
    }
  }

  private async deliverIntent(intent: NotificationIntentRecord, _claimExpiry: Date): Promise<void> {
    try {
      const channelRegistry = await this.prisma.notificationChannelRegistry.findMany({});

      const primaryChannel = intent.allowedChannels[0] ?? null;
      if (!primaryChannel) {
        await this.markFailed(intent, "no_channel_configured");
        return;
      }

      const channelRow = channelRegistry.find(
        (r) => (r.channelType as string) === primaryChannel && r.enabled
      );
      if (!channelRow) {
        await this.markFailed(intent, `channel_not_configured:${primaryChannel}`);
        return;
      }

      const adapter = this.channelAdapters.find(
        (a) => (a.channelType as string) === primaryChannel
      );
      if (!adapter) {
        await this.markFailed(intent, `adapter_not_found:${primaryChannel}`);
        return;
      }

      // Render
      const rendered = await this.render(intent);

      // Create delivery attempt record
      const attempt = await this.prisma.notificationDeliveryAttempt.create({
        data: {
          intentId: intent.id,
          attemptNumber: 1,
          channel: primaryChannel,
          status: "pending"
        }
      });

      this.logger.log({
        event: "notification.delivery.attempted",
        intentId: intent.id,
        workspaceId: intent.workspaceId,
        assistantId: intent.assistantId,
        userId: intent.userId,
        source: intent.source,
        class: intent.class,
        priority: intent.priority,
        renderStrategy: intent.renderStrategy,
        channel: primaryChannel,
        attemptNumber: 1,
        latencyMs: Date.now() - intent.createdAt.getTime(),
        outcome: "attempted",
        traceId: intent.traceId
      });

      // Deliver
      const channelRegistryRecord = {
        id: channelRow.id,
        channelType: channelRow.channelType,
        enabled: channelRow.enabled,
        config: channelRow.config as Record<string, unknown>,
        healthStatus: channelRow.healthStatus,
        consecutiveFailures: channelRow.consecutiveFailures,
        lastDeliveryAt: channelRow.lastDeliveryAt,
        lastFailureAt: channelRow.lastFailureAt,
        createdAt: channelRow.createdAt,
        updatedAt: channelRow.updatedAt
      };

      const result = await adapter.deliver(intent, rendered, channelRegistryRecord);

      if (result.status === "delivered") {
        await this.prisma.$transaction([
          this.prisma.notificationDeliveryAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "delivered",
              providerRef: result.providerRef ?? null,
              completedAt: new Date()
            }
          }),
          this.prisma.notificationIntent.update({
            where: { id: intent.id },
            data: { lifecycleStatus: "delivered", deliveredAt: new Date() }
          }),
          this.prisma.notificationChannelRegistry.update({
            where: { id: channelRow.id },
            data: {
              consecutiveFailures: 0,
              lastDeliveryAt: new Date(),
              healthStatus: "healthy"
            }
          })
        ]);

        this.logger.log({
          event: "notification.delivery.delivered",
          intentId: intent.id,
          workspaceId: intent.workspaceId,
          assistantId: intent.assistantId,
          userId: intent.userId,
          source: intent.source,
          class: intent.class,
          priority: intent.priority,
          renderStrategy: intent.renderStrategy,
          channel: primaryChannel,
          attemptNumber: 1,
          latencyMs: Date.now() - intent.createdAt.getTime(),
          outcome: "delivered",
          providerRef: result.providerRef,
          traceId: intent.traceId
        });
      } else {
        // Primary failed — try escalation if configured
        await this.prisma.notificationDeliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            status: result.status === "bounced" ? "bounced" : "failed",
            error: (result.error as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
            completedAt: new Date()
          }
        });

        await this.prisma.notificationChannelRegistry.update({
          where: { id: channelRow.id },
          data: {
            consecutiveFailures: { increment: 1 },
            lastFailureAt: new Date()
          }
        });

        this.logger.warn({
          event: "notification.delivery.failed",
          intentId: intent.id,
          workspaceId: intent.workspaceId,
          assistantId: intent.assistantId,
          userId: intent.userId,
          source: intent.source,
          class: intent.class,
          priority: intent.priority,
          renderStrategy: intent.renderStrategy,
          channel: primaryChannel,
          attemptNumber: 1,
          latencyMs: Date.now() - intent.createdAt.getTime(),
          outcome: result.status,
          errorCode: result.error?.code,
          traceId: intent.traceId
        });

        const escalationChannel = intent.escalationChannel;
        if (escalationChannel && escalationChannel !== primaryChannel) {
          await this.tryEscalation(intent, escalationChannel, attempt.id);
        } else {
          await this.markDeadLetter(intent, result.error ?? { reason: result.status });
        }
      }
    } catch (err) {
      this.logger.error({
        event: "notification.delivery.worker_error",
        intentId: intent.id,
        error: String(err)
      });
      await this.markFailed(intent, `worker_error:${String(err).slice(0, 200)}`);
    }
  }

  private async tryEscalation(
    intent: NotificationIntentRecord,
    escalationChannel: string,
    primaryAttemptId: string
  ): Promise<void> {
    const channelRow = await this.prisma.notificationChannelRegistry.findFirst({
      where: {
        channelType: escalationChannel as never,
        enabled: true
      }
    });

    const adapter = this.channelAdapters.find(
      (a) => (a.channelType as string) === escalationChannel
    );

    if (!channelRow || !adapter) {
      await this.markDeadLetter(intent, {
        reason: `escalation_channel_unavailable:${escalationChannel}`
      });
      return;
    }

    const rendered = await this.render(intent);

    const escalationAttempt = await this.prisma.notificationDeliveryAttempt.create({
      data: {
        intentId: intent.id,
        attemptNumber: 2,
        channel: escalationChannel,
        status: "pending",
        escalationOf: primaryAttemptId
      }
    });

    this.logger.log({
      event: "notification.delivery.escalated",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      assistantId: intent.assistantId,
      userId: intent.userId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      channel: escalationChannel,
      attemptNumber: 2,
      latencyMs: Date.now() - intent.createdAt.getTime(),
      outcome: "escalated",
      traceId: intent.traceId
    });

    const channelRegistryRecord = {
      id: channelRow.id,
      channelType: channelRow.channelType,
      enabled: channelRow.enabled,
      config: channelRow.config as Record<string, unknown>,
      healthStatus: channelRow.healthStatus,
      consecutiveFailures: channelRow.consecutiveFailures,
      lastDeliveryAt: channelRow.lastDeliveryAt,
      lastFailureAt: channelRow.lastFailureAt,
      createdAt: channelRow.createdAt,
      updatedAt: channelRow.updatedAt
    };

    const result = await adapter.deliver(intent, rendered, channelRegistryRecord);

    if (result.status === "delivered") {
      await this.prisma.$transaction([
        this.prisma.notificationDeliveryAttempt.update({
          where: { id: escalationAttempt.id },
          data: {
            status: "delivered",
            providerRef: result.providerRef ?? null,
            completedAt: new Date()
          }
        }),
        this.prisma.notificationIntent.update({
          where: { id: intent.id },
          data: { lifecycleStatus: "delivered", deliveredAt: new Date() }
        })
      ]);
    } else {
      await this.prisma.notificationDeliveryAttempt.update({
        where: { id: escalationAttempt.id },
        data: {
          status: "failed",
          error: (result.error as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
          completedAt: new Date()
        }
      });
      await this.markDeadLetter(
        intent,
        result.error ?? { reason: `escalation_failed:${result.status}` }
      );
    }
  }

  private async markFailed(intent: NotificationIntentRecord, reason: string): Promise<void> {
    await this.prisma.notificationIntent.update({
      where: { id: intent.id },
      data: { lifecycleStatus: "failed", failureReason: reason }
    });
  }

  private async markDeadLetter(
    intent: NotificationIntentRecord,
    lastError: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.notificationIntent.update({
        where: { id: intent.id },
        data: { lifecycleStatus: "dead_letter", deadLetteredAt: new Date() }
      }),
      this.prisma.notificationDeadLetter.upsert({
        where: { intentId: intent.id },
        create: {
          intentId: intent.id,
          workspaceId: intent.workspaceId,
          lastError: lastError as Prisma.InputJsonValue,
          escalationAttempts: intent.escalationChannel ? 1 : 0
        },
        update: {
          lastError: lastError as Prisma.InputJsonValue,
          escalationAttempts: { increment: 1 }
        }
      })
    ]);

    this.logger.warn({
      event: "notification.intent.dead_letter",
      intentId: intent.id,
      workspaceId: intent.workspaceId,
      source: intent.source,
      class: intent.class,
      priority: intent.priority,
      renderStrategy: intent.renderStrategy,
      traceId: intent.traceId,
      lastError
    });
  }

  private async render(intent: NotificationIntentRecord): Promise<RenderedPayload> {
    try {
      switch (intent.renderStrategy) {
        case "grounded_llm":
          return await this.groundedLlmRenderer.render(intent);
        case "template":
          return await this.templateRenderer.render(intent);
        default:
          return await this.staticFallbackRenderer.render(intent);
      }
    } catch {
      return await this.staticFallbackRenderer.render(intent);
    }
  }

  private rowToRecord(row: {
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
