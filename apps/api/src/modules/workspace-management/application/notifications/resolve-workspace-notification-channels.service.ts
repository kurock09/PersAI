import { Injectable, Logger } from "@nestjs/common";
import {
  AssistantChannelBindingState,
  NotificationChannelType,
  type NotificationQuietHoursTimezoneMode
} from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import {
  NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS,
  NOTIFICATION_POLICY_DEFAULTS,
  NOTIFICATION_QUIET_HOURS_DEFAULT,
  type NotificationChannelRegistryDefault,
  type NotificationPolicyDefault,
  type NotificationQuietHoursDefault
} from "./defaults/notification-defaults";

/**
 * Resolves per-workspace channel availability at delivery time and reads
 * global policy / quiet-hours singletons.
 *
 * ADR-088 §4 — channel registry is global; per-workspace availability is
 * auto-derived from existing PersAI truth. The global registry row is
 * advisory (provides operator config / health). For `web_thread` and
 * `web_notification_center` it is NEVER a gate — those channels are always
 * available because PersAI always has a web product surface for the
 * workspace owner. For all other channel types the registry row gates
 * delivery via `enabled` / `healthStatus` plus channel-specific availability:
 *
 *   web_thread:               always available; chatId from intent context.
 *   web_notification_center:  always available; thread key
 *                             "system:notifications".
 *   telegram_thread:          requires AssistantChannelSurfaceBinding row
 *                             with bindingState=active and the global registry
 *                             row enabled+healthy.
 *   email:                    requires workspace owner AppUser.email; the
 *                             global registry row supplies sender domain
 *                             config.
 *   admin_webhook:            requires global registry row with endpointUrl.
 *   web_push, mobile_push:    not configured yet (return reason).
 *
 * Failure modes return a discriminated `ChannelResolution.available=false`
 * with an explicit `reason` so callers never silently swallow nulls.
 */
@Injectable()
export class ResolveWorkspaceNotificationChannelsService {
  private readonly logger = new Logger(ResolveWorkspaceNotificationChannelsService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  /**
   * Resolve a single channel for a workspace. Returns a discriminated result:
   * - `{ available: true, channel }` when the channel is deliverable now.
   * - `{ available: false, reason }` when the channel cannot be used; callers
   *   must record the reason in delivery attempts / logs rather than treat it
   *   as silent skip.
   */
  async resolveChannel(input: {
    workspaceId: string;
    channelType: string;
  }): Promise<ChannelResolution> {
    const channelType = input.channelType;
    const isWebChannel =
      channelType === NotificationChannelType.web_thread ||
      channelType === NotificationChannelType.web_notification_center;

    // Semantic channels have no registry row and no real adapter; they are
    // expanded at delivery time by the worker before adapter selection.
    const isSemanticChannel =
      channelType === NotificationChannelType.user_preferred ||
      channelType === NotificationChannelType.current_thread;

    const globalRow = isSemanticChannel
      ? null
      : await this.prisma.notificationChannelRegistry.findUnique({
          where: { channelType: channelType as NotificationChannelType }
        });

    const defaults = NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS[channelType as NotificationChannelType];

    // Web channels are always derivable per workspace; the registry row is
    // advisory (operator-controlled config such as opt-in metadata) but is
    // NOT a gate. Semantic channels bypass the registry entirely.
    // For every other channel type the registry row remains the operator gate
    // per ADR-088 §4.
    if (!isWebChannel && !isSemanticChannel) {
      if (!globalRow || !globalRow.enabled) {
        return { available: false, reason: "channel_disabled_globally" };
      }
      if (globalRow.healthStatus === "down") {
        return { available: false, reason: "channel_unhealthy" };
      }
    }

    const baseConfig = mergeConfig(defaults, globalRow);
    const baseHealth = (
      globalRow?.healthStatus ?? (defaults?.healthy ? "healthy" : "unconfigured")
    ).toString();

    switch (channelType) {
      case NotificationChannelType.web_thread:
      case NotificationChannelType.web_notification_center: {
        return {
          available: true,
          channel: {
            channelType,
            config: baseConfig,
            healthStatus: baseHealth
          }
        };
      }

      case NotificationChannelType.telegram_thread: {
        const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
          where: {
            assistant: { workspaceId: input.workspaceId },
            providerKey: "telegram",
            bindingState: AssistantChannelBindingState.active
          }
        });
        if (!binding) {
          return { available: false, reason: "channel_unhealthy" };
        }
        return {
          available: true,
          channel: {
            channelType,
            config: baseConfig,
            healthStatus: baseHealth
          }
        };
      }

      case NotificationChannelType.email: {
        const member = await this.prisma.workspaceMember.findFirst({
          where: { workspaceId: input.workspaceId, role: "owner" },
          select: { user: { select: { email: true } } }
        });
        const ownerEmail = member?.user?.email?.trim();
        if (!ownerEmail || ownerEmail.length === 0) {
          return { available: false, reason: "auto_derive_unavailable" };
        }
        return {
          available: true,
          channel: {
            channelType,
            config: { ...baseConfig, toAddress: ownerEmail },
            healthStatus: baseHealth
          }
        };
      }

      case NotificationChannelType.admin_webhook: {
        const url = baseConfig["endpointUrl"];
        if (typeof url !== "string" || url.trim().length === 0) {
          return { available: false, reason: "auto_derive_unavailable" };
        }
        return {
          available: true,
          channel: {
            channelType,
            config: baseConfig,
            healthStatus: baseHealth
          }
        };
      }

      case NotificationChannelType.web_push:
      case NotificationChannelType.mobile_push:
        return { available: false, reason: "auto_derive_unavailable" };

      // Semantic channels — not real adapters. Return available=true with no
      // meaningful config so the delivery worker can pick them up and expand
      // them before adapter selection (expandSemanticChannel in worker).
      case NotificationChannelType.user_preferred:
      case NotificationChannelType.current_thread:
        return {
          available: true,
          channel: {
            channelType,
            config: {},
            healthStatus: "healthy"
          }
        };

      default:
        this.logger.warn({
          event: "notification.resolve_channel.unknown_type",
          channelType
        });
        return { available: false, reason: "auto_derive_unavailable" };
    }
  }

  /**
   * Resolve the global policy for a notification source, falling back to the
   * code-level default registered in `notification-defaults.ts`.
   */
  async resolvePolicy(source: string): Promise<ResolvedPolicy> {
    const row = await this.prisma.notificationPolicy.findUnique({
      where: { source: source as never }
    });
    if (row) {
      return {
        source,
        enabled: row.enabled,
        channels: row.channels,
        cooldownMinutes: row.cooldownMinutes,
        maxPerDay: row.maxPerDay,
        escalationAfterMinutes: row.escalationAfterMinutes,
        escalationChannel: row.escalationChannel,
        respectQuietHours: row.respectQuietHours,
        renderStrategy: row.renderStrategy as string,
        renderInstructionRef: row.renderInstructionRef,
        templateId: row.templateId,
        config: (row.config as Record<string, unknown>) ?? {}
      };
    }
    const fallback =
      NOTIFICATION_POLICY_DEFAULTS[source as keyof typeof NOTIFICATION_POLICY_DEFAULTS];
    if (fallback) {
      return policyDefaultToResolved(fallback);
    }
    return UNKNOWN_POLICY_FALLBACK(source);
  }

  /**
   * Resolve the global quiet-hours configuration, falling back to the disabled
   * code-level default when no row exists.
   */
  async resolveQuietHours(): Promise<ResolvedQuietHours> {
    const row = await this.prisma.notificationQuietHours.findFirst({});
    if (!row) {
      return quietHoursDefaultToResolved(NOTIFICATION_QUIET_HOURS_DEFAULT);
    }
    return {
      enabled: row.enabled,
      startLocal: row.startLocal,
      endLocal: row.endLocal,
      timezoneMode: row.timezoneMode,
      defaultTimezone: row.defaultTimezone,
      appliesToSources: row.appliesToSources
    };
  }
}

// ── Resolution result types ────────────────────────────────────────────────────

export type ResolvedChannel = {
  channelType: string;
  config: Record<string, unknown>;
  healthStatus: string;
};

export type ChannelUnavailableReason =
  | "auto_derive_unavailable"
  | "channel_disabled_globally"
  | "channel_unhealthy";

export type ChannelResolution =
  | { available: true; channel: ResolvedChannel }
  | { available: false; reason: ChannelUnavailableReason };

export type ResolvedPolicy = {
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
};

export type ResolvedQuietHours = {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: NotificationQuietHoursTimezoneMode;
  defaultTimezone: string | null;
  appliesToSources: string[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mergeConfig(
  defaults: NotificationChannelRegistryDefault | undefined,
  row: { config: unknown } | null
): Record<string, unknown> {
  const base = defaults?.config ?? {};
  const fromRow = row && row.config ? (row.config as Record<string, unknown>) : {};
  return { ...base, ...fromRow };
}

function policyDefaultToResolved(d: NotificationPolicyDefault): ResolvedPolicy {
  return {
    source: d.source,
    enabled: d.enabled,
    channels: d.channels,
    cooldownMinutes: d.cooldownMinutes,
    maxPerDay: d.maxPerDay,
    escalationAfterMinutes: d.escalationAfterMinutes,
    escalationChannel: d.escalationChannel,
    respectQuietHours: d.respectQuietHours,
    renderStrategy: d.renderStrategy as string,
    renderInstructionRef: d.renderInstructionRef,
    templateId: d.templateId,
    config: d.config
  };
}

function quietHoursDefaultToResolved(d: NotificationQuietHoursDefault): ResolvedQuietHours {
  return {
    enabled: d.enabled,
    startLocal: d.startLocal,
    endLocal: d.endLocal,
    timezoneMode: d.timezoneMode,
    defaultTimezone: d.defaultTimezone,
    appliesToSources: d.appliesToSources
  };
}

function UNKNOWN_POLICY_FALLBACK(source: string): ResolvedPolicy {
  return {
    source,
    enabled: false,
    channels: [],
    cooldownMinutes: null,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: true,
    renderStrategy: "static_fallback",
    renderInstructionRef: null,
    templateId: null,
    config: {}
  };
}
