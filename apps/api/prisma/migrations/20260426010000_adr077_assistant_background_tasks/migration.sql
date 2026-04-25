-- ADR-077 — clean assistant background-task runtime foundation.
--
-- User-visible reminders remain in `assistant_task_registry_items`.
-- Assistant-side quiet actions move to their own task table plus per-fire run
-- history so settings can show "Действия ассистента" cards with recent
-- checked/pushed/failed state instead of inferring behavior from logs.

CREATE TYPE "AssistantBackgroundTaskStatus" AS ENUM (
  'active',
  'disabled',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "AssistantBackgroundTaskMode" AS ENUM (
  'llm_evaluate'
);

CREATE TYPE "AssistantBackgroundTaskRunStatus" AS ENUM (
  'running',
  'no_push',
  'pushed',
  'completed',
  'failed',
  'skipped'
);

CREATE TABLE "assistant_background_tasks" (
  "id"                         UUID                            NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id"               UUID                            NOT NULL,
  "user_id"                    UUID                            NOT NULL,
  "workspace_id"               UUID                            NOT NULL,
  "title"                      VARCHAR(500)                    NOT NULL,
  "brief"                      TEXT                            NOT NULL,
  "mode"                       "AssistantBackgroundTaskMode"   NOT NULL DEFAULT 'llm_evaluate',
  "status"                     "AssistantBackgroundTaskStatus" NOT NULL DEFAULT 'active',
  "external_ref"               VARCHAR(128),
  "schedule_json"              JSONB                           NOT NULL,
  "push_policy_json"           JSONB,
  "next_run_at"                TIMESTAMPTZ(6),
  "disabled_at"                TIMESTAMPTZ(6),
  "completed_at"               TIMESTAMPTZ(6),
  "cancelled_at"               TIMESTAMPTZ(6),
  "run_count"                  INTEGER                         NOT NULL DEFAULT 0,
  "last_run_at"                TIMESTAMPTZ(6),
  "last_run_status"            "AssistantBackgroundTaskRunStatus",
  "last_push_at"               TIMESTAMPTZ(6),
  "attempt_count"              INTEGER                         NOT NULL DEFAULT 0,
  "retry_after_at"             TIMESTAMPTZ(6),
  "scheduler_claim_token"      VARCHAR(64),
  "scheduler_claim_epoch"      INTEGER,
  "scheduler_claimed_at"       TIMESTAMPTZ(6),
  "scheduler_claim_expires_at" TIMESTAMPTZ(6),
  "last_error_code"            VARCHAR(128),
  "last_error_message"         TEXT,
  "last_error_at"              TIMESTAMPTZ(6),
  "created_at"                 TIMESTAMPTZ(6)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMPTZ(6)                  NOT NULL,
  CONSTRAINT "assistant_background_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_background_task_runs" (
  "id"                   UUID                              NOT NULL DEFAULT gen_random_uuid(),
  "task_id"              UUID                              NOT NULL,
  "assistant_id"         UUID                              NOT NULL,
  "user_id"              UUID                              NOT NULL,
  "workspace_id"         UUID                              NOT NULL,
  "scheduled_run_at"     TIMESTAMPTZ(6)                    NOT NULL,
  "started_at"           TIMESTAMPTZ(6),
  "finished_at"          TIMESTAMPTZ(6),
  "status"               "AssistantBackgroundTaskRunStatus" NOT NULL DEFAULT 'running',
  "decision_json"        JSONB,
  "push_text"            TEXT,
  "delivery_target"      VARCHAR(64),
  "delivery_result_json" JSONB,
  "error_code"           VARCHAR(128),
  "error_message"        TEXT,
  "usage_json"           JSONB,
  "created_at"           TIMESTAMPTZ(6)                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6)                    NOT NULL,
  CONSTRAINT "assistant_background_task_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_background_tasks_assistant_external_ref_key"
  ON "assistant_background_tasks" ("assistant_id", "external_ref");

CREATE INDEX "assistant_background_tasks_assistant_status_next_idx"
  ON "assistant_background_tasks" ("assistant_id", "status", "next_run_at");

CREATE INDEX "assistant_background_tasks_due_claim_idx"
  ON "assistant_background_tasks"
    ("status", "next_run_at", "retry_after_at", "scheduler_claim_expires_at");

CREATE INDEX "assistant_background_tasks_assistant_updated_idx"
  ON "assistant_background_tasks" ("assistant_id", "updated_at" DESC);

CREATE INDEX "assistant_background_task_runs_task_created_idx"
  ON "assistant_background_task_runs" ("task_id", "created_at" DESC);

CREATE INDEX "assistant_background_task_runs_assistant_created_idx"
  ON "assistant_background_task_runs" ("assistant_id", "created_at" DESC);

CREATE INDEX "assistant_background_task_runs_status_created_idx"
  ON "assistant_background_task_runs" ("status", "created_at" DESC);

ALTER TABLE "assistant_background_tasks"
  ADD CONSTRAINT "assistant_background_tasks_assistant_id_user_id_fkey"
    FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants" ("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_background_tasks"
  ADD CONSTRAINT "assistant_background_tasks_workspace_id_user_id_fkey"
    FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members" ("workspace_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_background_tasks"
  ADD CONSTRAINT "assistant_background_tasks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_background_task_runs"
  ADD CONSTRAINT "assistant_background_task_runs_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "assistant_background_tasks" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_background_task_runs"
  ADD CONSTRAINT "assistant_background_task_runs_assistant_id_user_id_fkey"
    FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants" ("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_background_task_runs"
  ADD CONSTRAINT "assistant_background_task_runs_workspace_id_user_id_fkey"
    FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members" ("workspace_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_background_task_runs"
  ADD CONSTRAINT "assistant_background_task_runs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
