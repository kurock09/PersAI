-- ADR-085 Slice 1: materialization rollout foundation.
-- Adds durable rollout/job tables for controlled materialization propagation and
-- extends scheduler leadership to a dedicated materialization rollout worker.

-- CreateEnum
CREATE TYPE "MaterializationRolloutType" AS ENUM (
  'manual_reapply',
  'plan_change',
  'system_prompt_change',
  'runtime_provider_settings_change',
  'tool_policy_change',
  'skill_policy_change',
  'billing_lifecycle_change',
  'single_assistant_reapply'
);

-- CreateEnum
CREATE TYPE "MaterializationRolloutTriggerSource" AS ENUM (
  'admin',
  'system',
  'billing_lifecycle',
  'plan_settings',
  'prompt_settings',
  'provider_settings',
  'tool_policy',
  'skill_policy'
);

-- CreateEnum
CREATE TYPE "MaterializationRolloutScopeType" AS ENUM (
  'all_published_assistants',
  'single_assistant',
  'effective_plan',
  'provider_profile',
  'affected_policy',
  'recent_active_first'
);

-- CreateEnum
CREATE TYPE "MaterializationRolloutCriticality" AS ENUM ('hard', 'soft', 'maintenance');

-- CreateEnum
CREATE TYPE "MaterializationRolloutStatus" AS ENUM (
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

-- CreateEnum
CREATE TYPE "MaterializationRolloutItemStatus" AS ENUM (
  'pending',
  'running',
  'succeeded',
  'degraded',
  'failed',
  'skipped',
  'cancelled'
);

-- CreateTable
CREATE TABLE "materialization_rollouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "rollout_type" "MaterializationRolloutType" NOT NULL,
  "trigger_source" "MaterializationRolloutTriggerSource" NOT NULL,
  "scope_type" "MaterializationRolloutScopeType" NOT NULL,
  "scope_metadata" JSONB NOT NULL DEFAULT '{}',
  "criticality" "MaterializationRolloutCriticality" NOT NULL,
  "target_generation" INTEGER NOT NULL,
  "status" "MaterializationRolloutStatus" NOT NULL DEFAULT 'pending',
  "total_items" INTEGER NOT NULL DEFAULT 0,
  "pending_count" INTEGER NOT NULL DEFAULT 0,
  "running_count" INTEGER NOT NULL DEFAULT 0,
  "succeeded_count" INTEGER NOT NULL DEFAULT 0,
  "degraded_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "cancelled_count" INTEGER NOT NULL DEFAULT 0,
  "concurrency_limit" INTEGER NOT NULL DEFAULT 1,
  "rate_limit_per_minute" INTEGER,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "materialization_rollouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materialization_rollout_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rollout_id" UUID NOT NULL,
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "target_generation" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "status" "MaterializationRolloutItemStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" VARCHAR(512),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "claimed_at" TIMESTAMPTZ(6),
  "materialized_spec_id" UUID,
  "materialized_content_hash" VARCHAR(128),
  "runtime_bundle_hash" VARCHAR(128),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "materialization_rollout_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "materialization_rollouts_workspace_id_created_at_idx"
  ON "materialization_rollouts" ("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "materialization_rollouts_status_created_at_idx"
  ON "materialization_rollouts" ("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "materialization_rollout_items_rollout_id_assistant_id_key"
  ON "materialization_rollout_items" ("rollout_id", "assistant_id");

-- CreateIndex
CREATE INDEX "materialization_rollout_items_status_next_retry_at_created_at_idx"
  ON "materialization_rollout_items" ("status", "next_retry_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "materialization_rollout_items_assistant_id_status_idx"
  ON "materialization_rollout_items" ("assistant_id", "status");

-- CreateIndex
CREATE INDEX "materialization_rollout_items_rollout_id_status_created_at_idx"
  ON "materialization_rollout_items" ("rollout_id", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "materialization_rollouts"
  ADD CONSTRAINT "materialization_rollouts_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materialization_rollouts"
  ADD CONSTRAINT "materialization_rollouts_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materialization_rollout_items"
  ADD CONSTRAINT "materialization_rollout_items_rollout_id_fkey"
  FOREIGN KEY ("rollout_id") REFERENCES "materialization_rollouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materialization_rollout_items"
  ADD CONSTRAINT "materialization_rollout_items_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materialization_rollout_items"
  ADD CONSTRAINT "materialization_rollout_items_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materialization_rollout_items"
  ADD CONSTRAINT "materialization_rollout_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend scheduler leadership with a dedicated materialization rollout worker row.
INSERT INTO "scheduler_leases" (
  "scheduler_key",
  "holder_id",
  "lease_token",
  "expires_at",
  "last_heartbeat",
  "created_at",
  "updated_at"
)
VALUES
  ('materialization_rollout', '', '', NOW(), NOW(), NOW(), NOW())
ON CONFLICT ("scheduler_key") DO NOTHING;
