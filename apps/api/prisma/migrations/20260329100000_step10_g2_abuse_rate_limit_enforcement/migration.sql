CREATE TYPE "abuse_surface" AS ENUM ('web_chat', 'telegram', 'whatsapp', 'max');

CREATE TABLE "assistant_abuse_guard_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "surface" "abuse_surface" NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "slowed_until" TIMESTAMPTZ(6),
  "blocked_until" TIMESTAMPTZ(6),
  "block_reason" VARCHAR(255),
  "admin_override_until" TIMESTAMPTZ(6),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_abuse_guard_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_abuse_assistant_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "surface" "abuse_surface" NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "slowed_until" TIMESTAMPTZ(6),
  "blocked_until" TIMESTAMPTZ(6),
  "block_reason" VARCHAR(255),
  "admin_override_until" TIMESTAMPTZ(6),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_abuse_assistant_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_abuse_guard_states_assistant_id_user_id_surface_key"
  ON "assistant_abuse_guard_states" ("assistant_id", "user_id", "surface");

CREATE INDEX "assistant_abuse_guard_states_workspace_id_surface_blocked_until_idx"
  ON "assistant_abuse_guard_states" ("workspace_id", "surface", "blocked_until");

CREATE UNIQUE INDEX "assistant_abuse_assistant_states_assistant_id_surface_key"
  ON "assistant_abuse_assistant_states" ("assistant_id", "surface");

CREATE INDEX "assistant_abuse_assistant_states_surface_blocked_until_idx"
  ON "assistant_abuse_assistant_states" ("surface", "blocked_until");

ALTER TABLE "assistant_abuse_guard_states"
  ADD CONSTRAINT "assistant_abuse_guard_states_assistant_id_user_id_fkey"
  FOREIGN KEY ("assistant_id", "user_id")
  REFERENCES "assistants"("id", "user_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "assistant_abuse_guard_states"
  ADD CONSTRAINT "assistant_abuse_guard_states_workspace_id_user_id_fkey"
  FOREIGN KEY ("workspace_id", "user_id")
  REFERENCES "workspace_members"("workspace_id", "user_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "assistant_abuse_guard_states"
  ADD CONSTRAINT "assistant_abuse_guard_states_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "app_users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "assistant_abuse_guard_states"
  ADD CONSTRAINT "assistant_abuse_guard_states_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "assistant_abuse_assistant_states"
  ADD CONSTRAINT "assistant_abuse_assistant_states_assistant_id_fkey"
  FOREIGN KEY ("assistant_id")
  REFERENCES "assistants"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
