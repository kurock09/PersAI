-- ADR-125 Slice 1: per-chat hierarchical todo list owned by the model via the
-- `todo_write` native tool. The server is the source of truth. `sort_order`
-- keeps the model-declared in-list ordering within a parent scope; new items
-- append (`max(sort_order)+1`). `(chat_id, seed_key)` uniquely identifies a
-- scenario-seeded batch so re-engaging the same scenario is a no-op.
-- Hard delete via ON DELETE CASCADE — `remove` propagates to children and
-- `clear` deletes the whole chat plan.
-- Reversible: production rollback can DROP TABLE "assistant_chat_todos" then
-- DROP TYPE "AssistantChatTodoOrigin"; DROP TYPE "AssistantChatTodoStatus".

CREATE TYPE "AssistantChatTodoStatus" AS ENUM ('pending', 'in_progress', 'completed');

CREATE TYPE "AssistantChatTodoOrigin" AS ENUM ('model_authored', 'scenario_seeded');

CREATE TABLE "assistant_chat_todos" (
  "id"                   UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "chat_id"              UUID                       NOT NULL,
  "assistant_id"         UUID                       NOT NULL,
  "parent_id"            UUID,
  "content"              TEXT                       NOT NULL,
  "status"               "AssistantChatTodoStatus"  NOT NULL DEFAULT 'pending',
  "origin"               "AssistantChatTodoOrigin"  NOT NULL DEFAULT 'model_authored',
  "seed_skill_id"        UUID,
  "seed_skill_label"     TEXT,
  "seed_scenario_key"    TEXT,
  "seed_key"             TEXT,
  "sort_order"           INTEGER                    NOT NULL,
  "completion_criteria"  JSONB,
  "created_at"           TIMESTAMPTZ(6)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6)             NOT NULL,
  "completed_at"         TIMESTAMPTZ(6),

  CONSTRAINT "assistant_chat_todos_pkey" PRIMARY KEY ("id")
);

-- Idempotency for skill-seeded batches: re-engaging the same scenario produces
-- the same seed_key for all N step rows; the runtime checks `(chat_id, seed_key)`
-- via the service BEFORE inserting, so the second engage is a no-op. This is a
-- non-unique index because N steps in one batch share the same key.
CREATE INDEX "assistant_chat_todos_chat_id_seed_key_idx"
  ON "assistant_chat_todos" ("chat_id", "seed_key");

-- Hot read paths: per-chat ordering for the rendered window, and per-parent
-- ordering for parent/children queries.
CREATE INDEX "assistant_chat_todos_chat_id_sort_order_idx"
  ON "assistant_chat_todos" ("chat_id", "sort_order");

CREATE INDEX "assistant_chat_todos_chat_id_parent_id_sort_order_idx"
  ON "assistant_chat_todos" ("chat_id", "parent_id", "sort_order");

CREATE INDEX "assistant_chat_todos_parent_id_idx"
  ON "assistant_chat_todos" ("parent_id");

ALTER TABLE "assistant_chat_todos"
  ADD CONSTRAINT "assistant_chat_todos_chat_id_fkey"
  FOREIGN KEY ("chat_id")
  REFERENCES "assistant_chats" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "assistant_chat_todos"
  ADD CONSTRAINT "assistant_chat_todos_parent_id_fkey"
  FOREIGN KEY ("parent_id")
  REFERENCES "assistant_chat_todos" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
