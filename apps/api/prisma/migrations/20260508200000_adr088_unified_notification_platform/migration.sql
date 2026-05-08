-- ADR-088: Unified notification platform – Slice 1 foundation
-- Adds 9 new enums and 6 new tables.
-- Legacy notification tables are left untouched (dropped in Slices 2–4).

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "NotificationSource" AS ENUM (
  'idle_reengagement',
  'quota_advisory',
  'reminder',
  'background_task_push',
  'billing_lifecycle',
  'admin_system',
  'system_event'
);

CREATE TYPE "NotificationClass" AS ENUM (
  'conversational',
  'transactional',
  'operational',
  'administrative'
);

CREATE TYPE "NotificationPriority" AS ENUM (
  'immediate',
  'scheduled',
  'digest',
  'skippable'
);

CREATE TYPE "NotificationLifecycleStatus" AS ENUM (
  'pending',
  'claimed',
  'delivered',
  'failed',
  'dead_letter',
  'skipped',
  'deferred_quiet_hours',
  'deferred_rate_limit'
);

CREATE TYPE "NotificationRenderStrategy" AS ENUM (
  'grounded_llm',
  'template',
  'static_fallback'
);

CREATE TYPE "NotificationDeliveryAttemptStatus" AS ENUM (
  'pending',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'complaint',
  'escalated'
);

CREATE TYPE "NotificationChannelType" AS ENUM (
  'telegram_thread',
  'web_thread',
  'web_notification_center',
  'email',
  'admin_webhook',
  'web_push',
  'mobile_push'
);

CREATE TYPE "NotificationChannelHealth" AS ENUM (
  'healthy',
  'degraded',
  'down',
  'unconfigured'
);

CREATE TYPE "NotificationQuietHoursTimezoneMode" AS ENUM (
  'workspace_default',
  'per_user_resolved'
);

-- ── notification_intents ──────────────────────────────────────────────────────

CREATE TABLE "notification_intents" (
  "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"             UUID NOT NULL,
  "assistant_id"             UUID,
  "user_id"                  UUID,
  "source"                   "NotificationSource" NOT NULL,
  "class"                    "NotificationClass" NOT NULL,
  "priority"                 "NotificationPriority" NOT NULL,
  "lifecycle_status"         "NotificationLifecycleStatus" NOT NULL DEFAULT 'pending',
  "render_strategy"          "NotificationRenderStrategy" NOT NULL,
  "render_instruction_ref"   TEXT,
  "template_id"              TEXT,
  "fact_payload"             JSONB NOT NULL,
  "policy_snapshot"          JSONB NOT NULL,
  "allowed_channels"         TEXT[] NOT NULL DEFAULT '{}',
  "escalation_after_minutes" INTEGER,
  "escalation_channel"       VARCHAR(64),
  "dedupe_key"               VARCHAR(512),
  "scheduled_at"             TIMESTAMPTZ(6),
  "respect_quiet_hours"      BOOLEAN NOT NULL DEFAULT true,
  "surface"                  VARCHAR(64),
  "surface_thread_key"       VARCHAR(255),
  "chat_id"                  UUID,
  "trace_id"                 VARCHAR(255),
  "failure_reason"           TEXT,
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at"               TIMESTAMPTZ(6),
  "delivered_at"             TIMESTAMPTZ(6),
  "dead_lettered_at"         TIMESTAMPTZ(6),

  CONSTRAINT "notification_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_intents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notification_intents_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "notification_intents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notification_intents_workspace_id_dedupe_key_key"
  ON "notification_intents"("workspace_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

CREATE INDEX "notification_intents_workspace_id_lifecycle_status_scheduled_at_created_at_idx"
  ON "notification_intents"("workspace_id", "lifecycle_status", "scheduled_at", "created_at");

CREATE INDEX "notification_intents_workspace_id_source_lifecycle_status_created_at_idx"
  ON "notification_intents"("workspace_id", "source", "lifecycle_status", "created_at" DESC);

CREATE INDEX "notification_intents_assistant_id_lifecycle_status_created_at_idx"
  ON "notification_intents"("assistant_id", "lifecycle_status", "created_at" DESC);

-- ── notification_delivery_attempts ───────────────────────────────────────────

CREATE TABLE "notification_delivery_attempts" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "intent_id"      UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "channel"        VARCHAR(64) NOT NULL,
  "status"         "NotificationDeliveryAttemptStatus" NOT NULL DEFAULT 'pending',
  "provider_ref"   VARCHAR(255),
  "error"          JSONB,
  "escalation_of"  UUID,
  "started_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"   TIMESTAMPTZ(6),

  CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_delivery_attempts_intent_id_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "notification_intents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "notification_delivery_attempts_intent_id_attempt_number_idx"
  ON "notification_delivery_attempts"("intent_id", "attempt_number");

CREATE INDEX "notification_delivery_attempts_intent_id_status_idx"
  ON "notification_delivery_attempts"("intent_id", "status");

-- ── notification_channel_registry ────────────────────────────────────────────

CREATE TABLE "notification_channel_registry" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"        UUID NOT NULL,
  "channel_type"        "NotificationChannelType" NOT NULL,
  "enabled"             BOOLEAN NOT NULL DEFAULT false,
  "config"              JSONB NOT NULL DEFAULT '{}',
  "health_status"       "NotificationChannelHealth" NOT NULL DEFAULT 'unconfigured',
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "last_delivery_at"    TIMESTAMPTZ(6),
  "last_failure_at"     TIMESTAMPTZ(6),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_channel_registry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_channel_registry_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notification_channel_registry_workspace_id_channel_type_key"
  ON "notification_channel_registry"("workspace_id", "channel_type");

CREATE INDEX "notification_channel_registry_workspace_id_enabled_health_status_idx"
  ON "notification_channel_registry"("workspace_id", "enabled", "health_status");

-- ── notification_policies ─────────────────────────────────────────────────────

CREATE TABLE "notification_policies" (
  "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"             UUID NOT NULL,
  "source"                   "NotificationSource" NOT NULL,
  "enabled"                  BOOLEAN NOT NULL DEFAULT false,
  "channels"                 TEXT[] NOT NULL DEFAULT '{}',
  "cooldown_minutes"         INTEGER,
  "max_per_day"              INTEGER,
  "escalation_after_minutes" INTEGER,
  "escalation_channel"       VARCHAR(64),
  "respect_quiet_hours"      BOOLEAN NOT NULL DEFAULT true,
  "render_strategy"          "NotificationRenderStrategy" NOT NULL DEFAULT 'static_fallback',
  "render_instruction_ref"   TEXT,
  "template_id"              TEXT,
  "config"                   JSONB NOT NULL DEFAULT '{}',
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_policies_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notification_policies_workspace_id_source_key"
  ON "notification_policies"("workspace_id", "source");

CREATE INDEX "notification_policies_workspace_id_enabled_idx"
  ON "notification_policies"("workspace_id", "enabled");

-- ── notification_quiet_hours ──────────────────────────────────────────────────

CREATE TABLE "notification_quiet_hours" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"       UUID NOT NULL,
  "enabled"            BOOLEAN NOT NULL DEFAULT false,
  "start_local"        VARCHAR(5) NOT NULL DEFAULT '22:00',
  "end_local"          VARCHAR(5) NOT NULL DEFAULT '08:00',
  "timezone_mode"      "NotificationQuietHoursTimezoneMode" NOT NULL DEFAULT 'workspace_default',
  "default_timezone"   VARCHAR(64),
  "applies_to_sources" TEXT[] NOT NULL DEFAULT '{}',
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_quiet_hours_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_quiet_hours_workspace_id_key" UNIQUE ("workspace_id"),
  CONSTRAINT "notification_quiet_hours_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ── notification_dead_letters ─────────────────────────────────────────────────

CREATE TABLE "notification_dead_letters" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "intent_id"             UUID NOT NULL,
  "workspace_id"          UUID NOT NULL,
  "last_error"            JSONB NOT NULL,
  "escalation_attempts"   INTEGER NOT NULL DEFAULT 0,
  "claimed_for_replay_at" TIMESTAMPTZ(6),
  "resolved_at"           TIMESTAMPTZ(6),
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_dead_letters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_dead_letters_intent_id_key" UNIQUE ("intent_id"),
  CONSTRAINT "notification_dead_letters_intent_id_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "notification_intents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notification_dead_letters_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "notification_dead_letters_workspace_id_resolved_at_created_at_idx"
  ON "notification_dead_letters"("workspace_id", "resolved_at", "created_at" DESC);
