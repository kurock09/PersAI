-- CreateEnum
CREATE TYPE "AssistantUploadMicroDescriptionJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "assistant_upload_micro_description_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "assistant_file_id" UUID NOT NULL,
    "source_attachment_id" UUID,
    "status" "AssistantUploadMicroDescriptionJobStatus" NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMPTZ(6),
    "scheduler_claim_token" VARCHAR(64),
    "scheduler_claimed_at" TIMESTAMPTZ(6),
    "scheduler_claim_expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "usage_json" JSONB,
    "usage_occurred_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_upload_micro_description_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_upload_micro_description_jobs_assistant_file_id_key"
ON "assistant_upload_micro_description_jobs"("assistant_file_id");

-- CreateIndex
CREATE INDEX "assistant_upload_micro_description_jobs_assistant_id_status_up_idx"
ON "assistant_upload_micro_description_jobs"("assistant_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_upload_micro_description_jobs_workspace_id_status_up_idx"
ON "assistant_upload_micro_description_jobs"("workspace_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_upload_micro_description_jobs_status_updated_at_idx"
ON "assistant_upload_micro_description_jobs"("status", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_upload_micro_description_jobs_status_next_retry_created_idx"
ON "assistant_upload_micro_description_jobs"("status", "next_retry_at", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_upload_micro_description_jobs"
ADD CONSTRAINT "assistant_upload_micro_description_jobs_assistant_id_fkey"
FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_upload_micro_description_jobs"
ADD CONSTRAINT "assistant_upload_micro_description_jobs_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_upload_micro_description_jobs"
ADD CONSTRAINT "assistant_upload_micro_description_jobs_assistant_file_id_fkey"
FOREIGN KEY ("assistant_file_id") REFERENCES "assistant_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
