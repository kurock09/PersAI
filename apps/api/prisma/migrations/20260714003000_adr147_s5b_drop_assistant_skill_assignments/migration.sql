-- ADR-147 S5b Release C — contract/drop.
--
-- Ordered, idempotent cleanup:
--   1) Remove persisted plan Skill-limit JSON vocabulary.
--   2) DROP TABLE IF EXISTS assistant_skill_assignments.
--   3) DROP TYPE IF EXISTS AssistantSkillAssignmentStatus.
--
-- Historical create/read migrations are immutable and are not rewritten.
-- Safe to re-run: JSON UPDATE WHERE clauses only touch residual keys;
-- DROP IF EXISTS is idempotent.

-- 1a) plan_catalog_plans.billing_provider_hints: remove top-level skillPolicy.
UPDATE "plan_catalog_plans"
SET "billing_provider_hints" = "billing_provider_hints" - 'skillPolicy'
WHERE "billing_provider_hints" IS NOT NULL
  AND jsonb_typeof("billing_provider_hints") = 'object'
  AND "billing_provider_hints" ? 'skillPolicy';

-- 1b) plan_catalog_entitlements.limits_permissions: remove exact Skill-limit
--     entries while preserving order and all unrelated entries. Never null the
--     array (empty residual filter yields [] via COALESCE).
UPDATE "plan_catalog_entitlements"
SET "limits_permissions" = COALESCE(
  (
    SELECT jsonb_agg(elem ORDER BY ord)
    FROM jsonb_array_elements("limits_permissions") WITH ORDINALITY AS t(elem, ord)
    WHERE NOT (
      jsonb_typeof(elem) = 'object'
      AND elem ? 'key'
      AND (elem ->> 'key') IN (
        'enabled_skills_limit',
        'max_enabled_skills',
        'skill_assignments_limit'
      )
    )
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("limits_permissions") = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("limits_permissions") AS elem
    WHERE jsonb_typeof(elem) = 'object'
      AND elem ? 'key'
      AND (elem ->> 'key') IN (
        'enabled_skills_limit',
        'max_enabled_skills',
        'skill_assignments_limit'
      )
  );

-- 2) Physical assignment storage.
DROP TABLE IF EXISTS "assistant_skill_assignments";

-- 3) Assignment status enum (only after the table that used it is gone).
DROP TYPE IF EXISTS "AssistantSkillAssignmentStatus";
