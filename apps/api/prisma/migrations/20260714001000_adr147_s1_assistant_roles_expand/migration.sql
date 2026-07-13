-- ADR-147 Slice S1: additive Assistant Role schema and safe expand.
-- Existing direct skill assignments remain intact; effective-skill behavior does
-- not change in this release.

CREATE TYPE "AssistantRoleStatus" AS ENUM ('draft', 'active', 'archived');

CREATE TABLE "assistant_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(64) NOT NULL,
  "name" JSONB NOT NULL,
  "description" JSONB NOT NULL,
  "mission" JSONB NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "icon_emoji" VARCHAR(16),
  "color" VARCHAR(32),
  "status" "AssistantRoleStatus" NOT NULL DEFAULT 'draft',
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_roles_key_key" ON "assistant_roles"("key");
CREATE INDEX "assistant_roles_status_display_order_idx"
  ON "assistant_roles"("status", "display_order");
CREATE INDEX "assistant_roles_category_status_idx"
  ON "assistant_roles"("category", "status");

CREATE TABLE "assistant_role_skills" (
  "role_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_role_skills_pkey" PRIMARY KEY ("role_id", "skill_id"),
  CONSTRAINT "assistant_role_skills_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "assistant_roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_role_skills_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assistant_role_skills_role_id_display_order_idx"
  ON "assistant_role_skills"("role_id", "display_order");
CREATE INDEX "assistant_role_skills_skill_id_display_order_idx"
  ON "assistant_role_skills"("skill_id", "display_order");

INSERT INTO "assistant_roles" (
  "id",
  "key",
  "name",
  "description",
  "mission",
  "category",
  "icon_emoji",
  "color",
  "status",
  "display_order"
) VALUES (
  '00000000-0000-4000-8000-000000000147',
  'persai_default',
  '{"ru":"Универсальный помощник","en":"Universal assistant"}'::jsonb,
  '{"ru":"Универсальная роль для повседневных вопросов и задач без профессиональной специализации.","en":"A general role for everyday questions and tasks without a professional specialization."}'::jsonb,
  '{"ru":"Помогай с повседневными вопросами и задачами, используя базовые возможности модели и доступные инструменты.","en":"Help with everyday questions and tasks using the model''s core capabilities and available tools."}'::jsonb,
  'general',
  NULL,
  NULL,
  'active',
  0
);

ALTER TABLE "assistants"
ADD COLUMN "role_id" UUID DEFAULT '00000000-0000-4000-8000-000000000147';

UPDATE "assistants"
SET "role_id" = '00000000-0000-4000-8000-000000000147'
WHERE "role_id" IS NULL;

ALTER TABLE "assistants"
ALTER COLUMN "role_id" SET NOT NULL;

ALTER TABLE "assistants"
ADD CONSTRAINT "assistants_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "assistant_roles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "assistants_role_id_idx" ON "assistants"("role_id");
