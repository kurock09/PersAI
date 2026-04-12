-- Step 13 M1: Media attachments foundation
-- ADR-059: Systemic media, attachments, and voice support

-- Enums
CREATE TYPE "attachment_type" AS ENUM ('image', 'audio', 'voice', 'video', 'document', 'tool_output');
CREATE TYPE "attachment_processing_status" AS ENUM ('pending', 'ready', 'failed');

-- Extend quota dimension enum
ALTER TYPE "WorkspaceQuotaDimension" ADD VALUE 'media_storage_bytes';

-- Attachments table
CREATE TABLE "assistant_chat_message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "assistant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "attachment_type" "attachment_type" NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "original_filename" VARCHAR(255),
    "mime_type" VARCHAR(128) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "duration_ms" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "processing_status" "attachment_processing_status" NOT NULL DEFAULT 'ready',
    "transcription" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_chat_message_attachments_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "assistant_chat_message_attachments_message_id_idx" ON "assistant_chat_message_attachments"("message_id");
CREATE INDEX "assistant_chat_message_attachments_chat_id_idx" ON "assistant_chat_message_attachments"("chat_id");
CREATE INDEX "assistant_chat_message_attachments_assistant_id_idx" ON "assistant_chat_message_attachments"("assistant_id");
CREATE INDEX "assistant_chat_message_attachments_workspace_id_created_at_idx" ON "assistant_chat_message_attachments"("workspace_id", "created_at" DESC);

-- Foreign keys
ALTER TABLE "assistant_chat_message_attachments" ADD CONSTRAINT "assistant_chat_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_chat_message_attachments" ADD CONSTRAINT "assistant_chat_message_attachments_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_chat_message_attachments" ADD CONSTRAINT "assistant_chat_message_attachments_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assistant_chat_message_attachments" ADD CONSTRAINT "assistant_chat_message_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend quota accounting state with media storage columns
ALTER TABLE "workspace_quota_accounting_state" ADD COLUMN "media_storage_bytes_used" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "workspace_quota_accounting_state" ADD COLUMN "media_storage_bytes_limit" BIGINT;

-- Extend plan catalog entitlements with media classes
ALTER TABLE "plan_catalog_entitlements" ADD COLUMN "media_classes" JSONB NOT NULL DEFAULT '[]';
