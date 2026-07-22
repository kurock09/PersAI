-- ADR-161 A2 repair: prior-tool micro-clear with 5% hysteresis arm schedule.
-- active: keep-N projection stays on (no re-expand when meter drops).
-- next_arm_percent: 50 | 75 | 0 (0 = exhausted, wait for S3).
-- pending_eval + last_arm_percent: post-clear effectiveness → escalate/reset arm.
ALTER TABLE "runtime_sessions"
ADD COLUMN "prior_tool_micro_clear_active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "prior_tool_micro_clear_next_arm_percent" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN "prior_tool_micro_clear_pending_eval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "prior_tool_micro_clear_last_arm_percent" INTEGER NULL;
