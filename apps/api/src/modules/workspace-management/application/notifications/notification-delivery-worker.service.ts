import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, AssistantChannelBindingState } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { NOTIFICATION_CHANNEL_ADAPTERS } from "../../infrastructure/notifications/channel-adapters/channel-adapter.interface";
import type { NotificationChannelAdapter } from "../../infrastructure/notifications/channel-adapters/channel-adapter.interface";
import { StaticFallbackRendererService } from "./render/static-fallback-renderer.service";
import { TemplateRendererService } from "./render/template-renderer.service";
import { GroundedLlmRendererService } from "./render/grounded-llm-renderer.service";
import { NotificationRoutingService } from "./notification-routing.service";
import {
  ResolveWorkspaceNotificationChannelsService,
  type ChannelResolution,
  type ChannelUnavailableReason
} from "./resolve-workspace-notification-channels.service";
import type { NotificationIntentRecord, RenderedPayload } from "./notification-platform.types";

const WORKER_POLL_INTERVAL_MS = 10_000;
const WORKER_BATCH_SIZE = 10;
const WORKER_CLAIM_TTL_MS = 120_000;

export type ImmediateNotificationDeliveryResult = {
  status: string;
  providerRef: string | null;
  channel: string | null;
};

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
    private readonly staticFallbackRenderer: StaticFallbackRendererService,
    private readonly channelResolver: ResolveWorkspaceNotificationChannelsService,
    private readonly routingService: NotificationRoutingService
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

  async deliverIntentNow(intentId: string): Promise<ImmediateNotificationDeliveryResult> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + WORKER_CLAIM_TTL_MS);
    await this.prisma.notificationIntent.updateMany({
      where: {
        id: intentId,
        lifecycleStatus: { in: ["pending", "deferred_quiet_hours", "deferred_rate_limit"] },
        claimedAt: null
      },
      data: {
        lifecycleStatus: "claimed",
        claimedAt: now
      }
    });

    const row = await this.prisma.notificationIntent.findUnique({
      where: { id: intentId }
    });
    if (row === null) {
      return {
        status: "missing",
        providerRef: null,
        channel: null
      };
    }

    if (row.lifecycleStatus === "claimed") {
      await this.deliverIntent(this.rowToRecord(row), claimExpiresAt);
    }

    const latestAttempt = await this.prisma.notificationDeliveryAttempt.findFirst({
      where: { intentId },
      orderBy: [{ attemptNumber: "desc" }, { startedAt: "desc" }]
    });
    const refreshed = await this.prisma.notificationIntent.findUnique({
      where: { id: intentId }
    });

    return {
      status: refreshed?.lifecycleStatus ?? row.lifecycleStatus,
      providerRef: latestAttempt?.providerRef ?? null,
      channel: latestAttempt?.channel ?? null
    };
  }

  private async deliverIntent(intent: NotificationIntentRecord, _claimExpiry: Date): Promise<void> {
    try {
      // Guard: if the policy was disabled when the intent was created (or was
      // disabled between creation and claim), skip delivery immediately.
      const snapshot = intent.policySnapshot as Record<string, unknown> | null;
      if (snapshot && snapshot["enabled"] === false) {
        await this.markFailed(intent, "policy_disabled");
        return;
      }

      const rawChannel = intent.allowedChannels[0] ?? null;
      if (!rawChannel) {
        await this.markFailed(intent, "no_channel_configured");
        return;
      }

      // Expand semantic channels (user_preferred / current_thread) to real
      // adapter channels before resolution and adapter selection.
      const primaryChannel = await this.expandSemanticChannelForIntent(intent, rawChannel);
      if (primaryChannel === null) {
        // Semantic channel could not be resolved — try escalation or fail.
        const escalation = intent.escalationChannel;
        if (escalation && escalation !== rawChannel) {
          const failureReason =
            rawChannel === "current_thread"
              ? "current_thread_context_missing"
              : "user_preferred_unavailable";
          this.logger.warn({
            event: "notification.delivery.semantic_channel_unresolved",
            intentId: intent.id,
            rawChannel,
            failureReason,
            escalationChannel: escalation
          });
          await this.tryEscalation(intent, escalation, null);
        } else {
          const failureReason =
            rawChannel === "current_thread"
              ? "current_thread_context_missing"
              : "user_preferred_unavailable";
          await this.markFailed(intent, failureReason);
        }
        return;
      }

      const resolution = await this.channelResolver.resolveChannel({
        workspaceId: intent.workspaceId,
        channelType: primaryChannel
      });
      if (!resolution.available) {
        await this.markFailed(
          intent,
          this.formatChannelUnavailable(primaryChannel, resolution.reason)
        );
        return;
      }

      const adapter = this.channelAdapters.find(
        (a) => (a.channelType as string) === primaryChannel
      );
      if (!adapter) {
        await this.markFailed(intent, `adapter_not_found:${primaryChannel}`);
        return;
      }

      const channelRow = await this.prisma.notificationChannelRegistry.findUnique({
        where: { channelType: primaryChannel as never }
      });

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

      // Deliver. Build a ChannelRegistryRow shape from the resolver output so
      // adapters keep their typed contract; per-workspace overrides (e.g. the
      // resolved owner email under config.toAddress) flow through resolution.
      // Merge policy config (e.g. postmarkTemplateId for billing_lifecycle)
      // so channel adapters can use it without needing a separate policy lookup.
      const policyConfig =
        intent.policySnapshot && typeof intent.policySnapshot["config"] === "object"
          ? (intent.policySnapshot["config"] as Record<string, unknown>)
          : {};
      const channelRegistryRecord = this.toChannelRegistryRow(
        primaryChannel,
        resolution,
        channelRow,
        policyConfig
      );

      const result = await adapter.deliver(intent, rendered, channelRegistryRecord);

      if (result.status === "delivered") {
        const updateOperations: Prisma.PrismaPromise<unknown>[] = [
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
          })
        ];
        if (channelRow) {
          updateOperations.push(
            this.prisma.notificationChannelRegistry.update({
              where: { id: channelRow.id },
              data: {
                consecutiveFailures: 0,
                lastDeliveryAt: new Date(),
                healthStatus: "healthy"
              }
            })
          );
        }
        await this.prisma.$transaction(updateOperations);

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

        if (channelRow) {
          await this.prisma.notificationChannelRegistry.update({
            where: { id: channelRow.id },
            data: {
              consecutiveFailures: { increment: 1 },
              lastFailureAt: new Date()
            }
          });
        }

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

  /**
   * Resolve a semantic channel (user_preferred / current_thread) to a real
   * adapter channel by reading assistant preferences and intent surface context.
   * Returns the resolved real channel string, or null when not resolvable.
   * Non-semantic channels are returned unchanged.
   */
  private async expandSemanticChannelForIntent(
    intent: NotificationIntentRecord,
    channel: string
  ): Promise<string | null> {
    if (channel !== "user_preferred" && channel !== "current_thread") {
      return channel;
    }

    if (channel === "current_thread") {
      return this.routingService.expandSemanticChannel({
        channel,
        intentSurface: intent.surface
      });
    }

    // user_preferred: need assistant's preferred channel + binding status
    let assistantPreferredChannel: string | null = null;
    let hasActiveTelegramBinding = false;

    if (intent.assistantId) {
      const assistant = await this.prisma.assistant.findUnique({
        where: { id: intent.assistantId },
        select: { preferredNotificationChannel: true }
      });
      assistantPreferredChannel = assistant?.preferredNotificationChannel ?? null;

      if (assistantPreferredChannel === "telegram") {
        const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
          where: {
            assistantId: intent.assistantId,
            providerKey: "telegram",
            bindingState: AssistantChannelBindingState.active
          }
        });
        hasActiveTelegramBinding = binding !== null;
      }
    }

    return this.routingService.expandSemanticChannel({
      channel,
      assistantPreferredChannel,
      hasActiveTelegramBinding
    });
  }

  private formatChannelUnavailable(channelType: string, reason: ChannelUnavailableReason): string {
    return `channel_not_configured:${channelType}:${reason}`;
  }

  private toChannelRegistryRow(
    channelType: string,
    resolution: Extract<ChannelResolution, { available: true }>,
    row: {
      id: string;
      channelType: string;
      enabled: boolean;
      consecutiveFailures: number;
      lastDeliveryAt: Date | null;
      lastFailureAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      healthStatus: string;
    } | null,
    policyConfig: Record<string, unknown> = {}
  ) {
    const now = new Date();
    return {
      id: row?.id ?? `derived:${channelType}`,
      channelType: (row?.channelType ?? channelType) as never,
      enabled: row?.enabled ?? true,
      // Policy config is merged last so per-source values (e.g. postmarkTemplateId
      // on billing_lifecycle) reach the adapter without a separate policy lookup.
      config: { ...resolution.channel.config, ...policyConfig },
      healthStatus: (resolution.channel.healthStatus as never) ?? "healthy",
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      lastDeliveryAt: row?.lastDeliveryAt ?? null,
      lastFailureAt: row?.lastFailureAt ?? null,
      createdAt: row?.createdAt ?? now,
      updatedAt: row?.updatedAt ?? now
    };
  }

  private async tryEscalation(
    intent: NotificationIntentRecord,
    escalationChannel: string,
    primaryAttemptId: string | null
  ): Promise<void> {
    const resolution = await this.channelResolver.resolveChannel({
      workspaceId: intent.workspaceId,
      channelType: escalationChannel
    });

    const adapter = this.channelAdapters.find(
      (a) => (a.channelType as string) === escalationChannel
    );

    if (!resolution.available || !adapter) {
      const reason = resolution.available
        ? `adapter_not_found:${escalationChannel}`
        : this.formatChannelUnavailable(escalationChannel, resolution.reason);
      await this.markDeadLetter(intent, {
        reason: `escalation_channel_unavailable:${reason}`
      });
      return;
    }

    const channelRow = await this.prisma.notificationChannelRegistry.findUnique({
      where: { channelType: escalationChannel as never }
    });

    const rendered = await this.render(intent);

    const escalationAttempt = await this.prisma.notificationDeliveryAttempt.create({
      data: {
        intentId: intent.id,
        attemptNumber: 2,
        channel: escalationChannel,
        status: "pending",
        ...(primaryAttemptId !== null ? { escalationOf: primaryAttemptId } : {})
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

    const policyConfig =
      intent.policySnapshot && typeof intent.policySnapshot["config"] === "object"
        ? (intent.policySnapshot["config"] as Record<string, unknown>)
        : {};
    const channelRegistryRecord = this.toChannelRegistryRow(
      escalationChannel,
      resolution,
      channelRow,
      policyConfig
    );

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
