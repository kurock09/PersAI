-- ADR-086 Slice 3: durable worker claim/request/result state for media jobs.

ALTER TABLE "assistant_media_jobs"
  ADD COLUMN "request_json" JSONB,
  ADD COLUMN "result_text" TEXT,
  ADD COLUMN "artifacts_json" JSONB,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "scheduler_claim_token" VARCHAR(64),
  ADD COLUMN "scheduler_claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "scheduler_claim_expires_at" TIMESTAMPTZ(6);

CREATE INDEX "assistant_media_jobs_status_retry_created_idx"
  ON "assistant_media_jobs"("status", "next_retry_at", "created_at");

CREATE INDEX "assistant_media_jobs_claim_expires_idx"
  ON "assistant_media_jobs"("scheduler_claim_expires_at");
