-- ADR-119 Slice 10: add first_step_preview column to skill_scenarios (nullable, optional override).
-- Existing rows backfill to NULL (auto-derive from steps[0].directive preserved by materializer).
ALTER TABLE "skill_scenarios" ADD COLUMN "first_step_preview" VARCHAR(200);
