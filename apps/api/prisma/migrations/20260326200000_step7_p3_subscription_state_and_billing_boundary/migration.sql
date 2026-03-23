-- CreateEnum
CREATE TYPE "WorkspaceSubscriptionStatus" AS ENUM (
  'trialing',
  'active',
  'grace_period',
  'past_due',
  'paused',
  'canceled',
  'expired'
);

-- CreateTable
CREATE TABLE "workspace_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "plan_code" VARCHAR(64) NOT NULL,
    "status" "WorkspaceSubscriptionStatus" NOT NULL,
    "trial_started_at" TIMESTAMPTZ(6),
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_started_at" TIMESTAMPTZ(6),
    "current_period_ends_at" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "billing_provider" VARCHAR(64),
    "provider_customer_ref" VARCHAR(128),
    "provider_subscription_ref" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscriptions_workspace_id_key" ON "workspace_subscriptions"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_subscriptions_plan_code_status_idx" ON "workspace_subscriptions"("plan_code", "status");

-- AddForeignKey
ALTER TABLE "workspace_subscriptions"
ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
