-- ADR-074 F1 (background-task hygiene): per-task attempt counter +
-- last error breadcrumb so the scheduler can apply exponential backoff and
-- terminate (dead-letter) consistently, and so the admin task list can show
-- the most recent failure reason without us having to grep GKE.

ALTER TABLE "assistant_task_registry_items"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error_message" VARCHAR(2000),
  ADD COLUMN "last_error_at" TIMESTAMPTZ(6);
