import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

/**
 * Resolves per-workspace channel availability at delivery time.
 * Reads global singleton notification tables (channel registry, policy, quiet hours)
 * and auto-derives whether each channel type is actually available for a specific workspace.
 *
 * Resolution rules per channelType (ADR-088 §T2):
 *   web_thread:               always available; no config required.
 *   web_notification_center:  always available; threadKey = "system:notifications".
 *   telegram_thread:          available iff AssistantChannelSurfaceBinding row exists
 *                             for this workspace with kind=telegram.
 *   email:                    available iff the workspace owner's AppUser.email is non-empty
 *                             AND the global Postmark token is configured.
 *   admin_webhook:            available iff global registry row has webhookUrl configured.
 *   web_push / mobile_push:   return null (future).
 */
@Injectable()
export class ResolveWorkspaceNotificationChannelsService {
  private readonly logger = new Logger(ResolveWorkspaceNotificationChannelsService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  /**
   * Returns whether a given channel type is available for the workspace,
   * plus any channel-specific metadata needed by the adapter.
   * Returns null when the channel is unavailable for this workspace.
   */
  async resolveChannel(input: {
    workspaceId: string;
    channelType: string;
  }): Promise<ResolvedChannel | null> {
    const globalRow = await this.prisma.notificationChannelRegistry.findUnique({
      where: { channelType: input.channelType as never }
    });

    if (!globalRow || !globalRow.enabled) {
      return null;
    }

    switch (input.channelType) {
      case "web_thread":
      case "web_notification_center":
        return {
          channelType: input.channelType,
          config: globalRow.config as Record<string, unknown>,
          healthStatus: globalRow.healthStatus as string
        };

      case "telegram_thread": {
        // Check if any assistant in this workspace has an active Telegram binding.
        const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
          where: {
            assistant: { workspaceId: input.workspaceId },
            providerKey: "telegram"
          }
        });
        if (!binding) return null;
        return {
          channelType: input.channelType,
          config: globalRow.config as Record<string, unknown>,
          healthStatus: globalRow.healthStatus as string
        };
      }

      case "email": {
        // Check if the workspace owner has an email address configured.
        const member = await this.prisma.workspaceMember.findFirst({
          where: { workspaceId: input.workspaceId, role: "owner" },
          select: { user: { select: { email: true } } }
        });
        const ownerEmail = member?.user?.email;
        if (!ownerEmail || ownerEmail.trim().length === 0) return null;
        return {
          channelType: input.channelType,
          config: {
            ...(globalRow.config as Record<string, unknown>),
            toAddress: ownerEmail
          },
          healthStatus: globalRow.healthStatus as string
        };
      }

      case "admin_webhook": {
        const config = globalRow.config as Record<string, unknown>;
        if (!config["webhookUrl"]) return null;
        return {
          channelType: input.channelType,
          config,
          healthStatus: globalRow.healthStatus as string
        };
      }

      default:
        return null;
    }
  }

  /**
   * Resolves the global policy for a notification source.
   * Falls back to code defaults if no DB row exists.
   */
  async resolvePolicy(source: string): Promise<ResolvedPolicy> {
    const row = await this.prisma.notificationPolicy.findUnique({
      where: { source: source as never }
    });
    if (!row) {
      return POLICY_DEFAULTS[source] ?? DEFAULT_POLICY_FALLBACK;
    }
    return {
      source,
      enabled: row.enabled,
      channels: row.channels,
      cooldownMinutes: row.cooldownMinutes,
      escalationAfterMinutes: row.escalationAfterMinutes,
      escalationChannel: row.escalationChannel,
      respectQuietHours: row.respectQuietHours,
      renderStrategy: row.renderStrategy as string,
      config: (row.config as Record<string, unknown>) ?? {}
    };
  }

  /**
   * Resolves the global quiet hours configuration.
   * Falls back to disabled if no DB row exists.
   */
  async resolveQuietHours(): Promise<ResolvedQuietHours> {
    const row = await this.prisma.notificationQuietHours.findFirst({});
    if (!row) {
      return DEFAULT_QUIET_HOURS;
    }
    return {
      enabled: row.enabled,
      startLocal: row.startLocal,
      endLocal: row.endLocal,
      timezoneMode: row.timezoneMode as string,
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

export type ResolvedPolicy = {
  source: string;
  enabled: boolean;
  channels: string[];
  cooldownMinutes: number | null;
  escalationAfterMinutes: number | null;
  escalationChannel: string | null;
  respectQuietHours: boolean;
  renderStrategy: string;
  config: Record<string, unknown>;
};

export type ResolvedQuietHours = {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: string;
  defaultTimezone: string | null;
  appliesToSources: string[];
};

// ── Code-level defaults (used when no DB row exists on fresh install) ─────────

const DEFAULT_POLICY_FALLBACK: ResolvedPolicy = {
  source: "unknown",
  enabled: false,
  channels: [],
  cooldownMinutes: null,
  escalationAfterMinutes: null,
  escalationChannel: null,
  respectQuietHours: true,
  renderStrategy: "static_fallback",
  config: {}
};

const POLICY_DEFAULTS: Record<string, ResolvedPolicy> = {
  idle_reengagement: {
    source: "idle_reengagement",
    enabled: false,
    channels: ["web_notification_center", "telegram_thread"],
    cooldownMinutes: 1440,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: true,
    renderStrategy: "grounded_llm",
    config: { idleHours: 24 }
  },
  quota_advisory: {
    source: "quota_advisory",
    enabled: true,
    channels: ["web_thread", "telegram_thread"],
    cooldownMinutes: 60,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: "grounded_llm",
    config: {}
  },
  reminder: {
    source: "reminder",
    enabled: true,
    channels: ["telegram_thread", "web_notification_center"],
    cooldownMinutes: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: "grounded_llm",
    config: {}
  },
  background_task_push: {
    source: "background_task_push",
    enabled: true,
    channels: ["web_notification_center", "telegram_thread"],
    cooldownMinutes: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: "grounded_llm",
    config: {}
  },
  billing_lifecycle: {
    source: "billing_lifecycle",
    enabled: true,
    channels: ["email"],
    cooldownMinutes: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: "template",
    config: {
      assistantPushEnabled: false,
      rules: {
        trial_ending: { enabled: true, offsetDays: 3 },
        trial_expired: { enabled: true, offsetDays: null },
        renewal_failed: { enabled: true, offsetDays: null },
        grace_ending: { enabled: true, offsetDays: 1 },
        grace_expired: { enabled: true, offsetDays: null },
        payment_recovered: { enabled: true, offsetDays: null }
      }
    }
  }
};

const DEFAULT_QUIET_HOURS: ResolvedQuietHours = {
  enabled: false,
  startLocal: "22:00",
  endLocal: "08:00",
  timezoneMode: "workspace_default",
  defaultTimezone: null,
  appliesToSources: []
};
