/**
 * Code-level defaults for the unified notification platform.
 *
 * ADR-088 (Slice 2.5 — multi-user correction) makes
 * `notification_channel_registry`, `notification_policies`, and
 * `notification_quiet_hours` global singleton tables. Operators edit one row per
 * channel / per source / one quiet-hours row in `Admin > Notifications`. These
 * defaults are the single source of truth used by every consumer (resolver,
 * worker, intent service, admin preview) when the corresponding DB row is
 * missing on a fresh install or before the operator has touched a section.
 *
 * No inline copies of these constants are permitted elsewhere in the codebase.
 */

import {
  NotificationChannelType,
  NotificationRenderStrategy,
  NotificationSource
} from "@prisma/client";

/**
 * Resolved per-source notification policy as consumed by callers.
 * Mirrors the shape the resolver returns from the global singleton table.
 */
export type NotificationPolicyDefault = {
  source: NotificationSource;
  class: "conversational" | "transactional" | "operational" | "administrative";
  enabled: boolean;
  channels: string[];
  cooldownMinutes: number | null;
  maxPerDay: number | null;
  escalationAfterMinutes: number | null;
  escalationChannel: string | null;
  respectQuietHours: boolean;
  renderStrategy: NotificationRenderStrategy;
  renderInstructionRef: string | null;
  templateId: string | null;
  config: Record<string, unknown>;
};

export type NotificationQuietHoursDefault = {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: "workspace_default" | "per_user_resolved";
  defaultTimezone: string | null;
  appliesToSources: string[];
};

export type NotificationChannelRegistryDefault = {
  channelType: NotificationChannelType;
  enabled: boolean;
  healthy: boolean;
  config: Record<string, unknown>;
  escalationOf: string | null;
};

/**
 * Default notification policy per source.
 * Every value of the `NotificationSource` enum is covered explicitly.
 */
export const NOTIFICATION_POLICY_DEFAULTS: Record<NotificationSource, NotificationPolicyDefault> = {
  idle_reengagement: {
    source: NotificationSource.idle_reengagement,
    class: "conversational",
    enabled: false,
    channels: ["user_preferred"],
    cooldownMinutes: 1440,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: "web_notification_center",
    respectQuietHours: true,
    renderStrategy: NotificationRenderStrategy.grounded_llm,
    renderInstructionRef: null,
    templateId: null,
    config: { idleHours: 24 }
  },
  quota_advisory: {
    source: NotificationSource.quota_advisory,
    class: "conversational",
    enabled: true,
    channels: ["current_thread"],
    cooldownMinutes: 60,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: NotificationRenderStrategy.grounded_llm,
    renderInstructionRef: null,
    templateId: null,
    config: {}
  },
  reminder: {
    source: NotificationSource.reminder,
    class: "conversational",
    enabled: true,
    channels: ["user_preferred"],
    cooldownMinutes: null,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: "web_notification_center",
    respectQuietHours: false,
    renderStrategy: NotificationRenderStrategy.grounded_llm,
    renderInstructionRef: null,
    templateId: null,
    config: {}
  },
  background_task_push: {
    source: NotificationSource.background_task_push,
    class: "conversational",
    enabled: true,
    channels: ["user_preferred"],
    cooldownMinutes: null,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: "web_notification_center",
    respectQuietHours: false,
    renderStrategy: NotificationRenderStrategy.grounded_llm,
    renderInstructionRef: null,
    templateId: null,
    config: {}
  },
  billing_lifecycle: {
    source: NotificationSource.billing_lifecycle,
    class: "transactional",
    enabled: true,
    channels: ["email"],
    cooldownMinutes: null,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: "admin_webhook",
    respectQuietHours: false,
    renderStrategy: NotificationRenderStrategy.template,
    renderInstructionRef: null,
    templateId: null,
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
  },
  admin_system: {
    source: NotificationSource.admin_system,
    class: "administrative",
    enabled: true,
    channels: ["admin_webhook"],
    cooldownMinutes: null,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: NotificationRenderStrategy.template,
    renderInstructionRef: null,
    templateId: null,
    config: {}
  },
  system_event: {
    source: NotificationSource.system_event,
    class: "operational",
    enabled: false,
    channels: ["admin_webhook"],
    cooldownMinutes: null,
    maxPerDay: null,
    escalationAfterMinutes: null,
    escalationChannel: null,
    respectQuietHours: false,
    renderStrategy: NotificationRenderStrategy.static_fallback,
    renderInstructionRef: null,
    templateId: null,
    config: {}
  }
};

/**
 * Conservative quiet-hours default. Disabled until the operator turns it on
 * from `Admin > Notifications`. `reminder` is excluded by default per ADR-088
 * §6 because the user picks the exact fire time.
 */
export const NOTIFICATION_QUIET_HOURS_DEFAULT: NotificationQuietHoursDefault = {
  enabled: false,
  startLocal: "22:00",
  endLocal: "08:00",
  timezoneMode: "workspace_default",
  defaultTimezone: null,
  appliesToSources: []
};

/**
 * Default global channel registry rows. Web channels are always available
 * per workspace (resolver derives chat/thread context); other channels need
 * operator configuration before they become deliverable. ADR-088 §4 + §10.
 */
export const NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS: Record<
  NotificationChannelType,
  NotificationChannelRegistryDefault
> = {
  web_thread: {
    channelType: NotificationChannelType.web_thread,
    enabled: true,
    healthy: true,
    config: {},
    escalationOf: null
  },
  web_notification_center: {
    channelType: NotificationChannelType.web_notification_center,
    enabled: true,
    healthy: true,
    config: {},
    escalationOf: null
  },
  telegram_thread: {
    channelType: NotificationChannelType.telegram_thread,
    enabled: true,
    healthy: true,
    config: {},
    escalationOf: null
  },
  email: {
    channelType: NotificationChannelType.email,
    enabled: true,
    healthy: true,
    config: { sendingDomain: "notifications.persai.dev" },
    escalationOf: null
  },
  admin_webhook: {
    channelType: NotificationChannelType.admin_webhook,
    enabled: false,
    healthy: false,
    config: {},
    escalationOf: null
  },
  web_push: {
    channelType: NotificationChannelType.web_push,
    enabled: false,
    healthy: false,
    config: {},
    escalationOf: null
  },
  mobile_push: {
    channelType: NotificationChannelType.mobile_push,
    enabled: false,
    healthy: false,
    config: {},
    escalationOf: null
  },
  // Semantic channels — not real adapters; no registry row is created for them.
  // These entries satisfy the exhaustive Record<NotificationChannelType, ...> type
  // and allow resolver / defaults code to reference them without a crash.
  user_preferred: {
    channelType: NotificationChannelType.user_preferred,
    enabled: true,
    healthy: true,
    config: {},
    escalationOf: null
  },
  current_thread: {
    channelType: NotificationChannelType.current_thread,
    enabled: true,
    healthy: true,
    config: {},
    escalationOf: null
  }
};
