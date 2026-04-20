-- ADR-074 V1 (Voice DNA Scaffold) — persona archetypes foundation.
--
-- Adds:
--   * `persona_archetypes` table — editable Voice DNA archetype rows seeded
--     from `apps/api/prisma/persona-archetype-data.ts`. Admins edit these
--     through the admin console at `/admin/presets`. Subsequent deploys keep
--     manual edits intact (the seeder uses an insert-only upsert).
--   * `assistants.draft_archetype_key` — which archetype the draft uses.
--   * `assistant_published_versions.snapshot_archetype_key` /
--     `snapshot_voice_dna` — point-in-time copies so previously published
--     versions stay stable when an admin later edits the source archetype.

CREATE TABLE "persona_archetypes" (
  "key"               VARCHAR(64)              PRIMARY KEY,
  "display_order"     INTEGER                  NOT NULL DEFAULT 100,
  "label"             JSONB                    NOT NULL,
  "description"       JSONB                    NOT NULL,
  "voice"             JSONB                    NOT NULL,
  "openings_allowed"  JSONB                    NOT NULL,
  "openings_forbidden" JSONB                   NOT NULL,
  "behaviors"         JSONB                    NOT NULL,
  "silence_rule"      JSONB                    NOT NULL,
  "examples"          JSONB                    NOT NULL,
  "default_traits"    JSONB                    NOT NULL,
  "created_at"        TIMESTAMPTZ(6)           NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ(6)           NOT NULL DEFAULT NOW()
);

CREATE INDEX "persona_archetypes_display_order_idx"
  ON "persona_archetypes" ("display_order");

ALTER TABLE "assistants"
  ADD COLUMN "draft_archetype_key" VARCHAR(64);

ALTER TABLE "assistant_published_versions"
  ADD COLUMN "snapshot_archetype_key" VARCHAR(64),
  ADD COLUMN "snapshot_voice_dna"     JSONB;
