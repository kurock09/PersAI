import {
  NotificationChannelHealth,
  NotificationChannelType,
  NotificationClass,
  NotificationDeliveryAttemptStatus,
  NotificationLifecycleStatus,
  NotificationPriority,
  NotificationQuietHoursTimezoneMode,
  NotificationRenderStrategy,
  NotificationSource
} from "@prisma/client";

export {
  NotificationChannelHealth,
  NotificationChannelType,
  NotificationClass,
  NotificationDeliveryAttemptStatus,
  NotificationLifecycleStatus,
  NotificationPriority,
  NotificationQuietHoursTimezoneMode,
  NotificationRenderStrategy,
  NotificationSource
};

// ── Core domain types ─────────────────────────────────────────────────────────

export type NotificationIntentRecord = {
  id: string;
  workspaceId: string;
  assistantId: string | null;
  userId: string | null;
  source: NotificationSource;
  class: NotificationClass;
  priority: NotificationPriority;
  lifecycleStatus: NotificationLifecycleStatus;
  renderStrategy: NotificationRenderStrategy;
  renderInstructionRef: string | null;
  templateId: string | null;
  factPayload: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
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
};

export type CreateNotificationIntentInput = {
  workspaceId: string;
  assistantId?: string | null;
  userId?: string | null;
  source: NotificationSource;
  class: NotificationClass;
  priority: NotificationPriority;
  renderStrategy: NotificationRenderStrategy;
  renderInstructionRef?: string | null;
  templateId?: string | null;
  factPayload: Record<string, unknown>;
  allowedChannels?: string[];
  escalationAfterMinutes?: number | null;
  escalationChannel?: string | null;
  dedupeKey?: string | null;
  scheduledAt?: Date | null;
  respectQuietHours?: boolean;
  surface?: string | null;
  surfaceThreadKey?: string | null;
  chatId?: string | null;
  traceId?: string | null;
};

export type ChannelRegistryRow = {
  id: string;
  channelType: NotificationChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  healthStatus: NotificationChannelHealth;
  consecutiveFailures: number;
  lastDeliveryAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPolicyRow = {
  id: string;
  source: NotificationSource;
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
  createdAt: Date;
  updatedAt: Date;
};

export type QuietHoursRow = {
  id: string;
  singleton: boolean;
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: NotificationQuietHoursTimezoneMode;
  defaultTimezone: string | null;
  appliesToSources: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type DeadLetterRow = {
  id: string;
  intentId: string;
  workspaceId: string;
  lastError: Record<string, unknown>;
  escalationAttempts: number;
  claimedForReplayAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type RenderedPayload = {
  subject?: string;
  body: string;
  html?: string;
  plainText?: string;
  metadata?: Record<string, unknown>;
};

export type DeliveryResult = {
  status: "delivered" | "failed" | "bounced" | "complaint";
  providerRef?: string;
  error?: Record<string, unknown>;
};

export type RoutingPlan = {
  primaryChannel: string;
  escalationChannel: string | null;
  escalationAfterMinutes: number | null;
  respectQuietHours: boolean;
  deferUntil: Date | null;
  skipReason: string | null;
};
