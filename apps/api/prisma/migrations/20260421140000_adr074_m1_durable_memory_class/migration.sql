-- ADR-074 Slice M1 — Durable memory: core + relevance-retrieved tail.
--
-- Promotes the per-entry kind (fact / preference / open_loop) to a first-class
-- enum column, introduces a memory_class enum (core / contextual) so the runtime
-- can split hydration between an always-on core and a turn-relevance contextual
-- tail, and persists last_used_at to support recency / staleness scoring.
--
-- Backfill rules (deterministic from the existing source_label / source_type):
--   * memory_write rows previously encoded the kind in source_label
--     ("Memory write: fact" / "Memory write: preference" / "Memory write: open loop").
--   * Workspace-managed user entries land via "Workspace memory" — those are
--     identity / preference style and stay always-on (core).
--   * Conversation-derived web_chat memories are kind=NULL and contextual
--     (relevance-retrieved per turn).
--
-- Reversible: enums are dropped only after the columns / indexes that reference
-- them have been removed in `down.sql`.

CREATE TYPE "AssistantMemoryRegistryClass" AS ENUM ('core', 'contextual');
CREATE TYPE "AssistantMemoryRegistryKind"  AS ENUM ('fact', 'preference', 'open_loop');

ALTER TABLE "assistant_memory_registry_items"
  ADD COLUMN "memory_class" "AssistantMemoryRegistryClass" NOT NULL DEFAULT 'contextual',
  ADD COLUMN "kind"         "AssistantMemoryRegistryKind",
  ADD COLUMN "last_used_at" TIMESTAMPTZ(6);

UPDATE "assistant_memory_registry_items"
SET
  "kind" = CASE
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Memory write: fact'       THEN 'fact'::"AssistantMemoryRegistryKind"
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Memory write: preference' THEN 'preference'::"AssistantMemoryRegistryKind"
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Memory write: open loop'  THEN 'open_loop'::"AssistantMemoryRegistryKind"
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Workspace memory'         THEN 'fact'::"AssistantMemoryRegistryKind"
    WHEN "source_type" = 'memory_write'                                                 THEN 'fact'::"AssistantMemoryRegistryKind"
    ELSE NULL
  END,
  "memory_class" = CASE
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Memory write: fact'       THEN 'core'::"AssistantMemoryRegistryClass"
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Memory write: preference' THEN 'core'::"AssistantMemoryRegistryClass"
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Memory write: open loop'  THEN 'contextual'::"AssistantMemoryRegistryClass"
    WHEN "source_type" = 'memory_write' AND "source_label" = 'Workspace memory'         THEN 'core'::"AssistantMemoryRegistryClass"
    WHEN "source_type" = 'memory_write'                                                 THEN 'core'::"AssistantMemoryRegistryClass"
    ELSE 'contextual'::"AssistantMemoryRegistryClass"
  END;

CREATE INDEX "assistant_memory_registry_items_assistant_class_created_idx"
  ON "assistant_memory_registry_items" ("assistant_id", "memory_class", "created_at" DESC);

CREATE INDEX "assistant_memory_registry_items_assistant_lastused_idx"
  ON "assistant_memory_registry_items" ("assistant_id", "last_used_at" DESC);
