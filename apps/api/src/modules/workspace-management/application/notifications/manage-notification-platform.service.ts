import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  AssistantChannelBindingState,
  NotificationClass,
  NotificationChannelType,
  NotificationLifecycleStatus,
  NotificationPriority,
  NotificationRenderStrategy,
  NotificationSource
} from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "../admin-authorization.service";
import { TemplateRendererService } from "./render/template-renderer.service";
import { GroundedLlmRendererService } from "./render/grounded-llm-renderer.service";
import { StaticFallbackRendererService } from "./render/static-fallback-renderer.service";
import { NOTIFICATION_CHANNEL_ADAPTERS } from "../../infrastructure/notifications/channel-adapters/channel-adapter.interface";
import type { NotificationChannelAdapter } from "../../infrastructure/notifications/channel-adapters/channel-adapter.interface";
import type { NotificationIntentRecord } from "./notification-platform.types";
import { normalizeLocaleInput } from "@persai/types";
import { ResolveUserLocaleService } from "../resolve-user-locale.service";
import {
  readTelegramBindingMetadata,
  resolveTelegramPrivateDeliveryChatId
} from "../telegram-private-delivery-chat";
import {
  NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS,
  NOTIFICATION_POLICY_DEFAULTS,
  NOTIFICATION_QUIET_HOURS_DEFAULT,
  type NotificationChannelRegistryDefault,
  type NotificationQuietHoursDefault,
  type NotificationPolicyDefault
} from "./defaults/notification-defaults";
import {
  isValidAdminSystemDailyReportTimeLocal,
  parseAdminSystemPolicyConfig
} from "./admin-system-config";

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

export type TestSendResult = {
  channelType: string;
  ok: boolean;
  status: "delivered" | "failed" | "not_configured" | "adapter_not_found";
  error: Record<string, unknown> | null;
};

export type TestSendForSourceInput = {
  eventCode?: string | null;
  channelOverride?: string | null;
  locale?: "ru" | "en" | null;
};

export type TestSendForSourceResult = {
  source: string;
  channelType: string;
  ok: boolean;
  status: "delivered" | "failed" | "not_configured" | "adapter_not_found";
  error: Record<string, unknown> | null;
};

export type NotificationTemplateCatalogView = {
  templateIds: string[];
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

export type TestSendInput = {
  renderStrategy?: "grounded_llm" | "template" | "static_fallback";
  templateId?: string | null;
  renderInstructionRef?: string | null;
  factPayload?: Record<string, unknown>;
};

const VALID_BILLING_EVENT_CODES = [
  "trial_ending",
  "trial_expired",
  "payment_activated",
  "renewal_succeeded",
  "renewal_failed",
  "grace_ending",
  "grace_expired",
  "payment_recovered"
] as const;

const VALID_RENDER_STRATEGIES = ["grounded_llm", "template", "static_fallback"] as const;

// ADR-090: idle_reengagement may only route to these channels.
// telegram_thread is excluded because a misconfigured/unhealthy telegram_thread
// causes silent delivery failures → intents land in failed/dead_letter →
// the scheduler re-evaluates indefinitely (no LLM budget guard in that loop).
const IDLE_REENGAGEMENT_ALLOWED_CHANNELS = new Set([
  "user_preferred",
  "web_notification_center",
  "current_thread",
  "email"
]);

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
  "system_event",
  "user_support"
] as const;
const VALID_NOTIFICATION_CLASSES = [
  "conversational",
  "transactional",
  "operational",
  "administrative"
] as const;
const VALID_LIFECYCLE_STATUSES = [
  "pending",
  "claimed",
  "delivered",
  "failed",
  "dead_letter",
  "skipped",
  "deferred_quiet_hours",
  "deferred_rate_limit"
] as const;

function isValidEnumValue<T extends readonly string[]>(
  raw: string | undefined,
  allowed: T
): raw is T[number] {
  return raw !== undefined && (allowed as readonly string[]).includes(raw);
}

@Injectable()
export class ManageNotificationPlatformService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuth: AdminAuthorizationService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly groundedLlmRenderer: GroundedLlmRendererService,
    private readonly staticFallbackRenderer: StaticFallbackRendererService,
    private readonly resolveUserLocaleService: ResolveUserLocaleService,
    @Inject(NOTIFICATION_CHANNEL_ADAPTERS)
    private readonly channelAdapters: NotificationChannelAdapter[]
  ) {}

  // ── Authorization helpers ─────────────────────────────────────────────────

  private async resolveWorkspaceId(userId: string): Promise<string> {
    const context = await this.adminAuth.assertCanManageAdminSystemNotifications(userId);
    return context.workspaceId;
  }

  private async requireGlobalNotificationPlatformAccess(userId: string): Promise<void> {
    const context = await this.adminAuth.assertCanManageAdminSystemNotifications(userId);
    if (!context.hasGlobalPlatformAdminScope) {
      throw new ForbiddenException(
        "Notification platform control-plane access requires a platform-scoped admin role."
      );
    }
  }

  private async resolveDeliveryWorkspaceScope(userId: string): Promise<string | null> {
    const context = await this.adminAuth.assertCanManageAdminSystemNotifications(userId);
    return context.hasGlobalPlatformAdminScope ? null : context.workspaceId;
  }

  /**
   * Public thin admin gate. Endpoints that do not need a workspaceId or
   * other state (e.g. dry-run test-send) call this so they pass through the
   * same `assertCanManageAdminSystemNotifications` policy as every other
   * endpoint on the surface.
   */
  async assertAdminAccess(userId: string): Promise<void> {
    await this.requireGlobalNotificationPlatformAccess(userId);
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  async listChannels(userId: string): Promise<NotificationChannelView[]> {
    await this.requireGlobalNotificationPlatformAccess(userId);
    const rows = await this.prisma.notificationChannelRegistry.findMany({
      orderBy: { channelType: "asc" }
    });
    const rowsByType = new Map(rows.map((r) => [r.channelType as string, r]));
    return VALID_CHANNEL_TYPES.map((channelType) => {
      const row = rowsByType.get(channelType);
      return row
        ? this.channelToView(row)
        : this.channelDefaultToView(
            NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS[channelType as NotificationChannelType]
          );
    });
  }

  async patchChannel(
    userId: string,
    channelType: string,
    input: PatchChannelInput
  ): Promise<NotificationChannelView> {
    if (!VALID_CHANNEL_TYPES.includes(channelType as never)) {
      throw new BadRequestException(`Unknown channel type: ${channelType}`);
    }
    await this.requireGlobalNotificationPlatformAccess(userId);
    const existing = await this.getOrCreateChannelRow(channelType);

    const updated = await this.prisma.notificationChannelRegistry.update({
      where: { id: existing.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.enabled === false
          ? {
              consecutiveFailures: 0,
              lastFailureAt: null
            }
          : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus as never } : {})
      }
    });
    return this.channelToView(updated);
  }

  async listTemplates(userId: string): Promise<NotificationTemplateCatalogView> {
    await this.requireGlobalNotificationPlatformAccess(userId);
    return {
      templateIds: this.templateRenderer.listTemplateIds()
    };
  }

  /**
   * Operator test-send. Builds a synthetic intent with REAL admin context
   * (admin assistant id, first active web chat id, admin email) so
   * channels that require chat/assistant binding can deliver an actual
   * message into the operator's surface — not a stub. The intent is never
   * persisted to notification_intents; channel-side rows (chat messages,
   * provider sends) reflect the test as a normal delivery.
   */
  async testSendChannel(
    userId: string,
    channelType: string,
    input?: TestSendInput
  ): Promise<TestSendResult> {
    if (!VALID_CHANNEL_TYPES.includes(channelType as never)) {
      throw new BadRequestException(`Unknown channel type: ${channelType}`);
    }
    await this.requireGlobalNotificationPlatformAccess(userId);
    const workspaceId = await this.resolveWorkspaceId(userId);

    const channelRow = await this.getOrCreateChannelRow(channelType);

    const adapter = this.channelAdapters.find((a) => a.channelType === channelType);
    if (!adapter) {
      return {
        channelType,
        ok: false,
        status: "adapter_not_found",
        error: { reason: "no_adapter_registered" }
      };
    }

    // Resolve admin context. Different channels need different routing truth:
    // - telegram_thread: Telegram DM chat id from assistant binding metadata
    // - web_thread / web_notification_center: first active web chat
    // - email: recipientEmail only
    // - admin_webhook / push placeholders: no user chat context required
    const adminAssistants = await this.prisma.assistant.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 2
    });
    if (adminAssistants.length > 1) {
      throw new BadRequestException(
        "Active assistant context is required for notification test sends."
      );
    }
    const adminAssistant = adminAssistants[0] ?? null;
    let chatId: string | null = null;
    let surface: string | null = null;
    let surfaceThreadKey: string | null = null;
    if (adminAssistant) {
      if (channelType === NotificationChannelType.telegram_thread) {
        const tgBinding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
          where: {
            assistantId: adminAssistant.id,
            providerKey: "telegram",
            bindingState: "active"
          },
          select: { metadata: true }
        });
        const metadata = readTelegramBindingMetadata(tgBinding?.metadata);
        const telegramPrivateChatId = resolveTelegramPrivateDeliveryChatId(metadata);
        if (telegramPrivateChatId) {
          surface = "telegram";
          surfaceThreadKey = telegramPrivateChatId;
        }
      } else if (
        channelType === NotificationChannelType.web_thread ||
        channelType === NotificationChannelType.web_notification_center
      ) {
        const firstChat = await this.prisma.assistantChat.findFirst({
          where: {
            assistantId: adminAssistant.id,
            userId,
            archivedAt: null,
            surface: "web" as never
          },
          orderBy: { lastMessageAt: "desc" }
        });
        if (firstChat) {
          chatId = firstChat.id;
          surface = firstChat.surface as unknown as string;
          surfaceThreadKey = firstChat.surfaceThreadKey;
        }
      }
    }
    const adminEmail = await this.prisma.appUser
      .findUnique({ where: { id: userId }, select: { email: true } })
      .then((u) => u?.email ?? null);

    const renderStrategy =
      (input?.renderStrategy as NotificationRenderStrategy | undefined) ??
      NotificationRenderStrategy.static_fallback;
    const factPayload =
      input?.factPayload !== undefined
        ? {
            ...input.factPayload,
            ...(adminEmail !== null && typeof input.factPayload["recipientEmail"] !== "string"
              ? { recipientEmail: adminEmail }
              : {})
          }
        : {
            message: `Test send for channel "${channelType}" — PersAI Notifications`,
            ...(adminEmail !== null ? { recipientEmail: adminEmail } : {})
          };

    const syntheticIntent: NotificationIntentRecord = {
      id: randomUUID(),
      workspaceId,
      assistantId: adminAssistant?.id ?? null,
      userId,
      source: NotificationSource.system_event,
      class:
        renderStrategy === NotificationRenderStrategy.grounded_llm
          ? NotificationClass.conversational
          : NotificationClass.operational,
      priority: NotificationPriority.immediate,
      lifecycleStatus: NotificationLifecycleStatus.pending,
      renderStrategy,
      renderInstructionRef: input?.renderInstructionRef ?? null,
      templateId: input?.templateId ?? null,
      factPayload,
      policySnapshot: {},
      allowedChannels: [channelType],
      escalationAfterMinutes: null,
      escalationChannel: null,
      dedupeKey: null,
      scheduledAt: null,
      respectQuietHours: false,
      surface,
      surfaceThreadKey,
      chatId,
      traceId: `test-send:${channelType}:${Date.now()}`,
      failureReason: null,
      createdAt: new Date(),
      claimedAt: null,
      deliveredAt: null,
      deadLetteredAt: null
    };

    const channelConfig = {
      id: channelRow.id,
      channelType: channelRow.channelType,
      enabled: channelRow.enabled,
      config: (channelRow.config ?? {}) as Record<string, unknown>,
      healthStatus: channelRow.healthStatus,
      consecutiveFailures: channelRow.consecutiveFailures,
      lastDeliveryAt: channelRow.lastDeliveryAt,
      lastFailureAt: channelRow.lastFailureAt,
      createdAt: channelRow.createdAt,
      updatedAt: channelRow.updatedAt
    };

    const rendered =
      renderStrategy === NotificationRenderStrategy.template
        ? await this.templateRenderer.render(syntheticIntent)
        : renderStrategy === NotificationRenderStrategy.grounded_llm
          ? await this.groundedLlmRenderer.render(syntheticIntent)
          : await this.staticFallbackRenderer.render(syntheticIntent);
    const result = await adapter.deliver(syntheticIntent, rendered, channelConfig);

    // Update channel health to mirror what the real worker does, so the
    // operator's UI reflects the test outcome instead of staying stale.
    if (result.status === "delivered") {
      await this.prisma.notificationChannelRegistry.update({
        where: { id: channelRow.id },
        data: {
          consecutiveFailures: 0,
          lastDeliveryAt: new Date(),
          lastFailureAt: null,
          healthStatus: "healthy"
        }
      });
    } else {
      await this.prisma.notificationChannelRegistry.update({
        where: { id: channelRow.id },
        data: {
          consecutiveFailures: { increment: 1 },
          lastFailureAt: new Date()
        }
      });
    }

    return {
      channelType,
      ok: result.status === "delivered",
      status: result.status === "delivered" ? "delivered" : "failed",
      error: result.error ?? null
    };
  }

  /**
   * Per-source test send.
   *
   * For `billing_lifecycle`: `eventCode` selects the billing rule; demo facts
   * are built automatically so the operator sees a realistic rendered email.
   * Routes through the real email pipeline including the Postmark Template ID
   * stored in the policy config (if set).
   *
   * For other sources: builds minimal demo facts and routes through the policy's
   * default channel (or `channelOverride` when supplied).
   */
  async testSendForSource(
    userId: string,
    source: string,
    input: TestSendForSourceInput
  ): Promise<TestSendForSourceResult> {
    if (!VALID_NOTIFICATION_SOURCES.includes(source as never)) {
      throw new BadRequestException(`Unknown notification source: ${source}`);
    }
    await this.requireGlobalNotificationPlatformAccess(userId);
    const workspaceId = await this.resolveWorkspaceId(userId);

    // Resolve policy to get the default channel and config (incl. postmarkTemplateId).
    const policyRow = await this.prisma.notificationPolicy.findUnique({
      where: { source: source as never }
    });
    const policyConfig =
      policyRow && typeof policyRow.config === "object"
        ? (policyRow.config as Record<string, unknown>)
        : {};
    const policyChannels: string[] =
      source === "admin_system" ? ["user_preferred"] : (policyRow?.channels ?? []);
    const adminSystemConfig =
      source === "admin_system" ? parseAdminSystemPolicyConfig(policyConfig) : null;

    // Look up the admin's assistant once — used both for semantic-channel
    // resolution and for building the synthetic intent later.
    const fallbackAdminAssistants = await this.prisma.assistant.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: 2
    });
    if (fallbackAdminAssistants.length > 1) {
      throw new BadRequestException(
        "Active assistant context is required for notification test sends."
      );
    }
    const fallbackAdminAssistantId = fallbackAdminAssistants[0]?.id ?? null;
    const adminAssistantId =
      adminSystemConfig?.recipientAssistantIds[0] ?? fallbackAdminAssistantId ?? null;
    const adminAssistant =
      adminAssistantId === null
        ? null
        : await this.prisma.assistant.findUnique({
            where: { id: adminAssistantId },
            select: {
              id: true,
              userId: true,
              workspaceId: true,
              preferredNotificationChannel: true
            }
          });

    // Resolve the concrete channel using the same semantics as the real delivery
    // worker. Semantic channels (user_preferred, current_thread) are expanded
    // here rather than silently rerouted to web_notification_center so that a
    // green test actually reflects what live delivery would do.
    const rawPolicyChannel = policyChannels[0] ?? null;
    let channelType: string;

    if (input.channelOverride && VALID_CHANNEL_TYPES.includes(input.channelOverride as never)) {
      channelType = input.channelOverride;
    } else if (rawPolicyChannel === "current_thread") {
      // current_thread requires a live surface + chatId from an active user
      // session. A synthetic admin test cannot fabricate this context. Return
      // an honest error rather than silently routing to another channel.
      return {
        source,
        channelType: "current_thread",
        ok: false,
        status: "failed",
        error: {
          reason: "current_thread_requires_live_surface_context",
          hint: "This source delivers into the active user chat. It cannot be tested in isolation; trigger a real intent from the assistant instead."
        }
      };
    } else if (rawPolicyChannel === "user_preferred") {
      // Resolve the admin's actual preferred channel exactly as the real worker
      // would, then fall back to the policy escalation channel if needed.
      let resolvedChannel: string | null = null;

      if (adminAssistant) {
        const preferred = adminAssistant.preferredNotificationChannel ?? "web";
        if (preferred === "telegram") {
          const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
            where: {
              assistantId: adminAssistant.id,
              providerKey: "telegram",
              bindingState: AssistantChannelBindingState.active
            }
          });
          resolvedChannel = binding ? "telegram_thread" : null;
        } else {
          resolvedChannel = "web_notification_center";
        }
      }

      if (resolvedChannel !== null && VALID_CHANNEL_TYPES.includes(resolvedChannel as never)) {
        channelType = resolvedChannel;
      } else {
        // Preferred channel unresolvable — try policy escalation channel.
        const escalation = policyRow?.escalationChannel ?? null;
        if (escalation && VALID_CHANNEL_TYPES.includes(escalation as never)) {
          channelType = escalation;
        } else {
          return {
            source,
            channelType: "user_preferred",
            ok: false,
            status: "failed",
            error: {
              reason: "user_preferred_unavailable",
              hint: "No Telegram binding found for your assistant and no escalation channel is configured on this policy."
            }
          };
        }
      }
    } else {
      channelType = rawPolicyChannel ?? "admin_webhook";
    }

    if (!VALID_CHANNEL_TYPES.includes(channelType as never)) {
      throw new BadRequestException(`Resolved channel type is not testable: ${channelType}`);
    }

    // Resolve admin email for recipient
    const adminEmail = await this.prisma.appUser
      .findUnique({ where: { id: adminAssistant?.userId ?? userId }, select: { email: true } })
      .then((u) => u?.email ?? null);

    // Build demo facts
    let factPayload: Record<string, unknown>;
    let templateId: string | null = null;
    let renderStrategy: NotificationRenderStrategy = NotificationRenderStrategy.static_fallback;

    if (source === "billing_lifecycle") {
      const eventCode =
        input.eventCode && VALID_BILLING_EVENT_CODES.includes(input.eventCode as never)
          ? input.eventCode
          : "trial_ending";
      const now = new Date();
      const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const locale =
        normalizeLocaleInput(input.locale ?? null) ??
        (await this.resolveUserLocaleService.forUserInWorkspace(userId, workspaceId));
      factPayload = {
        rule: eventCode,
        workspaceId,
        planCode: "pro",
        planDisplayName: "PersAI Pro",
        periodEndsAt: soon.toISOString(),
        graceEndsAt: null,
        trialEndsAt: soon.toISOString(),
        amount: 990,
        currency: "RUB",
        locale,
        recipientEmail: adminEmail
      };
      templateId = `billing.${eventCode}`;
      renderStrategy = NotificationRenderStrategy.template;
    } else if (source === "admin_system" && input.eventCode === "daily_report") {
      factPayload = {
        eventCode: "daily_report",
        message: [
          "PersAI daily admin report",
          "",
          "Today",
          "- New users: 3",
          "- Successful payments: 2",
          "- Revenue: RUB 123.45",
          "- Cost: USD 2.50",
          "- Runtime apply failed: 1",
          "- Runtime apply degraded: 0",
          "- Unresolved dead letters: 1",
          "",
          "All time",
          "- Revenue: RUB 456.78",
          "- Cost: USD 10.00"
        ].join("\n"),
        ...(adminEmail !== null ? { recipientEmail: adminEmail } : {})
      };
    } else {
      factPayload = {
        message: `Test notification for source "${source}" — PersAI`,
        ...(adminEmail !== null ? { recipientEmail: adminEmail } : {})
      };
    }

    // Find channel registry row and adapter
    const channelRow = await this.getOrCreateChannelRow(channelType);

    const adapter = this.channelAdapters.find((a) => a.channelType === channelType);
    if (!adapter) {
      return {
        source,
        channelType,
        ok: false,
        status: "adapter_not_found",
        error: { reason: "no_adapter_registered" }
      };
    }

    const syntheticIntent: NotificationIntentRecord = {
      id: randomUUID(),
      workspaceId: adminAssistant?.workspaceId ?? workspaceId,
      assistantId: adminAssistant?.id ?? null,
      userId: adminAssistant?.userId ?? userId,
      source: source as NotificationIntentRecord["source"],
      class:
        source === "billing_lifecycle"
          ? NotificationClass.transactional
          : source === "admin_system"
            ? NotificationClass.administrative
            : NotificationClass.operational,
      priority: NotificationPriority.immediate,
      lifecycleStatus: NotificationLifecycleStatus.pending,
      renderStrategy,
      renderInstructionRef: null,
      templateId,
      factPayload,
      // Merge policy config so email adapter picks up postmarkTemplateId
      policySnapshot: { config: policyConfig },
      allowedChannels: [channelType],
      escalationAfterMinutes: null,
      escalationChannel: null,
      dedupeKey: null,
      scheduledAt: null,
      respectQuietHours: false,
      surface: null,
      surfaceThreadKey: null,
      chatId: null,
      traceId: `test-source:${source}:${Date.now()}`,
      failureReason: null,
      createdAt: new Date(),
      claimedAt: null,
      deliveredAt: null,
      deadLetteredAt: null
    };

    // Merge policy config into channel config so postmarkTemplateId flows to the email adapter
    const channelConfig = {
      id: channelRow.id,
      channelType: channelRow.channelType,
      enabled: channelRow.enabled,
      config: { ...(channelRow.config as Record<string, unknown>), ...policyConfig },
      healthStatus: channelRow.healthStatus,
      consecutiveFailures: channelRow.consecutiveFailures,
      lastDeliveryAt: channelRow.lastDeliveryAt,
      lastFailureAt: channelRow.lastFailureAt,
      createdAt: channelRow.createdAt,
      updatedAt: channelRow.updatedAt
    };

    const rendered =
      renderStrategy === NotificationRenderStrategy.template
        ? await this.templateRenderer.render(syntheticIntent)
        : await this.staticFallbackRenderer.render(syntheticIntent);

    const result = await adapter.deliver(syntheticIntent, rendered, channelConfig);

    if (result.status === "delivered") {
      await this.prisma.notificationChannelRegistry.update({
        where: { id: channelRow.id },
        data: {
          consecutiveFailures: 0,
          lastDeliveryAt: new Date(),
          lastFailureAt: null,
          healthStatus: "healthy"
        }
      });
    } else {
      await this.prisma.notificationChannelRegistry.update({
        where: { id: channelRow.id },
        data: { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date() }
      });
    }

    return {
      source,
      channelType,
      ok: result.status === "delivered",
      status: result.status === "delivered" ? "delivered" : "failed",
      error: result.error ?? null
    };
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  async listPolicies(userId: string): Promise<NotificationPolicyView[]> {
    await this.requireGlobalNotificationPlatformAccess(userId);
    const rows = await this.prisma.notificationPolicy.findMany({
      orderBy: { source: "asc" }
    });
    const rowsBySource = new Map(rows.map((r) => [r.source as string, r]));

    // Always return all known sources so operators can see and edit every
    // policy even before a DB row exists. DB row takes precedence; missing
    // rows fall back to the code-level default.
    const allSources = Object.keys(NOTIFICATION_POLICY_DEFAULTS) as NotificationSource[];
    return allSources.map((source) => {
      const row = rowsBySource.get(source as string);
      return row
        ? this.policyToView(row)
        : this.policyDefaultToView(NOTIFICATION_POLICY_DEFAULTS[source]);
    });
  }

  async patchPolicy(
    userId: string,
    source: string,
    input: PatchPolicyInput
  ): Promise<NotificationPolicyView> {
    await this.requireGlobalNotificationPlatformAccess(userId);

    if (!VALID_NOTIFICATION_SOURCES.includes(source as never)) {
      throw new BadRequestException(`Unknown notification source: ${source}`);
    }
    if (input.renderStrategy && !VALID_RENDER_STRATEGIES.includes(input.renderStrategy as never)) {
      throw new BadRequestException(`Unknown render strategy: ${input.renderStrategy}`);
    }

    // ADR-090: Prevent misconfigured channels for idle_reengagement.
    if (source === "idle_reengagement") {
      const badChannels = (input.channels ?? []).filter(
        (ch) => !IDLE_REENGAGEMENT_ALLOWED_CHANNELS.has(ch)
      );
      if (badChannels.length > 0) {
        throw new BadRequestException(
          `idle_reengagement policy does not support channel(s): ${badChannels.join(", ")}. ` +
            `Allowed: ${[...IDLE_REENGAGEMENT_ALLOWED_CHANNELS].join(", ")}.`
        );
      }
      if (
        input.escalationChannel !== undefined &&
        input.escalationChannel !== null &&
        !IDLE_REENGAGEMENT_ALLOWED_CHANNELS.has(input.escalationChannel)
      ) {
        throw new BadRequestException(
          `idle_reengagement policy does not support escalationChannel: ${input.escalationChannel}. ` +
            `Allowed: ${[...IDLE_REENGAGEMENT_ALLOWED_CHANNELS].join(", ")}.`
        );
      }
    }

    if (
      source === "admin_system" &&
      input.config !== undefined &&
      Object.hasOwn(input.config, "dailyReportTimeLocal") &&
      !isValidAdminSystemDailyReportTimeLocal(input.config["dailyReportTimeLocal"])
    ) {
      throw new BadRequestException(
        "admin_system config.dailyReportTimeLocal must be a valid HH:MM local time."
      );
    }

    const normalizedInput =
      source === "admin_system" && input.config !== undefined
        ? {
            ...input,
            channels: ["user_preferred"],
            config: parseAdminSystemPolicyConfig(input.config) as Record<string, unknown>
          }
        : source === "admin_system"
          ? { ...input, channels: ["user_preferred"] }
          : input;

    if (source === "admin_system" && normalizedInput.channels !== undefined) {
      const badChannels = normalizedInput.channels.filter(
        (channel) => channel !== "user_preferred"
      );
      if (badChannels.length > 0) {
        throw new BadRequestException(
          `admin_system policy only supports channel(s): user_preferred. Received: ${badChannels.join(", ")}.`
        );
      }
    }

    await this.resolveWorkspaceId(userId);

    // Use the code-level default as the base for upsert create so that
    // sources without a DB row can be edited without a seed step.
    const def = NOTIFICATION_POLICY_DEFAULTS[source as NotificationSource];
    const updated = await this.prisma.notificationPolicy.upsert({
      where: { source: source as never },
      create: {
        source: source as never,
        enabled: normalizedInput.enabled ?? def?.enabled ?? false,
        // ADR-090: persist input.channels when supplied; fall back to defaults.
        channels: normalizedInput.channels ?? def?.channels ?? [],
        cooldownMinutes: normalizedInput.cooldownMinutes ?? def?.cooldownMinutes ?? null,
        maxPerDay: normalizedInput.maxPerDay ?? def?.maxPerDay ?? null,
        escalationAfterMinutes:
          normalizedInput.escalationAfterMinutes ?? def?.escalationAfterMinutes ?? null,
        escalationChannel: normalizedInput.escalationChannel ?? def?.escalationChannel ?? null,
        respectQuietHours: normalizedInput.respectQuietHours ?? def?.respectQuietHours ?? true,
        renderStrategy: (normalizedInput.renderStrategy as never) ?? (def?.renderStrategy as never),
        renderInstructionRef:
          normalizedInput.renderInstructionRef ?? def?.renderInstructionRef ?? null,
        templateId: normalizedInput.templateId ?? def?.templateId ?? null,
        // ADR-090: preserve the code-level default config on first create
        // when the operator did not pass an explicit config object.
        config:
          (normalizedInput.config as Prisma.InputJsonValue | undefined) ??
          (def?.config as Prisma.InputJsonValue | undefined) ??
          ({} as Prisma.InputJsonValue)
      },
      update: {
        ...(normalizedInput.enabled !== undefined ? { enabled: normalizedInput.enabled } : {}),
        // ADR-090: persist input.channels on update too (was previously dropped).
        ...(normalizedInput.channels !== undefined ? { channels: normalizedInput.channels } : {}),
        ...(normalizedInput.cooldownMinutes !== undefined
          ? { cooldownMinutes: normalizedInput.cooldownMinutes }
          : {}),
        ...(normalizedInput.maxPerDay !== undefined
          ? { maxPerDay: normalizedInput.maxPerDay }
          : {}),
        ...(normalizedInput.escalationAfterMinutes !== undefined
          ? { escalationAfterMinutes: normalizedInput.escalationAfterMinutes }
          : {}),
        ...(normalizedInput.escalationChannel !== undefined
          ? { escalationChannel: normalizedInput.escalationChannel }
          : {}),
        ...(normalizedInput.respectQuietHours !== undefined
          ? { respectQuietHours: normalizedInput.respectQuietHours }
          : {}),
        ...(normalizedInput.renderStrategy !== undefined
          ? { renderStrategy: normalizedInput.renderStrategy as never }
          : {}),
        ...(normalizedInput.renderInstructionRef !== undefined
          ? { renderInstructionRef: normalizedInput.renderInstructionRef }
          : {}),
        ...(normalizedInput.templateId !== undefined
          ? { templateId: normalizedInput.templateId }
          : {}),
        ...(normalizedInput.config !== undefined
          ? { config: normalizedInput.config as Prisma.InputJsonValue }
          : {})
      }
    });
    return this.policyToView(updated);
  }

  // ── Quiet hours ───────────────────────────────────────────────────────────

  async getQuietHours(userId: string): Promise<QuietHoursView | null> {
    await this.requireGlobalNotificationPlatformAccess(userId);
    const row = await this.prisma.notificationQuietHours.findFirst({});
    return row ? this.quietHoursToView(row) : this.quietHoursDefaultToView();
  }

  async patchQuietHours(userId: string, input: PatchQuietHoursInput): Promise<QuietHoursView> {
    await this.requireGlobalNotificationPlatformAccess(userId);

    const updated = await this.prisma.notificationQuietHours.upsert({
      where: { singleton: true },
      create: {
        singleton: true,
        enabled: input.enabled ?? NOTIFICATION_QUIET_HOURS_DEFAULT.enabled,
        startLocal: input.startLocal ?? NOTIFICATION_QUIET_HOURS_DEFAULT.startLocal,
        endLocal: input.endLocal ?? NOTIFICATION_QUIET_HOURS_DEFAULT.endLocal,
        timezoneMode:
          (input.timezoneMode as never) ?? NOTIFICATION_QUIET_HOURS_DEFAULT.timezoneMode,
        defaultTimezone: input.defaultTimezone ?? NOTIFICATION_QUIET_HOURS_DEFAULT.defaultTimezone,
        appliesToSources:
          input.appliesToSources ?? NOTIFICATION_QUIET_HOURS_DEFAULT.appliesToSources
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
    const workspaceId = await this.resolveDeliveryWorkspaceScope(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    // Normalise enum-shaped filters: ignore values that are not exact enum
    // members so a partial input ("sy" while typing "system_event") never
    // reaches Prisma and triggers a 500.
    const sourceFilter = isValidEnumValue(query.source, VALID_NOTIFICATION_SOURCES)
      ? query.source
      : undefined;
    const classFilter = isValidEnumValue(query.class, VALID_NOTIFICATION_CLASSES)
      ? query.class
      : undefined;
    const statusFilter = isValidEnumValue(query.status, VALID_LIFECYCLE_STATUSES)
      ? query.status
      : undefined;
    const channelFilter = isValidEnumValue(query.channel, VALID_CHANNEL_TYPES)
      ? query.channel
      : undefined;

    const where: Prisma.NotificationIntentWhereInput = {
      ...(workspaceId !== null ? { workspaceId } : {}),
      ...(sourceFilter ? { source: sourceFilter as never } : {}),
      ...(classFilter ? { class: classFilter as never } : {}),
      ...(statusFilter ? { lifecycleStatus: statusFilter as never } : {}),
      ...(channelFilter ? { deliveryAttempts: { some: { channel: channelFilter } } } : {}),
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
    const workspaceId = await this.resolveDeliveryWorkspaceScope(userId);
    const row = await this.prisma.notificationIntent.findFirst({
      where: { id: intentId, ...(workspaceId !== null ? { workspaceId } : {}) },
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
    const workspaceId = await this.resolveDeliveryWorkspaceScope(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const sourceFilter = isValidEnumValue(query.source, VALID_NOTIFICATION_SOURCES)
      ? query.source
      : undefined;
    const statusFilter = isValidEnumValue(query.status, VALID_LIFECYCLE_STATUSES)
      ? query.status
      : undefined;

    const where: Prisma.NotificationDeadLetterWhereInput = {
      ...(workspaceId !== null ? { workspaceId } : {}),
      resolvedAt: null,
      ...(sourceFilter || statusFilter || query.dateFrom || query.dateTo
        ? {
            intent: {
              ...(sourceFilter ? { source: sourceFilter as never } : {}),
              ...(statusFilter ? { lifecycleStatus: statusFilter as never } : {}),
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
    const workspaceId = await this.resolveDeliveryWorkspaceScope(userId);
    const row = await this.prisma.notificationDeadLetter.findFirst({
      where: {
        id: deadLetterId,
        ...(workspaceId !== null ? { workspaceId } : {}),
        resolvedAt: null
      }
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
    const workspaceId = await this.resolveDeliveryWorkspaceScope(userId);
    const row = await this.prisma.notificationDeadLetter.findFirst({
      where: {
        id: deadLetterId,
        ...(workspaceId !== null ? { workspaceId } : {}),
        resolvedAt: null
      }
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
    await this.requireGlobalNotificationPlatformAccess(userId);

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

  private channelDefaultToView(d: NotificationChannelRegistryDefault): NotificationChannelView {
    return {
      id: `default:${d.channelType}`,
      channelType: d.channelType,
      enabled: d.enabled,
      config: d.config,
      healthStatus: d.healthy ? "healthy" : "unconfigured",
      consecutiveFailures: 0,
      lastDeliveryAt: null,
      lastFailureAt: null,
      updatedAt: new Date(0).toISOString()
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
    const isAdminSystem = r.source === "admin_system";
    const normalizedConfig = isAdminSystem
      ? (parseAdminSystemPolicyConfig(r.config) as Record<string, unknown>)
      : ((r.config as Record<string, unknown>) ?? {});

    return {
      id: r.id,
      source: r.source,
      enabled: r.enabled,
      channels: isAdminSystem ? ["user_preferred"] : r.channels,
      cooldownMinutes: r.cooldownMinutes,
      maxPerDay: r.maxPerDay,
      escalationAfterMinutes: r.escalationAfterMinutes,
      escalationChannel: r.escalationChannel,
      respectQuietHours: r.respectQuietHours,
      renderStrategy: isAdminSystem ? "static_fallback" : r.renderStrategy,
      renderInstructionRef: r.renderInstructionRef,
      templateId: r.templateId,
      config: normalizedConfig,
      updatedAt: r.updatedAt.toISOString()
    };
  }

  private policyDefaultToView(d: NotificationPolicyDefault): NotificationPolicyView {
    return {
      id: `default:${d.source}`,
      source: d.source,
      enabled: d.enabled,
      channels: d.channels,
      cooldownMinutes: d.cooldownMinutes,
      maxPerDay: d.maxPerDay,
      escalationAfterMinutes: d.escalationAfterMinutes,
      escalationChannel: d.escalationChannel,
      respectQuietHours: d.respectQuietHours,
      renderStrategy: d.renderStrategy,
      renderInstructionRef: d.renderInstructionRef,
      templateId: d.templateId,
      config: d.config,
      updatedAt: new Date(0).toISOString()
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

  private quietHoursDefaultToView(
    d: NotificationQuietHoursDefault = NOTIFICATION_QUIET_HOURS_DEFAULT
  ): QuietHoursView {
    return {
      id: "default:quiet-hours",
      enabled: d.enabled,
      startLocal: d.startLocal,
      endLocal: d.endLocal,
      timezoneMode: d.timezoneMode,
      defaultTimezone: d.defaultTimezone,
      appliesToSources: d.appliesToSources,
      updatedAt: new Date(0).toISOString()
    };
  }

  private async getOrCreateChannelRow(channelType: string) {
    const defaults = NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS[channelType as NotificationChannelType];
    if (!defaults) {
      throw new NotFoundException(`Channel not found: ${channelType}`);
    }
    return this.prisma.notificationChannelRegistry.upsert({
      where: { channelType: channelType as never },
      update: {},
      create: {
        channelType: defaults.channelType,
        enabled: defaults.enabled,
        config: defaults.config as Prisma.InputJsonValue,
        healthStatus: (defaults.healthy ? "healthy" : "unconfigured") as never
      }
    });
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
