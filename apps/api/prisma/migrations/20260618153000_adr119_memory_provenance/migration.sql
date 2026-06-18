-- ADR-119 Slice 9: memory provenance enum + column
-- Existing rows backfill automatically to 'legacy' (column is additive with NOT NULL DEFAULT).
-- Reversible: production rollback can DROP COLUMN "provenance" and DROP TYPE "AssistantMemoryProvenance".

CREATE TYPE "AssistantMemoryProvenance" AS ENUM ('user_explicit', 'system_inferred', 'auto_extracted', 'legacy');

ALTER TABLE "assistant_memory_registry_items"
  ADD COLUMN "provenance" "AssistantMemoryProvenance" NOT NULL DEFAULT 'legacy';
