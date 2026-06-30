-- ADR-129 W9 Slice 5 — persist chat/assistant origin on manifest rows for session-scoped gallery + Working Files tiers.
ALTER TABLE "workspace_file_metadata" ADD COLUMN "origin_chat_id" UUID;
ALTER TABLE "workspace_file_metadata" ADD COLUMN "origin_assistant_id" UUID;

CREATE INDEX "workspace_file_metadata_workspace_id_origin_chat_id_idx"
  ON "workspace_file_metadata"("workspace_id", "origin_chat_id");
