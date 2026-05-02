CREATE TYPE "KnowledgeAuthoringLifecycleStatus" AS ENUM ('draft', 'active', 'stale', 'archived');
CREATE TYPE "KnowledgeAuthoringProvenanceKind" AS ENUM ('manual', 'assistant_generated', 'document_summary', 'imported');

ALTER TYPE "KnowledgeIndexingJobSourceType" ADD VALUE 'skill_knowledge_card';
ALTER TYPE "KnowledgeIndexingJobSourceType" ADD VALUE 'product_knowledge_text_entry';
ALTER TYPE "KnowledgeVectorSourceType" ADD VALUE 'skill_knowledge_card';
ALTER TYPE "KnowledgeVectorSourceType" ADD VALUE 'product_knowledge_text_entry';

CREATE TABLE "product_knowledge_text_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "title" VARCHAR(255) NOT NULL,
  "body" TEXT NOT NULL,
  "category" VARCHAR(128),
  "locale" VARCHAR(16),
  "tags" JSONB NOT NULL DEFAULT '[]',
  "lifecycle_status" "KnowledgeAuthoringLifecycleStatus" NOT NULL DEFAULT 'draft',
  "status" "AssistantKnowledgeSourceStatus" NOT NULL DEFAULT 'processing',
  "provenance_kind" "KnowledgeAuthoringProvenanceKind" NOT NULL DEFAULT 'manual',
  "provenance_metadata" JSONB,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "processor_provider_key" VARCHAR(64),
  "processor_mode" "KnowledgeIndexingJobProcessorMode",
  "processing_quality" JSONB,
  "last_indexed_at" TIMESTAMPTZ(6),
  "last_reindex_requested_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_knowledge_text_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_knowledge_text_entry_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "text_entry_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "locator" TEXT,
  "content" TEXT NOT NULL,
  "embedding_model_key" VARCHAR(255),
  "embedding_vector" JSONB,
  "embedding_generated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_knowledge_text_entry_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_knowledge_cards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "skill_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "title" VARCHAR(255) NOT NULL,
  "body" TEXT NOT NULL,
  "locale" VARCHAR(16),
  "tags" JSONB NOT NULL DEFAULT '[]',
  "lifecycle_status" "KnowledgeAuthoringLifecycleStatus" NOT NULL DEFAULT 'draft',
  "status" "AssistantKnowledgeSourceStatus" NOT NULL DEFAULT 'processing',
  "provenance_kind" "KnowledgeAuthoringProvenanceKind" NOT NULL DEFAULT 'manual',
  "provenance_metadata" JSONB,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "processor_provider_key" VARCHAR(64),
  "processor_mode" "KnowledgeIndexingJobProcessorMode",
  "processing_quality" JSONB,
  "last_indexed_at" TIMESTAMPTZ(6),
  "last_reindex_requested_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_knowledge_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_knowledge_card_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "skill_knowledge_card_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "locator" TEXT,
  "content" TEXT NOT NULL,
  "embedding_model_key" VARCHAR(255),
  "embedding_generated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_knowledge_card_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_knowledge_text_entry_chunks_text_entry_id_source_ver_key"
  ON "product_knowledge_text_entry_chunks"("text_entry_id", "source_version", "chunk_index");
CREATE INDEX "product_knowledge_text_entries_workspace_id_lifecycle_created_idx"
  ON "product_knowledge_text_entries"("workspace_id", "lifecycle_status", "created_at" DESC);
CREATE INDEX "product_knowledge_text_entries_workspace_id_status_created_idx"
  ON "product_knowledge_text_entries"("workspace_id", "status", "created_at" DESC);
CREATE INDEX "product_knowledge_text_entries_created_by_user_id_created_at_idx"
  ON "product_knowledge_text_entries"("created_by_user_id", "created_at" DESC);
CREATE INDEX "product_knowledge_text_entry_chunks_text_entry_id_created_at_idx"
  ON "product_knowledge_text_entry_chunks"("text_entry_id", "created_at" DESC);
CREATE INDEX "product_knowledge_text_entry_chunks_workspace_id_created_at_idx"
  ON "product_knowledge_text_entry_chunks"("workspace_id", "created_at" DESC);

CREATE UNIQUE INDEX "skill_knowledge_card_chunks_card_id_source_version_chunk_key"
  ON "skill_knowledge_card_chunks"("skill_knowledge_card_id", "source_version", "chunk_index");
CREATE INDEX "skill_knowledge_cards_skill_id_lifecycle_created_at_idx"
  ON "skill_knowledge_cards"("skill_id", "lifecycle_status", "created_at" DESC);
CREATE INDEX "skill_knowledge_cards_workspace_id_lifecycle_created_at_idx"
  ON "skill_knowledge_cards"("workspace_id", "lifecycle_status", "created_at" DESC);
CREATE INDEX "skill_knowledge_cards_workspace_id_status_created_at_idx"
  ON "skill_knowledge_cards"("workspace_id", "status", "created_at" DESC);
CREATE INDEX "skill_knowledge_cards_created_by_user_id_created_at_idx"
  ON "skill_knowledge_cards"("created_by_user_id", "created_at" DESC);
CREATE INDEX "skill_knowledge_card_chunks_skill_id_created_at_idx"
  ON "skill_knowledge_card_chunks"("skill_id", "created_at" DESC);
CREATE INDEX "skill_knowledge_card_chunks_workspace_id_skill_id_created_at_idx"
  ON "skill_knowledge_card_chunks"("workspace_id", "skill_id", "created_at" DESC);

ALTER TABLE "product_knowledge_text_entries"
  ADD CONSTRAINT "product_knowledge_text_entries_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_knowledge_text_entries"
  ADD CONSTRAINT "product_knowledge_text_entries_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_knowledge_text_entries"
  ADD CONSTRAINT "product_knowledge_text_entries_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_knowledge_text_entry_chunks"
  ADD CONSTRAINT "product_knowledge_text_entry_chunks_text_entry_id_fkey"
  FOREIGN KEY ("text_entry_id") REFERENCES "product_knowledge_text_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_knowledge_text_entry_chunks"
  ADD CONSTRAINT "product_knowledge_text_entry_chunks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_knowledge_cards"
  ADD CONSTRAINT "skill_knowledge_cards_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_knowledge_cards"
  ADD CONSTRAINT "skill_knowledge_cards_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "skill_knowledge_cards"
  ADD CONSTRAINT "skill_knowledge_cards_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "skill_knowledge_cards"
  ADD CONSTRAINT "skill_knowledge_cards_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "skill_knowledge_card_chunks"
  ADD CONSTRAINT "skill_knowledge_card_chunks_card_id_fkey"
  FOREIGN KEY ("skill_knowledge_card_id") REFERENCES "skill_knowledge_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_knowledge_card_chunks"
  ADD CONSTRAINT "skill_knowledge_card_chunks_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_knowledge_card_chunks"
  ADD CONSTRAINT "skill_knowledge_card_chunks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
