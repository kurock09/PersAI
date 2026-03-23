-- CreateEnum
CREATE TYPE "PlatformRolloutStatus" AS ENUM ('in_progress', 'applied', 'rolled_back', 'failed');

-- CreateEnum
CREATE TYPE "PlatformRolloutItemOutcome" AS ENUM ('pending', 'succeeded', 'degraded', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "assistant_platform_rollouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "status" "PlatformRolloutStatus" NOT NULL DEFAULT 'in_progress',
    "rollout_percent" INTEGER NOT NULL,
    "target_patch" JSONB NOT NULL,
    "total_assistants" INTEGER NOT NULL DEFAULT 0,
    "targeted_assistants" INTEGER NOT NULL DEFAULT 0,
    "apply_succeeded_count" INTEGER NOT NULL DEFAULT 0,
    "apply_degraded_count" INTEGER NOT NULL DEFAULT 0,
    "apply_failed_count" INTEGER NOT NULL DEFAULT 0,
    "rolled_back_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assistant_platform_rollouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_platform_rollout_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rollout_id" UUID NOT NULL,
    "assistant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "previous_governance" JSONB NOT NULL,
    "updated_governance" JSONB NOT NULL,
    "apply_outcome" "PlatformRolloutItemOutcome" NOT NULL DEFAULT 'pending',
    "rollback_outcome" "PlatformRolloutItemOutcome" NOT NULL DEFAULT 'pending',
    "apply_status" "AssistantApplyStatus",
    "apply_error_code" VARCHAR(128),
    "apply_error_message" VARCHAR(512),
    "rollback_status" "AssistantApplyStatus",
    "rollback_error_code" VARCHAR(128),
    "rollback_error_message" VARCHAR(512),
    "applied_at" TIMESTAMPTZ(6),
    "rolled_back_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_platform_rollout_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_platform_rollouts_workspace_id_created_at_idx" ON "assistant_platform_rollouts"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_platform_rollout_items_rollout_id_assistant_id_key" ON "assistant_platform_rollout_items"("rollout_id", "assistant_id");

-- CreateIndex
CREATE INDEX "assistant_platform_rollout_items_assistant_id_created_at_idx" ON "assistant_platform_rollout_items"("assistant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "assistant_platform_rollouts" ADD CONSTRAINT "assistant_platform_rollouts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_platform_rollouts" ADD CONSTRAINT "assistant_platform_rollouts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_platform_rollout_items" ADD CONSTRAINT "assistant_platform_rollout_items_rollout_id_fkey" FOREIGN KEY ("rollout_id") REFERENCES "assistant_platform_rollouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_platform_rollout_items" ADD CONSTRAINT "assistant_platform_rollout_items_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_platform_rollout_items" ADD CONSTRAINT "assistant_platform_rollout_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
