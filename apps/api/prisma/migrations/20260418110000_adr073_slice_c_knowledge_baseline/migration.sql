ALTER TABLE "assistant_knowledge_source_chunks"
ADD COLUMN "embedding_model_key" VARCHAR(255),
ADD COLUMN "embedding_vector" JSONB,
ADD COLUMN "embedding_generated_at" TIMESTAMPTZ(6);

CREATE TYPE "GlobalKnowledgeSourceScope" AS ENUM ('product', 'skill');

CREATE TABLE "global_knowledge_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "scope" "GlobalKnowledgeSourceScope" NOT NULL,
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
  CONSTRAINT "global_knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "global_knowledge_source_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "global_knowledge_source_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "scope" "GlobalKnowledgeSourceScope" NOT NULL,
  "source_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "locator" TEXT,
  "content" TEXT NOT NULL,
  "embedding_model_key" VARCHAR(255),
  "embedding_vector" JSONB,
  "embedding_generated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "global_knowledge_source_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "global_knowledge_sources_scope_created_at_idx"
  ON "global_knowledge_sources" ("scope", "created_at" DESC);

CREATE INDEX "global_knowledge_sources_status_created_at_idx"
  ON "global_knowledge_sources" ("status", "created_at" DESC);

CREATE INDEX "global_knowledge_sources_workspace_id_scope_created_at_idx"
  ON "global_knowledge_sources" ("workspace_id", "scope", "created_at" DESC);

CREATE UNIQUE INDEX "global_knowledge_source_chunks_source_id_source_version_chunk_index_key"
  ON "global_knowledge_source_chunks" ("global_knowledge_source_id", "source_version", "chunk_index");

CREATE INDEX "global_knowledge_source_chunks_source_id_created_at_idx"
  ON "global_knowledge_source_chunks" ("global_knowledge_source_id", "created_at" DESC);

CREATE INDEX "global_knowledge_source_chunks_scope_created_at_idx"
  ON "global_knowledge_source_chunks" ("scope", "created_at" DESC);

CREATE INDEX "global_knowledge_source_chunks_workspace_id_scope_created_at_idx"
  ON "global_knowledge_source_chunks" ("workspace_id", "scope", "created_at" DESC);

ALTER TABLE "global_knowledge_sources"
ADD CONSTRAINT "global_knowledge_sources_workspace_id_fkey"
FOREIGN KEY ("workspace_id")
REFERENCES "workspaces"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "global_knowledge_sources"
ADD CONSTRAINT "global_knowledge_sources_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id")
REFERENCES "app_users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "global_knowledge_source_chunks"
ADD CONSTRAINT "global_knowledge_source_chunks_source_id_fkey"
FOREIGN KEY ("global_knowledge_source_id")
REFERENCES "global_knowledge_sources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "global_knowledge_source_chunks"
ADD CONSTRAINT "global_knowledge_source_chunks_workspace_id_fkey"
FOREIGN KEY ("workspace_id")
REFERENCES "workspaces"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
