-- ADR-074 Slice M2 — durable background queue for off-band session compaction.
--
-- Architecture: the user-perceived turn ends at `completeAcceptedTurn` in
-- `apps/runtime`; immediately afterwards the runtime fires a best-effort
-- enqueue request to `apps/api`'s internal endpoint
-- `POST /api/v1/internal/runtime/compaction/enqueue`, which inserts (or
-- collapses) a row into `assistant_background_compaction_jobs`. A scheduler
-- inside `apps/api` (`PersaiBackgroundCompactionSchedulerService`, mirroring
-- the existing `PersaiScheduledActionSchedulerService` claim-and-lease shape)
-- polls this table, claims pending jobs with a TTL-based lease, and POSTs
-- each claimed job to the runtime's
-- `POST /api/v1/internal/runtime/sessions/compact-and-extract` endpoint.
-- The runtime then performs both the rolling-synopsis compaction and the
-- human-voiced auto-extract pass that writes durable memories through M1.
--
-- Supersede-on-enqueue is enforced by a partial unique index on
-- `pending_dedupe_key`: while a job for a given `(assistant_id, channel,
-- external_thread_key)` triple is pending it carries that dedupe key, so a
-- second enqueue ON CONFLICT DO NOTHING collapses into the existing row.
-- When the scheduler claims the job it nulls out `pending_dedupe_key`, which
-- frees the slot for the next post-turn enqueue while the claimed job runs.

CREATE TYPE "AssistantBackgroundCompactionJobStatus" AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'failed'
);

CREATE TYPE "AssistantBackgroundCompactionJobTrigger" AS ENUM (
  'post_turn',
  'manual'
);

CREATE TABLE "assistant_background_compaction_jobs" (
  "id"                          UUID                                          NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id"                UUID                                          NOT NULL,
  "workspace_id"                UUID                                          NOT NULL,
  "channel"                     "RuntimeConversationChannel"                  NOT NULL,
  "external_thread_key"         VARCHAR(255)                                  NOT NULL,
  "external_user_key"           VARCHAR(255),
  "runtime_tier"                "RuntimeTier"                                 NOT NULL,
  "trigger"                     "AssistantBackgroundCompactionJobTrigger"     NOT NULL DEFAULT 'post_turn',
  "status"                      "AssistantBackgroundCompactionJobStatus"      NOT NULL DEFAULT 'pending',
  "pending_dedupe_key"          VARCHAR(512),
  "attempt_count"               INTEGER                                       NOT NULL DEFAULT 0,
  "enqueued_request_id"         VARCHAR(128),
  "scheduler_claim_token"       VARCHAR(64),
  "scheduler_claim_epoch"       INTEGER,
  "scheduler_claimed_at"        TIMESTAMPTZ(6),
  "scheduler_claim_expires_at"  TIMESTAMPTZ(6),
  "retry_after_at"              TIMESTAMPTZ(6),
  "last_error_code"             VARCHAR(128),
  "last_error_message"          TEXT,
  "last_result_payload"         JSONB,
  "completed_at"                TIMESTAMPTZ(6),
  "created_at"                  TIMESTAMPTZ(6)                                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMPTZ(6)                                NOT NULL,
  CONSTRAINT "assistant_background_compaction_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_background_compaction_jobs_pending_dedupe_key_key"
  ON "assistant_background_compaction_jobs" ("pending_dedupe_key");

CREATE INDEX "assistant_background_compaction_jobs_status_due_idx"
  ON "assistant_background_compaction_jobs" ("status", "retry_after_at", "created_at");

CREATE INDEX "assistant_background_compaction_jobs_assistant_thread_idx"
  ON "assistant_background_compaction_jobs"
    ("assistant_id", "channel", "external_thread_key", "created_at" DESC);

CREATE INDEX "assistant_background_compaction_jobs_workspace_status_idx"
  ON "assistant_background_compaction_jobs"
    ("workspace_id", "status", "created_at" DESC);

ALTER TABLE "assistant_background_compaction_jobs"
  ADD CONSTRAINT "assistant_background_compaction_jobs_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_background_compaction_jobs"
  ADD CONSTRAINT "assistant_background_compaction_jobs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
