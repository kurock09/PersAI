CREATE TYPE "WorkspacePaymentIntentAction" AS ENUM (
  'new_purchase',
  'upgrade',
  'renewal',
  'manual_admin'
);

CREATE TYPE "WorkspacePaymentIntentStatus" AS ENUM (
  'created',
  'checkout_ready',
  'pending_confirmation',
  'succeeded',
  'failed',
  'canceled',
  'expired'
);

CREATE TYPE "WorkspacePaymentMethodClass" AS ENUM (
  'card',
  'sbp_qr'
);

CREATE TYPE "WorkspacePaymentIntentBillingPeriod" AS ENUM (
  'month',
  'year'
);

CREATE TYPE "WorkspacePaymentCheckoutMode" AS ENUM (
  'widget',
  'redirect',
  'payment_link',
  'qr_code',
  'manual_test'
);

CREATE TABLE "workspace_payment_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID,
  "target_plan_code" VARCHAR(64) NOT NULL,
  "action" "WorkspacePaymentIntentAction" NOT NULL,
  "status" "WorkspacePaymentIntentStatus" NOT NULL DEFAULT 'created',
  "payment_method_class" "WorkspacePaymentMethodClass" NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" VARCHAR(8) NOT NULL,
  "billing_period" "WorkspacePaymentIntentBillingPeriod" NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "return_url" TEXT NOT NULL,
  "billing_provider" VARCHAR(64),
  "provider_customer_ref" VARCHAR(128),
  "provider_session_ref" VARCHAR(128),
  "provider_payment_ref" VARCHAR(128),
  "checkout_mode" "WorkspacePaymentCheckoutMode",
  "checkout_payload" JSONB,
  "expires_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "workspace_payment_intents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_payment_intents"
  ADD CONSTRAINT "workspace_payment_intents_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_payment_intents"
  ADD CONSTRAINT "workspace_payment_intents_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "workspace_payment_intents_workspace_id_idempotency_key_key"
  ON "workspace_payment_intents"("workspace_id", "idempotency_key");

CREATE INDEX "workspace_payment_intents_workspace_id_created_at_idx"
  ON "workspace_payment_intents"("workspace_id", "created_at" DESC);

CREATE INDEX "workspace_payment_intents_user_id_created_at_idx"
  ON "workspace_payment_intents"("user_id", "created_at" DESC);

CREATE INDEX "workspace_payment_intents_status_created_at_idx"
  ON "workspace_payment_intents"("status", "created_at" DESC);
