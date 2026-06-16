-- Rollback: DROP TABLE "skill_scenarios"; DROP TYPE "SkillScenarioStatus";

CREATE TYPE "SkillScenarioStatus" AS ENUM ('draft', 'active', 'archived');

CREATE TABLE "skill_scenarios" (
    "id"               UUID                    NOT NULL DEFAULT gen_random_uuid(),
    "skill_id"         UUID                    NOT NULL,
    "key"              VARCHAR(64)             NOT NULL,
    "display_name"     JSONB                   NOT NULL,
    "description"      JSONB                   NOT NULL,
    "icon_emoji"       VARCHAR(16),
    "intent_examples"  JSONB                   NOT NULL DEFAULT '[]',
    "steps"            JSONB                   NOT NULL DEFAULT '[]',
    "recommended_tools" JSONB                  NOT NULL DEFAULT '[]',
    "exit_condition"   TEXT                    NOT NULL,
    "status"           "SkillScenarioStatus"   NOT NULL DEFAULT 'draft',
    "display_order"    INTEGER                 NOT NULL DEFAULT 100,
    "created_at"       TIMESTAMPTZ(6)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6)          NOT NULL,

    CONSTRAINT "skill_scenarios_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "skill_scenarios"
    ADD CONSTRAINT "skill_scenarios_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "skill_scenarios_skill_id_key_key"
    ON "skill_scenarios"("skill_id", "key");

CREATE INDEX "skill_scenarios_skill_id_status_display_order_idx"
    ON "skill_scenarios"("skill_id", "status", "display_order");
