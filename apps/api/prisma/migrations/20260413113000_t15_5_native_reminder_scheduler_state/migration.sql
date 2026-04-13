-- ADR-072 T15-5: native reminder scheduler state on PersAI task registry

ALTER TABLE "assistant_task_registry_items"
ADD COLUMN "reminder_payload_text" TEXT,
ADD COLUMN "schedule_json" JSONB,
ADD COLUMN "retry_after_at" TIMESTAMPTZ(6),
ADD COLUMN "scheduler_claim_token" VARCHAR(64),
ADD COLUMN "scheduler_claim_epoch" INTEGER,
ADD COLUMN "scheduler_claimed_at" TIMESTAMPTZ(6),
ADD COLUMN "scheduler_claim_expires_at" TIMESTAMPTZ(6);

ALTER TABLE "platform_config_generations"
ADD COLUMN "reminder_scheduler_epoch" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "assistant_task_registry_items_due_scheduler_idx"
ON "assistant_task_registry_items"(
  "control_status",
  "next_run_at",
  "retry_after_at",
  "scheduler_claim_expires_at"
);
