CREATE TYPE "ScriptStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "ScriptVersionStatus" AS ENUM ('draft', 'published');

CREATE TABLE "scripts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(64) NOT NULL,
  "name" JSONB NOT NULL,
  "description" JSONB NOT NULL,
  "status" "ScriptStatus" NOT NULL DEFAULT 'draft',
  "category" VARCHAR(64) NOT NULL,
  "icon" VARCHAR(64),
  "color" VARCHAR(32),
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "current_published_version_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "scripts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scripts_key_key" UNIQUE ("key"),
  CONSTRAINT "scripts_current_published_version_id_key" UNIQUE ("current_published_version_id")
);

CREATE TABLE "script_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "script_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ScriptVersionStatus" NOT NULL DEFAULT 'draft',
  "code" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "input_schema" JSONB NOT NULL,
  "output_schema" JSONB NOT NULL,
  "runtime" VARCHAR(64) NOT NULL,
  "entry_command" TEXT NOT NULL,
  "limits" JSONB NOT NULL,
  "content_hash" VARCHAR(64),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "published_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "published_at" TIMESTAMPTZ(6),
  CONSTRAINT "script_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "script_versions_script_id_version_key" UNIQUE ("script_id", "version"),
  CONSTRAINT "script_versions_version_positive" CHECK ("version" > 0),
  CONSTRAINT "script_versions_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "script_versions_publish_shape" CHECK (
    ("status" = 'draft' AND "content_hash" IS NULL AND "published_at" IS NULL AND "published_by_user_id" IS NULL)
    OR
    ("status" = 'published' AND "content_hash" IS NOT NULL AND "published_at" IS NOT NULL AND "published_by_user_id" IS NOT NULL)
  )
);

CREATE TABLE "skill_scripts" (
  "skill_id" UUID NOT NULL,
  "script_id" UUID NOT NULL,
  "display_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_scripts_pkey" PRIMARY KEY ("skill_id", "script_id"),
  CONSTRAINT "skill_scripts_display_order_nonnegative" CHECK ("display_order" >= 0)
);

ALTER TABLE "sandbox_jobs"
  ADD COLUMN "script_version_id" UUID,
  ADD COLUMN "script_invocation_key" VARCHAR(128);

CREATE UNIQUE INDEX "script_versions_one_draft_per_script"
  ON "script_versions" ("script_id")
  WHERE "status" = 'draft';
CREATE INDEX "scripts_status_display_order_idx" ON "scripts" ("status", "display_order");
CREATE INDEX "scripts_category_status_idx" ON "scripts" ("category", "status");
CREATE INDEX "script_versions_script_id_status_idx" ON "script_versions" ("script_id", "status");
CREATE INDEX "skill_scripts_skill_id_display_order_idx" ON "skill_scripts" ("skill_id", "display_order");
CREATE INDEX "skill_scripts_script_id_idx" ON "skill_scripts" ("script_id");
CREATE UNIQUE INDEX "sandbox_jobs_assistant_id_script_invocation_key_key"
  ON "sandbox_jobs" ("assistant_id", "script_invocation_key");
CREATE INDEX "sandbox_jobs_script_version_id_idx" ON "sandbox_jobs" ("script_version_id");

ALTER TABLE "scripts"
  ADD CONSTRAINT "scripts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "scripts_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "script_versions"
  ADD CONSTRAINT "script_versions_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "script_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "script_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scripts"
  ADD CONSTRAINT "scripts_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "script_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "skill_scripts"
  ADD CONSTRAINT "skill_scripts_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "skill_scripts_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sandbox_jobs"
  ADD CONSTRAINT "sandbox_jobs_script_version_id_fkey" FOREIGN KEY ("script_version_id") REFERENCES "script_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_script_key_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."key" IS DISTINCT FROM OLD."key" THEN
    RAISE EXCEPTION 'script_key_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "scripts_key_immutable"
  BEFORE UPDATE ON "scripts"
  FOR EACH ROW EXECUTE FUNCTION prevent_script_key_update();

CREATE FUNCTION prevent_published_script_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'published' THEN
      RAISE EXCEPTION 'published_script_version_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'published' THEN
    RAISE EXCEPTION 'published_script_version_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "script_versions_published_immutable"
  BEFORE UPDATE OR DELETE ON "script_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_published_script_version_mutation();

CREATE FUNCTION validate_script_current_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'published' AND NEW."current_published_version_id" IS NULL THEN
    RAISE EXCEPTION 'published_script_requires_current_version' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'draft' AND NEW."current_published_version_id" IS NOT NULL THEN
    RAISE EXCEPTION 'draft_script_cannot_have_current_version' USING ERRCODE = '23514';
  END IF;
  IF NEW."current_published_version_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "script_versions" v
    WHERE v."id" = NEW."current_published_version_id"
      AND v."script_id" = NEW."id"
      AND v."status" = 'published'
  ) THEN
    RAISE EXCEPTION 'script_current_version_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "scripts_current_published_version_valid"
  AFTER INSERT OR UPDATE OF "current_published_version_id", "status" ON "scripts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_script_current_published_version();
