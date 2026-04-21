-- ADR-074 Slice M2 — dedicated scheduler epoch counter for the background
-- compaction scheduler. Mirrors the `reminder_scheduler_epoch` column added by
-- migration `20260413113000_t15_5_native_reminder_scheduler_state` so a pod
-- bounce or deploy can invalidate stale claims without touching the reminder
-- scheduler's epoch.
ALTER TABLE "platform_config_generations"
ADD COLUMN "background_compaction_scheduler_epoch" INTEGER NOT NULL DEFAULT 1;
