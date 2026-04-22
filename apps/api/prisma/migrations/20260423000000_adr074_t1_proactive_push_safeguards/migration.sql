-- ADR-074 Slice T1 — Proactive-push frequency safeguards (additive only).
--
-- Adds three columns to `assistant_task_registry_items` so the new
-- `ProactivePushPolicyService` can enforce per-user frequency rules on
-- `audience="user"` scheduled actions:
--
--   * `last_fired_at`             — last successful user-visible dispatch
--                                   for this task. Anchors the 1-per-48h
--                                   minimum interval AND the 14-day
--                                   auto-mute window.
--   * `last_answered_check_at`    — last time the policy evaluator looked
--                                   at whether the user replied within
--                                   ANSWERED_WINDOW_HOURS of the previous
--                                   push. Prevents double-counting the
--                                   unanswered counter on retries.
--   * `consecutive_unanswered`    — running count of pushes the user has
--                                   not replied to within
--                                   ANSWERED_WINDOW_HOURS. Triggers
--                                   auto-mute at AUTO_MUTE_AFTER_UNANSWERED
--                                   (=2). Reset to 0 on ANY user-initiated
--                                   message (broader than "answered this
--                                   specific push", per ADR T1 #10).
--
-- Per ADR-074 Slice T1 hard constraints:
--   * #7  — additive-only schema change. NO new `proactive_push_log`
--           table, NO new index. Scheduler claim path already filters on
--           the existing partial-index on
--           `(controlStatus, nextRunAt, retryAfterAt, schedulerClaimExpiresAt)`.
--           The policy lookup runs per-claim by primary key.
--   * #8  — five policy CONSTANTS live in code, not in the database.
--           NO admin surface, NO plan-policy fields, NO per-workspace
--           overrides. Principle 1: policy is product behaviour, not config.
--
-- Reversible: drop the three columns.

ALTER TABLE "assistant_task_registry_items"
  ADD COLUMN "last_fired_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_answered_check_at" TIMESTAMPTZ(6),
  ADD COLUMN "consecutive_unanswered" INTEGER NOT NULL DEFAULT 0;
