-- ADR-126 v3 Wave 1 — drop assistant_files identity; path-based attachments + workspace_file_metadata.
--
-- The 'unavailable' enum value is added in the prior migration
-- (20260623225000_adr126_v3_add_unavailable_enum) so that this migration can
-- safely UPDATE rows to it. Postgres 55P04 forbids using a freshly-added enum
-- label inside the same transaction it was added in.

-- --------------------------------------------------------------------------
-- 1. Drop assistant_files satellite tables (FK order).
-- --------------------------------------------------------------------------

DROP TABLE IF EXISTS "assistant_upload_micro_description_jobs" CASCADE;
DROP TABLE IF EXISTS "assistant_document_delivered_files" CASCADE;
DROP TABLE IF EXISTS "assistant_file_media_derivatives" CASCADE;

-- --------------------------------------------------------------------------
-- 2. Repurpose assistant_chat_message_attachments.storage_path for FS paths.
-- --------------------------------------------------------------------------

ALTER TABLE "assistant_chat_message_attachments" DROP COLUMN IF EXISTS "assistant_file_id";

ALTER TABLE "assistant_chat_message_attachments" ALTER COLUMN "storage_path" DROP NOT NULL;

UPDATE "assistant_chat_message_attachments"
SET "storage_path" = NULL,
    "processing_status" = 'unavailable'
WHERE "storage_path" LIKE 'assistant-media/%';

-- --------------------------------------------------------------------------
-- 3. Drop assistant_files registry and retired enums.
-- --------------------------------------------------------------------------

DROP TABLE IF EXISTS "assistant_files" CASCADE;

DROP TYPE IF EXISTS "sandbox_file_origin";
DROP TYPE IF EXISTS "AssistantUploadMicroDescriptionJobStatus";

-- --------------------------------------------------------------------------
-- 4. workspace_file_metadata — path-keyed manifest cache (ADR-126 v3 D11).
-- --------------------------------------------------------------------------

CREATE TABLE "workspace_file_metadata" (
    "workspace_id" UUID NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "content_hash" VARCHAR(128),
    "short_description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_file_metadata_pkey" PRIMARY KEY ("workspace_id", "path")
);

CREATE INDEX "workspace_file_metadata_workspace_id_created_at_idx"
ON "workspace_file_metadata"("workspace_id", "created_at" DESC);

ALTER TABLE "workspace_file_metadata"
ADD CONSTRAINT "workspace_file_metadata_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
