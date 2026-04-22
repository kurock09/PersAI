-- ADR-074 Slice M3 — Cross-session continuity carry-over.
--
-- Adds a `resolved_at` column to `assistant_memory_registry_items` so durable
-- open-loops (kind = 'open_loop') can be marked as completed without losing
-- their durable trace (we keep the row for audit / re-open). The partial
-- index keeps the look-up for "active open-loops per assistant/user" cheap
-- by indexing only the active rows we hydrate at turn 0.
--
-- Two complementary write paths set `resolved_at` (see ADR-074 Slice M3):
--   1. Implicit close-by-overwrite: when `memory_write(kind = 'open_loop')`
--      lexically dedupes onto an existing active row, the prior row is
--      stamped resolved_at = now() and a fresh row is inserted.
--   2. Opt-in explicit close: `memory_write({ closeOpenLoop: true, ... })`
--      finds the most-similar active open-loop for the same assistant/user
--      and stamps it resolved_at = now() (no-op if nothing matches).
--
-- M3.1 (queued) will replace path 2 with a structured close action and a
-- Memory Center UI button — both will continue to set this same column.
--
-- Reversible: drop the partial index first, then the column.

ALTER TABLE "assistant_memory_registry_items"
  ADD COLUMN "resolved_at" TIMESTAMPTZ(6);

CREATE INDEX "assistant_memory_registry_items_active_open_loops_idx"
  ON "assistant_memory_registry_items" ("assistant_id", "user_id", "created_at" DESC)
  WHERE "kind" = 'open_loop' AND "resolved_at" IS NULL AND "forgotten_at" IS NULL;
