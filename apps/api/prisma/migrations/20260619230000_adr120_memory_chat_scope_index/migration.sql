-- ADR-120 Slice 2 — Memory: open loops scoped to the current chat.
--
-- The runtime open-loop-refs developer block (and the close-by-similarity
-- path) now filter on (assistant_id, user_id, chat_id) for the open-only
-- subset (kind = 'open_loop', resolved_at IS NULL). This additive composite
-- index supports that scoped lookup so a chat-bounded query never has to scan
-- the assistant-wide open-loop set.
--
-- Additive + reversible: this only creates an index. To revert, drop it:
--   DROP INDEX IF EXISTS "assistant_memory_registry_items_assistant_user_chat_idx";

CREATE INDEX "assistant_memory_registry_items_assistant_user_chat_idx"
  ON "assistant_memory_registry_items" ("assistant_id", "user_id", "chat_id");
