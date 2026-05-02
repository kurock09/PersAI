-- ADR-081 Slice 1: chat attachments are projections of canonical AssistantFile rows.

ALTER TABLE "assistant_chat_message_attachments"
ADD COLUMN IF NOT EXISTS "assistant_file_id" UUID;

INSERT INTO "assistant_files" (
  "assistant_id",
  "workspace_id",
  "sandbox_job_id",
  "origin",
  "source_tool_code",
  "object_key",
  "relative_path",
  "display_name",
  "mime_type",
  "size_bytes",
  "logical_size_bytes",
  "sha256",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT
  "assistant_id",
  "workspace_id",
  NULL,
  CASE WHEN "attachment_type" = 'tool_output' THEN 'runtime_output'::"sandbox_file_origin" ELSE 'uploaded_attachment'::"sandbox_file_origin" END,
  NULL,
  "storage_path",
  'attachments/' || "id",
  "original_filename",
  "mime_type",
  "size_bytes",
  "size_bytes",
  NULL,
  jsonb_build_object(
    'source', 'chat_attachment_backfill',
    'sourceAttachmentId', "id",
    'sourceMessageId', "message_id",
    'sourceChatId', "chat_id"
  ),
  "created_at",
  CURRENT_TIMESTAMP
FROM "assistant_chat_message_attachments"
WHERE "processing_status" = 'ready'
ON CONFLICT ("assistant_id", "workspace_id", "origin", "object_key") DO NOTHING;

UPDATE "assistant_chat_message_attachments" a
SET "assistant_file_id" = f."id"
FROM "assistant_files" f
WHERE a."assistant_file_id" IS NULL
  AND f."assistant_id" = a."assistant_id"
  AND f."workspace_id" = a."workspace_id"
  AND f."object_key" = a."storage_path"
  AND f."origin" = CASE WHEN a."attachment_type" = 'tool_output' THEN 'runtime_output'::"sandbox_file_origin" ELSE 'uploaded_attachment'::"sandbox_file_origin" END;

CREATE INDEX IF NOT EXISTS "assistant_chat_message_attachments_assistant_file_id_idx"
ON "assistant_chat_message_attachments"("assistant_file_id");

ALTER TABLE "assistant_chat_message_attachments"
ADD CONSTRAINT "assistant_chat_message_attachments_assistant_file_id_fkey"
FOREIGN KEY ("assistant_file_id") REFERENCES "assistant_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
