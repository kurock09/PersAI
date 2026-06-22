-- ADR-125 follow-up — drop scenario-seeded plan path; the model now owns the
-- entire plan lifecycle via `todo_write`, including scenario intake when
-- `skill.engage` returns scenario steps.
--
-- Migration is fail-safe on existing data: any rows previously inserted with
-- origin='scenario_seeded' simply lose their attribution columns and the
-- enum; their content/status/sortOrder/parent linkage stay intact, so they
-- continue to render in the plan card and `<persai_chat_plan>` block.

-- 1. Drop the seed-key partial index used for engage idempotency lookups.
DROP INDEX IF EXISTS "assistant_chat_todos_chat_id_seed_key_idx";

-- 2. Drop the attribution columns. Each is nullable, so this is data-safe.
ALTER TABLE "assistant_chat_todos"
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "seed_skill_id",
  DROP COLUMN IF EXISTS "seed_skill_label",
  DROP COLUMN IF EXISTS "seed_scenario_key",
  DROP COLUMN IF EXISTS "seed_key";

-- 3. Drop the origin enum type now that no column references it.
DROP TYPE IF EXISTS "AssistantChatTodoOrigin";
