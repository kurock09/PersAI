import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "../admin-authorization.service";
import { TemplateRendererService } from "./render/template-renderer.service";
import { GroundedLlmRendererService } from "./render/grounded-llm-renderer.service";

// ── Response types ────────────────────────────────────────────────────────────

export type NotificationChannelView = {
  id: string;
  channelType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  healthStatus: string;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastFailureAt: string | null;
  updatedAt: string;
};

export type NotificationPolicyView = {
  id: string;
  source: string;
  enabled: boolean;
  channels: string[];
  cooldownMinutes: number | null;
  maxPerDay: number | null;
  escalationAfterMinutes: number | null;
  escalationChannel: string | null;
  respectQuietHours: boolean;
  renderStrategy: string;
  renderInstructionRef: string | null;
  templateId: string | null;
  config: Record<string, unknown>;
  updatedAt: string;
};

export type QuietHoursView = {
  id: string;
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: string;
  defaultTimezone: string | null;
  appliesToSources: string[];
  updatedAt: string;
};

export type DeliveryAttemptView = {
  id: string;
  attemptNumber: number;
  channel: string;
  status: string;
  providerRef: string | null;
  error: unknown;
  escalationOf: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type DeliveryIntentView = {
  id: string;
  source: string;
  class: string;
  priority: string;
  lifecycleStatus: string;
  renderStrategy: string;
  dedupeKey: string | null;
  traceId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deadLetteredAt: string | null;
  failureReason: string | null;
  attempts: DeliveryAttemptView[];
};

export type DeadLetterView = {
  id: string;
  intentId: string;
  source: string;
  class: string;
  lastError: unknown;
  escalationAttempts: number;
  claimedForReplayAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type PreviewResult = {
  subject: string | null;
  body: string;
  html: string | null;
  plainText: string | null;
  dryRun: true;
};

// ── Input types ───────────────────────────────────────────────────────────────

export type PatchChannelInput = {
  enabled?: boolean;
  config?: Record<string, unknown>;
  healthStatus?: string;
};

export type PatchPolicyInput = {
  enabled?: boolean;
  channels?: string[];
  cooldownMinutes?: number | null;
  maxPerDay?: number | null;
  escalationAfterMinutes?: number | null;
  escalationChannel?: string | null;
  respectQuietHours?: boolean;
  renderStrategy?: string;
  renderInstructionRef?: string | null;
  templateId?: string | null;
  config?: Record<string, unknown>;
};

export type PatchQuietHoursInput = {
  enabled?: boolean;
  startLocal?: string;
  endLocal?: string;
  timezoneMode?: string;
  defaultTimezone?: string | null;
  appliesToSources?: string[];
};

export type ListDeliveriesQuery = {
  source?: string;
  class?: string;
  channel?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type ListDeadLettersQuery = {
  source?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type PreviewInput = {
  renderStrategy: "grounded_llm" | "template" | "static_fallback";
  templateId?: string | null;
  renderInstructionRef?: string | null;
  factPayload: Record<string, unknown>;
};

const VALID_RENDER_STRATEGIES = ["grounded_llm", "template", "static_fallback"] as const;
const VALID_CHANNEL_TYPES = [
  "telegram_thread",
  "web_thread",
  "web_notification_center",
  "email",
  "admin_webhook",
  "web_push",
  "mobile_push"
] as const;
const VALID_NOTIFICATION_SOURCES = [
  "idle_reengagement",
  "quota_advisory",
  "reminder",
  "background_task_push",
  "billing_lifecycle",
  "admin_system",
  "system_event"
] as const;

@Injectable()
export class ManageNotificationPlatformService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuth: AdminAuthorizationService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly groundedLlmRenderer: GroundedLlmRendererService
  ) {}

  // ── Authorization helpers ─────────────────────────────────────────────────

  private async resolveWorkspaceId(userId: string): Promise<string> {
    const context = await this.adminAuth.assertCanManageAdminSystemNotifications(userId);
    return context.workspaceId;
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  async listChannels(userId: string): Promise<NotificationChannelView[]> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const rows = await this.prisma.notificationChannelRegistry.findMany({
      where: { workspaceId },
      orderBy: { channelType: "asc" }
    });
    return rows.map((r) => this.channelToView(r));
  }

  async patchChannel(
    userId: string,
    channelType: string,
    input: PatchChannelInput
  ): Promise<NotificationChannelView> {
    if (!VALID_CHANNEL_TYPES.includes(channelType as never)) {
      throw new BadRequestException(`Unknown channel type: ${channelType}`);
    }
    const workspaceId = await this.resolveWorkspaceId(userId);
    const existing = await this.prisma.notificationChannelRegistry.findFirst({
      where: { workspaceId, channelType: channelType as never }
    });
    if (!existing) {
      throw new NotFoundException(`Channel not found: ${channelType}`);
    }

    const updated = await this.prisma.notificationChannelRegistry.update({
      where: { id: existing.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus as never } : {})
      }
    });
    return this.channelToView(updated);
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  async listPolicies(userId: string): Promise<NotificationPolicyView[]> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const rows = await this.prisma.notificationPolicy.findMany({
      where: { workspaceId },
      orderBy: { source: "asc" }
    });
    return rows.map((r) => this.policyToView(r));
  }

  async patchPolicy(
    userId: string,
    source: string,
    input: PatchPolicyInput
  ): Promise<NotificationPolicyView> {
    if (!VALID_NOTIFICATION_SOURCES.includes(source as never)) {
      throw new BadRequestException(`Unknown notification source: ${source}`);
    }
    if (input.renderStrategy && !VALID_RENDER_STRATEGIES.includes(input.renderStrategy as never)) {
      throw new BadRequestException(`Unknown render strategy: ${input.renderStrategy}`);
    }
    const workspaceId = await this.resolveWorkspaceId(userId);
    const existing = await this.prisma.notificationPolicy.findFirst({
      where: { workspaceId, source: source as never }
    });
    if (!existing) {
      throw new NotFoundException(`Policy not found for source: ${source}`);
    }

    const updated = await this.prisma.notificationPolicy.update({
      where: { id: existing.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(input.cooldownMinutes !== undefined ? { cooldownMinutes: input.cooldownMinutes } : {}),
        ...(input.maxPerDay !== undefined ? { maxPerDay: input.maxPerDay } : {}),
        ...(input.escalationAfterMinutes !== undefined
          ? { escalationAfterMinutes: input.escalationAfterMinutes }
          : {}),
        ...(input.escalationChannel !== undefined
          ? { escalationChannel: input.escalationChannel }
          : {}),
        ...(input.respectQuietHours !== undefined
          ? { respectQuietHours: input.respectQuietHours }
          : {}),
        ...(input.renderStrategy !== undefined
          ? { renderStrategy: input.renderStrategy as never }
          : {}),
        ...(input.renderInstructionRef !== undefined
          ? { renderInstructionRef: input.renderInstructionRef }
          : {}),
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {})
      }
    });
    return this.policyToView(updated);
  }

  // ── Quiet hours ───────────────────────────────────────────────────────────

  async getQuietHours(userId: string): Promise<QuietHoursView | null> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const row = await this.prisma.notificationQuietHours.findUnique({
      where: { workspaceId }
    });
    return row ? this.quietHoursToView(row) : null;
  }

  async patchQuietHours(userId: string, input: PatchQuietHoursInput): Promise<QuietHoursView> {
    const workspaceId = await this.resolveWorkspaceId(userId);

    const updated = await this.prisma.notificationQuietHours.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        enabled: input.enabled ?? false,
        startLocal: input.startLocal ?? "22:00",
        endLocal: input.endLocal ?? "08:00",
        timezoneMode: (input.timezoneMode as never) ?? "workspace_default",
        defaultTimezone: input.defaultTimezone ?? null,
        appliesToSources: input.appliesToSources ?? []
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.startLocal !== undefined ? { startLocal: input.startLocal } : {}),
        ...(input.endLocal !== undefined ? { endLocal: input.endLocal } : {}),
        ...(input.timezoneMode !== undefined ? { timezoneMode: input.timezoneMode as never } : {}),
        ...(input.defaultTimezone !== undefined ? { defaultTimezone: input.defaultTimezone } : {}),
        ...(input.appliesToSources !== undefined
          ? { appliesToSources: input.appliesToSources }
          : {})
      }
    });
    return this.quietHoursToView(updated);
  }

  // ── Deliveries ────────────────────────────────────────────────────────────

  async listDeliveries(
    userId: string,
    query: ListDeliveriesQuery
  ): Promise<{ items: DeliveryIntentView[]; total: number; page: number; pageSize: number }> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationIntentWhereInput = {
      workspaceId,
      ...(query.source ? { source: query.source as never } : {}),
      ...(query.class ? { class: query.class as never } : {}),
      ...(query.status ? { lifecycleStatus: query.status as never } : {}),
      // SQL-side channel filter via subquery on deliveryAttempts
      ...(query.channel ? { deliveryAttempts: { some: { channel: query.channel } } } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {})
            }
          }
        : {})
    };

    const [total, items] = await Promise.all([
      this.prisma.notificationIntent.count({ where }),
      this.prisma.notificationIntent.findMany({
        where,
        include: { deliveryAttempts: { orderBy: { attemptNumber: "asc" } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize
      })
    ]);

    return {
      items: items.map((i) => this.intentToView(i)),
      total,
      page,
      pageSize
    };
  }

  async getDelivery(userId: string, intentId: string): Promise<DeliveryIntentView> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const row = await this.prisma.notificationIntent.findFirst({
      where: { id: intentId, workspaceId },
      include: { deliveryAttempts: { orderBy: { attemptNumber: "asc" } } }
    });
    if (!row) {
      throw new NotFoundException(`Intent not found: ${intentId}`);
    }
    return this.intentToView(row);
  }

  // ── Dead letters ──────────────────────────────────────────────────────────

  async listDeadLetters(
    userId: string,
    query: ListDeadLettersQuery = {}
  ): Promise<{ deadLetters: DeadLetterView[]; total: number; page: number; pageSize: number }> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationDeadLetterWhereInput = {
      workspaceId,
      resolvedAt: null,
      ...(query.source || query.status || query.dateFrom || query.dateTo
        ? {
            intent: {
              ...(query.source ? { source: query.source as never } : {}),
              ...(query.status ? { lifecycleStatus: query.status as never } : {}),
              ...(query.dateFrom || query.dateTo
                ? {
                    createdAt: {
                      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                      ...(query.dateTo ? { lte: new Date(query.dateTo) } : {})
                    }
                  }
                : {})
            }
          }
        : {})
    };

    const [total, rows] = await Promise.all([
      this.prisma.notificationDeadLetter.count({ where }),
      this.prisma.notificationDeadLetter.findMany({
        where,
        include: { intent: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize
      })
    ]);

    return {
      deadLetters: rows.map((r) => this.deadLetterToView(r)),
      total,
      page,
      pageSize
    };
  }

  async replayDeadLetter(userId: string, deadLetterId: string): Promise<{ intentId: string }> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const row = await this.prisma.notificationDeadLetter.findFirst({
      where: { id: deadLetterId, workspaceId, resolvedAt: null }
    });
    if (!row) {
      throw new NotFoundException(`Dead letter not found: ${deadLetterId}`);
    }

    const now = new Date();
    // Reset the intent to pending so the worker picks it up again;
    // mark the dead letter resolved so it leaves the active list.
    await this.prisma.$transaction([
      this.prisma.notificationIntent.update({
        where: { id: row.intentId },
        data: {
          lifecycleStatus: "pending",
          deadLetteredAt: null,
          failureReason: null,
          claimedAt: null
        }
      }),
      this.prisma.notificationDeadLetter.update({
        where: { id: deadLetterId },
        data: { claimedForReplayAt: now, resolvedAt: now }
      })
    ]);

    return { intentId: row.intentId };
  }

  async discardDeadLetter(userId: string, deadLetterId: string): Promise<void> {
    const workspaceId = await this.resolveWorkspaceId(userId);
    const row = await this.prisma.notificationDeadLetter.findFirst({
      where: { id: deadLetterId, workspaceId, resolvedAt: null }
    });
    if (!row) {
      throw new NotFoundException(`Dead letter not found: ${deadLetterId}`);
    }
    await this.prisma.notificationDeadLetter.update({
      where: { id: deadLetterId },
      data: { resolvedAt: new Date() }
    });
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async preview(userId: string, input: PreviewInput): Promise<PreviewResult> {
    await this.resolveWorkspaceId(userId);

    if (!VALID_RENDER_STRATEGIES.includes(input.renderStrategy)) {
      throw new BadRequestException(`Unknown render strategy: ${input.renderStrategy}`);
    }

    if (input.renderStrategy === "grounded_llm") {
      const rendered = await this.groundedLlmRenderer.preview(
        input.factPayload,
        input.renderInstructionRef
      );
      return {
        subject: rendered.subject ?? null,
        body: rendered.body,
        html: rendered.html ?? null,
        plainText: rendered.plainText ?? null,
        dryRun: true
      };
    }

    if (input.renderStrategy === "template") {
      const templateId = input.templateId;
      if (!templateId) {
        throw new BadRequestException("templateId is required for template render strategy.");
      }
      const rendered = await this.templateRenderer.preview(templateId, input.factPayload);
      return {
        subject: rendered.subject ?? null,
        body: rendered.body,
        html: rendered.html ?? null,
        plainText: rendered.plainText ?? null,
        dryRun: true
      };
    }

    // static_fallback
    const body = (input.factPayload["message"] as string | undefined) ?? "Notification preview";
    return { subject: null, body, html: null, plainText: body, dryRun: true };
  }

  // ── View mappers ──────────────────────────────────────────────────────────

  private channelToView(r: {
    id: string;
    channelType: string;
    enabled: boolean;
    config: unknown;
    healthStatus: string;
    consecutiveFailures: number;
    lastDeliveryAt: Date | null;
    lastFailureAt: Date | null;
    updatedAt: Date;
  }): NotificationChannelView {
    return {
      id: r.id,
      channelType: r.channelType,
      enabled: r.enabled,
      config: (r.config as Record<string, unknown>) ?? {},
      healthStatus: r.healthStatus,
      consecutiveFailures: r.consecutiveFailures,
      lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
      lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString()
    };
  }

  private policyToView(r: {
    id: string;
    source: string;
    enabled: boolean;
    channels: string[];
    cooldownMinutes: number | null;
    maxPerDay: number | null;
    escalationAfterMinutes: number | null;
    escalationChannel: string | null;
    respectQuietHours: boolean;
    renderStrategy: string;
    renderInstructionRef: string | null;
    templateId: string | null;
    config: unknown;
    updatedAt: Date;
  }): NotificationPolicyView {
    return {
      id: r.id,
      source: r.source,
      enabled: r.enabled,
      channels: r.channels,
      cooldownMinutes: r.cooldownMinutes,
      maxPerDay: r.maxPerDay,
      escalationAfterMinutes: r.escalationAfterMinutes,
      escalationChannel: r.escalationChannel,
      respectQuietHours: r.respectQuietHours,
      renderStrategy: r.renderStrategy,
      renderInstructionRef: r.renderInstructionRef,
      templateId: r.templateId,
      config: (r.config as Record<string, unknown>) ?? {},
      updatedAt: r.updatedAt.toISOString()
    };
  }

  private quietHoursToView(r: {
    id: string;
    enabled: boolean;
    startLocal: string;
    endLocal: string;
    timezoneMode: string;
    defaultTimezone: string | null;
    appliesToSources: string[];
    updatedAt: Date;
  }): QuietHoursView {
    return {
      id: r.id,
      enabled: r.enabled,
      startLocal: r.startLocal,
      endLocal: r.endLocal,
      timezoneMode: r.timezoneMode,
      defaultTimezone: r.defaultTimezone,
      appliesToSources: r.appliesToSources,
      updatedAt: r.updatedAt.toISOString()
    };
  }

  private intentToView(r: {
    id: string;
    source: string;
    class: string;
    priority: string;
    lifecycleStatus: string;
    renderStrategy: string;
    dedupeKey: string | null;
    traceId: string | null;
    createdAt: Date;
    deliveredAt: Date | null;
    deadLetteredAt: Date | null;
    failureReason: string | null;
    deliveryAttempts: Array<{
      id: string;
      attemptNumber: number;
      channel: string;
      status: string;
      providerRef: string | null;
      error: unknown;
      escalationOf: string | null;
      startedAt: Date;
      completedAt: Date | null;
    }>;
  }): DeliveryIntentView {
    return {
      id: r.id,
      source: r.source,
      class: r.class,
      priority: r.priority,
      lifecycleStatus: r.lifecycleStatus,
      renderStrategy: r.renderStrategy,
      dedupeKey: r.dedupeKey,
      traceId: r.traceId,
      createdAt: r.createdAt.toISOString(),
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      deadLetteredAt: r.deadLetteredAt?.toISOString() ?? null,
      failureReason: r.failureReason,
      attempts: r.deliveryAttempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        channel: a.channel,
        status: a.status,
        providerRef: a.providerRef,
        error: a.error,
        escalationOf: a.escalationOf,
        startedAt: a.startedAt.toISOString(),
        completedAt: a.completedAt?.toISOString() ?? null
      }))
    };
  }

  private deadLetterToView(r: {
    id: string;
    intentId: string;
    lastError: unknown;
    escalationAttempts: number;
    claimedForReplayAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
    intent: { source: string; class: string };
  }): DeadLetterView {
    return {
      id: r.id,
      intentId: r.intentId,
      source: r.intent.source,
      class: r.intent.class,
      lastError: r.lastError,
      escalationAttempts: r.escalationAttempts,
      claimedForReplayAt: r.claimedForReplayAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString()
    };
  }
}
