-- ADR-159 Slice 1 repair: a durable CAS mutation marks the exact admission
-- linearization boundary for JOB_CATCHUP. USER_TURN preparing stamps share
-- the same assistant_chats row, so a user that starts before this mutation
-- cannot lose priority to a catch-up on another API replica.
-- The earlier 20260719160000_adr159_s2_chat_idle_pause migration is deployed
-- history and intentionally remains unchanged: web USER_TURN admission now
-- stamps before user-message persistence, with terminal-close ownership
-- transferring to the attempt only after markRunning succeeds.
ALTER TABLE "assistant_chats"
  ADD COLUMN IF NOT EXISTS "catch_up_admission_fence" INTEGER NOT NULL DEFAULT 0;

-- Durable round-robin recency prevents a fixed per-tick scan cap from
-- repeatedly selecting permanently gate-denied old chats.
ALTER TABLE "assistant_chats"
  ADD COLUMN IF NOT EXISTS "catch_up_last_scanned_at" TIMESTAMPTZ(6);
