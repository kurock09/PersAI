-- CreateEnum
CREATE TYPE "AssistantApplyStatus" AS ENUM (
    'not_requested',
    'pending',
    'in_progress',
    'succeeded',
    'failed',
    'degraded'
);

-- AlterTable
ALTER TABLE "assistants"
ADD COLUMN "apply_status" "AssistantApplyStatus" NOT NULL DEFAULT 'not_requested',
ADD COLUMN "apply_target_version_id" UUID,
ADD COLUMN "apply_applied_version_id" UUID,
ADD COLUMN "apply_requested_at" TIMESTAMPTZ(6),
ADD COLUMN "apply_started_at" TIMESTAMPTZ(6),
ADD COLUMN "apply_finished_at" TIMESTAMPTZ(6),
ADD COLUMN "apply_error_code" TEXT,
ADD COLUMN "apply_error_message" TEXT;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_apply_target_version_id_fkey" FOREIGN KEY ("apply_target_version_id") REFERENCES "assistant_published_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_apply_applied_version_id_fkey" FOREIGN KEY ("apply_applied_version_id") REFERENCES "assistant_published_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
