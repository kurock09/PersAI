-- ADR-129 hard cutover: deferred document jobs are presentation-only.
--
-- The runtime worker only serves Gamma presentations. Non-presentation document
-- work runs through the visible workspace workflow (document.extract,
-- document.render, document.inspect, document.register_version, files.attach),
-- which still uses assistant_documents/assistant_document_versions to track
-- visible documents but never enqueues a render job.
--
-- This migration:
-- 1. Purges historical non-presentation render jobs and provider mappings (no
--    commercial users yet).
-- 2. Drops the dead PDF-structure columns on assistant_document_versions —
--    rendered_html, structure_json, style_profile_json, edit_strategy,
--    structure_version were only populated by the retired PDF worker path.
-- 3. Shrinks AssistantDocumentRenderProvider to gamma only and
--    AssistantDocumentOutputFormat to pdf/pptx only — both enums are
--    referenced only by the deferred render-job tables.
-- AssistantDocumentType and AssistantDocumentDescriptorMode are intentionally
-- left at their full set so the visible workspace workflow can still register
-- non-presentation document versions (the visible workflow never queues a
-- gamma render job).

BEGIN;

-- 1. Purge historical non-gamma render jobs and provider mappings.
DELETE FROM "assistant_document_render_jobs"
WHERE "provider" <> 'gamma'
   OR "output_format" NOT IN ('pdf', 'pptx');

DELETE FROM "assistant_document_provider_mappings"
WHERE "provider" <> 'gamma';

-- 2. Drop dead PDF-structure columns on assistant_document_versions.
ALTER TABLE "assistant_document_versions" DROP COLUMN IF EXISTS "rendered_html";
ALTER TABLE "assistant_document_versions" DROP COLUMN IF EXISTS "structure_json";
ALTER TABLE "assistant_document_versions" DROP COLUMN IF EXISTS "style_profile_json";
ALTER TABLE "assistant_document_versions" DROP COLUMN IF EXISTS "edit_strategy";
ALTER TABLE "assistant_document_versions" DROP COLUMN IF EXISTS "structure_version";

-- 3. Shrink AssistantDocumentRenderProvider to gamma only.
CREATE TYPE "AssistantDocumentRenderProvider_new" AS ENUM ('gamma');
ALTER TABLE "assistant_document_render_jobs"
  ALTER COLUMN "provider" TYPE "AssistantDocumentRenderProvider_new"
    USING ("provider"::text::"AssistantDocumentRenderProvider_new");
ALTER TABLE "assistant_document_provider_mappings"
  ALTER COLUMN "provider" TYPE "AssistantDocumentRenderProvider_new"
    USING ("provider"::text::"AssistantDocumentRenderProvider_new");
DROP TYPE "AssistantDocumentRenderProvider";
ALTER TYPE "AssistantDocumentRenderProvider_new" RENAME TO "AssistantDocumentRenderProvider";

-- 4. Shrink AssistantDocumentOutputFormat to pdf/pptx only.
CREATE TYPE "AssistantDocumentOutputFormat_new" AS ENUM ('pdf', 'pptx');
ALTER TABLE "assistant_document_render_jobs"
  ALTER COLUMN "output_format" TYPE "AssistantDocumentOutputFormat_new"
    USING ("output_format"::text::"AssistantDocumentOutputFormat_new");
DROP TYPE "AssistantDocumentOutputFormat";
ALTER TYPE "AssistantDocumentOutputFormat_new" RENAME TO "AssistantDocumentOutputFormat";

COMMIT;
