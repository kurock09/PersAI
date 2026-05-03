ALTER TYPE "WorkspaceSubscriptionStatus" ADD VALUE IF NOT EXISTS 'expired_fallback';

CREATE TYPE "WorkspaceSubscriptionLifecycleEventSource" AS ENUM (
  'system',
  'admin',
  'provider',
  'manual'
);

ALTER TABLE "workspace_subscriptions"
  ADD COLUMN "grace_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "grace_ends_at" TIMESTAMPTZ(6);

CREATE INDEX "workspace_subscriptions_status_grace_ends_at_idx"
  ON "workspace_subscriptions"("status", "grace_ends_at");

CREATE TABLE "billing_lifecycle_settings" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'global',
  "grace_period_days" INTEGER NOT NULL DEFAULT 5,
  "global_fallback_plan_code" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_lifecycle_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing_lifecycle_settings"
  ADD CONSTRAINT "billing_lifecycle_settings_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "billing_lifecycle_settings" (
  "id",
  "grace_period_days",
  "metadata",
  "updated_at"
)
VALUES (
  'global',
  5,
  '{"schema":"persai.billingLifecycleSettings.v1","source":"seed_default"}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "workspace_subscription_lifecycle_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID,
  "subscription_id" UUID,
  "event_code" VARCHAR(64) NOT NULL,
  "previous_status" "WorkspaceSubscriptionStatus",
  "next_status" "WorkspaceSubscriptionStatus",
  "previous_plan_code" VARCHAR(64),
  "next_plan_code" VARCHAR(64),
  "previous_period_started_at" TIMESTAMPTZ(6),
  "previous_period_ends_at" TIMESTAMPTZ(6),
  "next_period_started_at" TIMESTAMPTZ(6),
  "next_period_ends_at" TIMESTAMPTZ(6),
  "source" "WorkspaceSubscriptionLifecycleEventSource" NOT NULL,
  "related_payment_intent_ref" VARCHAR(128),
  "related_provider_event_ref" VARCHAR(128),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_subscription_lifecycle_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_subscription_lifecycle_events"
  ADD CONSTRAINT "workspace_subscription_lifecycle_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_subscription_lifecycle_events"
  ADD CONSTRAINT "workspace_subscription_lifecycle_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_subscription_lifecycle_events"
  ADD CONSTRAINT "workspace_subscription_lifecycle_events_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "workspace_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "workspace_subscription_lifecycle_events_workspace_id_created_at_idx"
  ON "workspace_subscription_lifecycle_events"("workspace_id", "created_at" DESC);

CREATE INDEX "workspace_subscription_lifecycle_events_user_id_created_at_idx"
  ON "workspace_subscription_lifecycle_events"("user_id", "created_at" DESC);

CREATE INDEX "workspace_subscription_lifecycle_events_event_code_created_at_idx"
  ON "workspace_subscription_lifecycle_events"("event_code", "created_at" DESC);

CREATE INDEX "workspace_subscription_lifecycle_events_source_created_at_idx"
  ON "workspace_subscription_lifecycle_events"("source", "created_at" DESC);
