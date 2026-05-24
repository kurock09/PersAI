-- ADR-100 Piece 1: add optional JSONB metadata column to assistant_chat_messages
-- so the runtime can persist discoveredFileRefIds (canonical AssistantFile ids
-- seen via files.list/search/get/read in a turn's tool loop) on the assistant
-- message row. Future hydration reads the last K messages' metadata to surface
-- those files as "recent file #N" aliases in Working Files.
ALTER TABLE "assistant_chat_messages" ADD COLUMN "metadata" JSONB;
