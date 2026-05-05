ALTER TABLE "assistant_chats"
  ADD COLUMN "skill_decision_state" JSONB,
  ADD COLUMN "skill_cadence_state" JSONB;

UPDATE "assistant_chats"
SET
  "skill_decision_state" = jsonb_build_object(
    'status',
    COALESCE("auto_skill_routing_state"->>'status', 'inactive'),
    'activeSkillId',
    CASE
      WHEN COALESCE("auto_skill_routing_state"->>'status', 'inactive') = 'active'
        THEN COALESCE("auto_skill_routing_state"->'activeSkillId', 'null'::jsonb)
      ELSE 'null'::jsonb
    END,
    'activeSkillName',
    CASE
      WHEN COALESCE("auto_skill_routing_state"->>'status', 'inactive') = 'active'
        THEN COALESCE("auto_skill_routing_state"->'activeSkillName', 'null'::jsonb)
      ELSE 'null'::jsonb
    END,
    'topicSummary',
    COALESCE("auto_skill_routing_state"->'topicSummary', 'null'::jsonb),
    'confidence',
    COALESCE("auto_skill_routing_state"->>'confidence', 'low'),
    'checkedAtMessageIndex',
    COALESCE(("auto_skill_routing_state"->>'checkedAtMessageIndex')::integer, 0)
  ),
  "skill_cadence_state" = jsonb_build_object(
    'messageCountSinceCheck',
    COALESCE(("auto_skill_routing_state"->>'messageCountSinceCheck')::integer, 0),
    'backgroundCheckQueuedAtMessageIndex',
    COALESCE("auto_skill_routing_state"->'backgroundCheckQueuedAtMessageIndex', 'null'::jsonb),
    'needsBootstrap',
    false,
    'bootstrapReason',
    'null'::jsonb
  )
WHERE "auto_skill_routing_state" IS NOT NULL;

UPDATE "assistant_chats" AS c
SET
  "skill_decision_state" = jsonb_build_object(
    'status', 'inactive',
    'activeSkillId', 'null'::jsonb,
    'activeSkillName', 'null'::jsonb,
    'topicSummary', 'null'::jsonb,
    'confidence', 'low',
    'checkedAtMessageIndex', 0
  ),
  "skill_cadence_state" = jsonb_build_object(
    'messageCountSinceCheck', 0,
    'backgroundCheckQueuedAtMessageIndex', 'null'::jsonb,
    'needsBootstrap', true,
    'bootstrapReason', 'migration_repair'
  )
WHERE c."auto_skill_routing_state" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "assistant_skill_assignments" AS a
    WHERE a."assistant_id" = c."assistant_id"
      AND a."status" = 'active'
  );

ALTER TABLE "assistant_chats"
  DROP COLUMN "auto_skill_routing_state";
