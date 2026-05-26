-- ADR-098 structured document version snapshots (additive)
ALTER TABLE "assistant_document_versions"
  ADD COLUMN IF NOT EXISTS "structure_json" JSONB,
  ADD COLUMN IF NOT EXISTS "style_profile_json" JSONB,
  ADD COLUMN IF NOT EXISTS "edit_strategy" TEXT,
  ADD COLUMN IF NOT EXISTS "structure_version" INTEGER;
