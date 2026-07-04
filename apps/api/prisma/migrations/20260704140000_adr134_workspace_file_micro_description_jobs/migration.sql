CREATE TABLE "workspace_file_micro_description_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "source_kind" VARCHAR(32) NOT NULL,
    "source_chat_id" UUID,
    "source_assistant_id" UUID,
    "chat_mode" VARCHAR(32),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMPTZ(6),
    "last_error_message" TEXT,
    "usage_json" JSONB,
    "usage_occurred_at" TIMESTAMPTZ(6),
    "scheduler_claim_token" VARCHAR(64),
    "scheduler_claimed_at" TIMESTAMPTZ(6),
    "scheduler_claim_expires_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_file_micro_description_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_file_micro_description_jobs_workspace_id_path_key"
ON "workspace_file_micro_description_jobs"("workspace_id", "path");

CREATE INDEX "workspace_file_micro_description_jobs_status_scheduler_claim_expires_at_idx"
ON "workspace_file_micro_description_jobs"("status", "scheduler_claim_expires_at");

CREATE INDEX "workspace_file_micro_description_jobs_status_next_retry_at_created_at_idx"
ON "workspace_file_micro_description_jobs"("status", "next_retry_at", "created_at");
