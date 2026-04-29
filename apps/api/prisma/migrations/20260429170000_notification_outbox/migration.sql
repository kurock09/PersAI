-- Durable assistant notification outbox and admin-managed user notification policies.

CREATE TYPE "AssistantNotificationOutboxSource" AS ENUM (
  'user_reminder',
  'background_task',
  'idle_reengagement',
  'system_event'
);

CREATE TYPE "AssistantNotificationOutboxStatus" AS ENUM (
  'pending',
  'in_progress',
  'delivered',
  'failed',
  'skipped',
  'dead_letter'
);

CREATE TYPE "WorkspaceNotificationPolicySource" AS ENUM (
  'idle_reengagement'
);

CREATE TABLE "assistant_notification_outbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" "AssistantNotificationOutboxSource" NOT NULL,
  "source_id" VARCHAR(128) NOT NULL,
  "dedupe_key" VARCHAR(512) NOT NULL,
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "status" "AssistantNotificationOutboxStatus" NOT NULL DEFAULT 'pending',
  "delivery_status" VARCHAR(32) NOT NULL DEFAULT 'ok',
  "text" TEXT,
  "artifacts_json" JSONB,
  "metadata_json" JSONB,
  "delivery_result_json" JSONB,
  "delivery_target" VARCHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "retry_after_at" TIMESTAMPTZ(6),
  "scheduler_claim_token" VARCHAR(64),
  "scheduler_claimed_at" TIMESTAMPTZ(6),
  "scheduler_claim_expires_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "delivered_at" TIMESTAMPTZ(6),
  "skipped_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_notification_outbox_assistant_fkey"
    FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants"("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_notification_outbox_workspace_member_fkey"
    FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members"("workspace_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_notification_outbox_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assistant_notification_outbox_dedupe_key_key"
  ON "assistant_notification_outbox"("dedupe_key");

CREATE INDEX "assistant_notification_outbox_status_due_idx"
  ON "assistant_notification_outbox"("status", "retry_after_at", "created_at");

CREATE INDEX "assistant_notification_outbox_assistant_source_idx"
  ON "assistant_notification_outbox"("assistant_id", "source", "source_id");

CREATE INDEX "assistant_notification_outbox_workspace_status_idx"
  ON "assistant_notification_outbox"("workspace_id", "status", "created_at" DESC);

CREATE TABLE "workspace_notification_policies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "source" "WorkspaceNotificationPolicySource" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "idle_hours" INTEGER NOT NULL DEFAULT 24,
  "cooldown_hours" INTEGER NOT NULL DEFAULT 72,
  "llm_instruction" TEXT NOT NULL,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_notification_policies_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workspace_notification_policies_updated_by_user_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_notification_policies_workspace_source_key"
  ON "workspace_notification_policies"("workspace_id", "source");

CREATE INDEX "workspace_notification_policies_workspace_enabled_idx"
  ON "workspace_notification_policies"("workspace_id", "enabled");

ALTER TABLE "assistant_background_task_runs"
  ADD COLUMN "notification_outbox_id" UUID;

CREATE INDEX "assistant_background_task_runs_notification_outbox_id_idx"
  ON "assistant_background_task_runs"("notification_outbox_id");
