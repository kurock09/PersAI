CREATE TABLE "assistant_abuse_peer_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "surface" "abuse_surface" NOT NULL,
  "peer_key" TEXT NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "admin_override_until" TIMESTAMPTZ(6),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_abuse_peer_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_abuse_peer_states_assistant_id_surface_peer_key_key"
  ON "assistant_abuse_peer_states" ("assistant_id", "surface", "peer_key");

CREATE INDEX "assistant_abuse_peer_states_assistant_id_surface_last_seen_at_idx"
  ON "assistant_abuse_peer_states" ("assistant_id", "surface", "last_seen_at");

ALTER TABLE "assistant_abuse_peer_states"
  ADD CONSTRAINT "assistant_abuse_peer_states_assistant_id_fkey"
  FOREIGN KEY ("assistant_id")
  REFERENCES "assistants"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
