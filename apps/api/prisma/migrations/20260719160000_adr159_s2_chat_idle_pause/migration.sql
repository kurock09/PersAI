-- ADR-159 S2: durable user-turn open window + post-user idle-pause debounce
-- for catch-up dispatch.
--
-- last_user_turn_started_at: stamped when a USER_TURN begins (Telegram inbound
-- after user message persist; web ordinary markRunning). Coordinator treats
-- started without terminal (or started after last terminal) as user-active so
-- Telegram preparing (pre-runtime-accept) is covered without inventing parked
-- accepted receipts.
--
-- last_user_turn_terminal_at: stamped when a USER_TURN becomes terminal;
-- catch-up waits CATCHUP_IDLE_PAUSE_MS (coordinator constant, ~1–3s) before
-- acquiring the per-chat catch-up lock.
--
-- Nullable: chats with no stamps behave as idle-pause inactive / no open window.
ALTER TABLE "assistant_chats"
  ADD COLUMN IF NOT EXISTS "last_user_turn_started_at" TIMESTAMPTZ(6);

ALTER TABLE "assistant_chats"
  ADD COLUMN IF NOT EXISTS "last_user_turn_terminal_at" TIMESTAMPTZ(6);
