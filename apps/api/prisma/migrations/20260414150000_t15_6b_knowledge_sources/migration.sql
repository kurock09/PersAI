ALTER TYPE "WorkspaceQuotaDimension" ADD VALUE IF NOT EXISTS 'knowledge_storage_bytes';

CREATE TYPE "AssistantKnowledgeSourceNamespace" AS ENUM ('assistant_user_workspace');
CREATE TYPE "AssistantKnowledgeSourceKind" AS ENUM ('uploaded_file');
CREATE TYPE "AssistantKnowledgeSourceStatus" AS ENUM ('processing', 'ready', 'failed');

ALTER TABLE "workspace_quota_accounting_state"
ADD COLUMN "knowledge_storage_bytes_used" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "knowledge_storage_bytes_limit" BIGINT;

CREATE TABLE "assistant_knowledge_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "namespace" "AssistantKnowledgeSourceNamespace" NOT NULL,
  "source_kind" "AssistantKnowledgeSourceKind" NOT NULL,
  "display_name" VARCHAR(255),
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(255) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "status" "AssistantKnowledgeSourceStatus" NOT NULL,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "last_indexed_at" TIMESTAMPTZ(6),
  "last_reindex_requested_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_knowledge_source_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_source_id" UUID NOT NULL,
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "locator" TEXT,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_knowledge_source_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_knowledge_sources_assistant_id_created_at_idx"
  ON "assistant_knowledge_sources" ("assistant_id", "created_at" DESC);

CREATE INDEX "assistant_knowledge_sources_assistant_id_status_created_at_idx"
  ON "assistant_knowledge_sources" ("assistant_id", "status", "created_at" DESC);

CREATE INDEX "assistant_knowledge_sources_workspace_id_created_at_idx"
  ON "assistant_knowledge_sources" ("workspace_id", "created_at" DESC);

CREATE UNIQUE INDEX "assistant_knowledge_source_chunks_knowledge_source_id_source_version_chunk_index_key"
  ON "assistant_knowledge_source_chunks" ("knowledge_source_id", "source_version", "chunk_index");

CREATE INDEX "assistant_knowledge_source_chunks_knowledge_source_id_created_at_idx"
  ON "assistant_knowledge_source_chunks" ("knowledge_source_id", "created_at" DESC);

CREATE INDEX "assistant_knowledge_source_chunks_assistant_id_created_at_idx"
  ON "assistant_knowledge_source_chunks" ("assistant_id", "created_at" DESC);

ALTER TABLE "assistant_knowledge_sources"
ADD CONSTRAINT "assistant_knowledge_sources_assistant_id_user_id_fkey"
FOREIGN KEY ("assistant_id", "user_id")
REFERENCES "assistants"("id", "user_id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "assistant_knowledge_sources"
ADD CONSTRAINT "assistant_knowledge_sources_workspace_id_user_id_fkey"
FOREIGN KEY ("workspace_id", "user_id")
REFERENCES "workspace_members"("workspace_id", "user_id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "assistant_knowledge_sources"
ADD CONSTRAINT "assistant_knowledge_sources_workspace_id_fkey"
FOREIGN KEY ("workspace_id")
REFERENCES "workspaces"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "assistant_knowledge_source_chunks"
ADD CONSTRAINT "assistant_knowledge_source_chunks_knowledge_source_id_fkey"
FOREIGN KEY ("knowledge_source_id")
REFERENCES "assistant_knowledge_sources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "assistant_knowledge_source_chunks"
ADD CONSTRAINT "assistant_knowledge_source_chunks_assistant_id_fkey"
FOREIGN KEY ("assistant_id")
REFERENCES "assistants"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "assistant_knowledge_source_chunks"
ADD CONSTRAINT "assistant_knowledge_source_chunks_workspace_id_fkey"
FOREIGN KEY ("workspace_id")
REFERENCES "workspaces"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
