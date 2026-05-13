-- ADR-094 Step 2 — durable per-event truth for smart `knowledge_search` and
-- the flexible `knowledge_fetch`. Both columns are nullable so the migration
-- is additive, reversible, and safe under the dev `api-migrate` PreSync hook
-- (no backfill required; pre-ADR-094 rows simply keep NULL).

ALTER TABLE "knowledge_retrieval_events"
  ADD COLUMN IF NOT EXISTS "mode_used" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "bytes_returned" INTEGER;
