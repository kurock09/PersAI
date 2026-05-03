ALTER TYPE "AssistantNotificationOutboxSource" ADD VALUE IF NOT EXISTS 'billing_lifecycle';

CREATE TYPE "BillingLifecycleNotificationChannel" AS ENUM ('email', 'assistant_notification');

CREATE TYPE "BillingLifecycleNotificationJobStatus" AS ENUM (
  'pending',
  'enqueued',
  'skipped',
  'failed'
);

CREATE TABLE "billing_lifecycle_notification_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID,
  "assistant_id" UUID,
  "subscription_id" UUID,
  "lifecycle_event_id" UUID,
  "event_code" VARCHAR(64) NOT NULL,
  "notification_code" VARCHAR(64) NOT NULL,
  "channel" "BillingLifecycleNotificationChannel" NOT NULL,
  "status" "BillingLifecycleNotificationJobStatus" NOT NULL DEFAULT 'pending',
  "dedupe_key" VARCHAR(512) NOT NULL,
  "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
  "recipient_email" VARCHAR(255),
  "subject" VARCHAR(255),
  "text" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "assistant_notification_outbox_id" UUID,
  "enqueued_at" TIMESTAMPTZ(6),
  "skipped_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_lifecycle_notification_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_lifecycle_notification_jobs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_lifecycle_notification_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "billing_lifecycle_notification_jobs_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "billing_lifecycle_notification_jobs_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "workspace_subscriptions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "billing_lifecycle_notification_jobs_lifecycle_event_id_fkey"
    FOREIGN KEY ("lifecycle_event_id") REFERENCES "workspace_subscription_lifecycle_events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_lifecycle_notification_jobs_dedupe_key_key"
  ON "billing_lifecycle_notification_jobs"("dedupe_key");

CREATE INDEX "billing_lifecycle_notification_jobs_workspace_id_scheduled_for_idx"
  ON "billing_lifecycle_notification_jobs"("workspace_id", "scheduled_for");

CREATE INDEX "billing_lifecycle_notification_jobs_status_scheduled_for_idx"
  ON "billing_lifecycle_notification_jobs"("status", "scheduled_for");

CREATE INDEX "billing_lifecycle_notification_jobs_lifecycle_event_id_idx"
  ON "billing_lifecycle_notification_jobs"("lifecycle_event_id");

CREATE INDEX "billing_lifecycle_notification_jobs_assistant_notification_outbox_id_idx"
  ON "billing_lifecycle_notification_jobs"("assistant_notification_outbox_id");
