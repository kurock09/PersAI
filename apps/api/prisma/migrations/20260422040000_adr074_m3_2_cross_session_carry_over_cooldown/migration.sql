-- ADR-074 Slice M3.2 — Cross-session re-trigger cooldown bookkeeping.
--
-- Adds a `last_cross_session_carry_over_at` column to `assistant_chats` so the
-- runtime can enforce a per-thread cooldown between consecutive long-idle
-- carry-over fires. The column is bumped (fire-and-forget) by the runtime via
-- a new internal endpoint after each non-empty M3 carry-over hydration.
--
-- Per ADR-074 M3.2 founder-trim (2026-04-22):
--   * Trigger is `(thread_first_turn) OR (idle >= idleHours)`.
--   * The brand-new thread sub-trigger remains cooldown-exempt; the long-idle
--     sub-trigger is gated by `now - last_cross_session_carry_over_at < cooldownHours`.
--   * The post-compaction sub-trigger is explicitly OUT OF SCOPE (re-firing
--     mid-conversation just because auto-compaction silently ran would feel
--     like the assistant "suddenly remembers" things — the opposite of magic).
--
-- No new index needed: the column is read by primary-key lookup on the
-- existing `assistant_chats_pkey` whenever the runtime hydrates the current
-- thread.
--
-- Reversible: drop the column.

ALTER TABLE "assistant_chats"
  ADD COLUMN "last_cross_session_carry_over_at" TIMESTAMPTZ(6);
