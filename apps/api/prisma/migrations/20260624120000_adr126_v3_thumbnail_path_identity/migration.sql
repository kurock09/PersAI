-- ADR-126 v3 Wave 4.5: path-identity thumbnail/poster metadata on attachments.
ALTER TABLE "assistant_chat_message_attachments"
  ADD COLUMN "thumbnail_storage_path" VARCHAR(1024),
  ADD COLUMN "poster_storage_path" VARCHAR(1024);
