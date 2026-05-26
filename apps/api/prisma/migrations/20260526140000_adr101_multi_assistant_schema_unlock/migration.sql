-- ADR-101 Slice 1: unlock one workspace member owning multiple assistants.

ALTER TABLE "workspace_members"
ADD COLUMN "active_assistant_id" UUID;

UPDATE "workspace_members" AS wm
SET "active_assistant_id" = a."id"
FROM "assistants" AS a
WHERE a."workspace_id" = wm."workspace_id"
  AND a."user_id" = wm."user_id"
  AND wm."active_assistant_id" IS NULL;

DROP INDEX IF EXISTS "assistants_user_id_key";
DROP INDEX IF EXISTS "assistants_workspace_id_user_id_key";

CREATE UNIQUE INDEX "assistants_id_workspace_id_key" ON "assistants"("id", "workspace_id");
CREATE INDEX "assistants_user_id_idx" ON "assistants"("user_id");
CREATE INDEX "assistants_workspace_id_idx" ON "assistants"("workspace_id");
CREATE INDEX "assistants_workspace_id_user_id_idx" ON "assistants"("workspace_id", "user_id");
CREATE INDEX "workspace_members_active_assistant_id_idx" ON "workspace_members"("active_assistant_id");

ALTER TABLE "workspace_members"
ADD CONSTRAINT "workspace_members_active_assistant_id_workspace_id_fkey"
FOREIGN KEY ("active_assistant_id", "workspace_id")
REFERENCES "assistants"("id", "workspace_id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

UPDATE "plan_catalog_plans"
SET "billing_provider_hints" = jsonb_set(
  COALESCE("billing_provider_hints", '{}'::jsonb),
  '{assistantPolicy}',
  '{"schema":"persai.assistantPolicy.v1","maxAssistants":1}'::jsonb,
  true
)
WHERE "billing_provider_hints" IS NULL
   OR NOT ("billing_provider_hints" ? 'assistantPolicy');
