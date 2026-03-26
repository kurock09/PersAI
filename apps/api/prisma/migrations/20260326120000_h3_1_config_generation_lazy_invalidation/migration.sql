-- H3.1: Config generation lazy invalidation (ADR-054)

-- 1. New singleton table for global config generation counter
CREATE TABLE "platform_config_generations" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'global',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_config_generations_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row
INSERT INTO "platform_config_generations" ("id", "generation")
VALUES ('global', 1)
ON CONFLICT ("id") DO NOTHING;

-- 2. Add config_dirty_at to assistants (per-user staleness tracking)
ALTER TABLE "assistants"
ADD COLUMN "config_dirty_at" TIMESTAMPTZ(6);

-- 3. Add materialized_at_config_generation to assistant_materialized_specs
ALTER TABLE "assistant_materialized_specs"
ADD COLUMN "materialized_at_config_generation" INTEGER NOT NULL DEFAULT 0;
