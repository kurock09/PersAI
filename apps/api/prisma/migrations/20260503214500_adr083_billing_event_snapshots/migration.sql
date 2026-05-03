CREATE TYPE "WorkspaceSubscriptionBillingEventApplyStatus" AS ENUM (
  'pending',
  'applied',
  'ignored',
  'failed'
);

CREATE TABLE "workspace_subscription_billing_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID,
  "subscription_id" UUID,
  "source" "WorkspaceSubscriptionLifecycleEventSource" NOT NULL,
  "event_code" VARCHAR(64) NOT NULL,
  "event_ref" VARCHAR(128),
  "payment_intent_ref" VARCHAR(128),
  "billing_provider" VARCHAR(64),
  "provider_customer_ref" VARCHAR(128),
  "provider_subscription_ref" VARCHAR(128),
  "plan_code" VARCHAR(64),
  "current_period_started_at" TIMESTAMPTZ(6),
  "current_period_ends_at" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "apply_status" "WorkspaceSubscriptionBillingEventApplyStatus" NOT NULL DEFAULT 'pending',
  "applied_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "workspace_subscription_billing_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_subscription_billing_events"
  ADD CONSTRAINT "workspace_subscription_billing_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_subscription_billing_events"
  ADD CONSTRAINT "workspace_subscription_billing_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_subscription_billing_events"
  ADD CONSTRAINT "workspace_subscription_billing_events_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "workspace_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "workspace_subscription_billing_events_source_event_ref_key"
  ON "workspace_subscription_billing_events"("source", "event_ref");

CREATE INDEX "workspace_subscription_billing_events_workspace_id_created_at_idx"
  ON "workspace_subscription_billing_events"("workspace_id", "created_at" DESC);

CREATE INDEX "workspace_subscription_billing_events_subscription_id_created_at_idx"
  ON "workspace_subscription_billing_events"("subscription_id", "created_at" DESC);

CREATE INDEX "workspace_subscription_billing_events_apply_status_created_at_idx"
  ON "workspace_subscription_billing_events"("apply_status", "created_at" DESC);
