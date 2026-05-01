-- ADR-079 — first-class Skills, document-processing/indexing state, and
-- pgvector-backed knowledge vector storage foundation.
--
-- This migration is data-model only. Runtime/API/UI behavior lands in later
-- ADR-079 ledger steps.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TYPE "AssistantKnowledgeSourceStatus" ADD VALUE IF NOT EXISTS 'needs_review';

-- The old admin "Skill library" scope is not active product truth anymore.
-- There are no production users on this surface; dev data can be dropped.
DELETE FROM "global_knowledge_source_chunks" WHERE "scope" = 'skill';
DELETE FROM "global_knowledge_sources" WHERE "scope" = 'skill';

ALTER TYPE "GlobalKnowledgeSourceScope" RENAME TO "GlobalKnowledgeSourceScope_old";
CREATE TYPE "GlobalKnowledgeSourceScope" AS ENUM ('product');

ALTER TABLE "global_knowledge_sources"
  ALTER COLUMN "scope" TYPE "GlobalKnowledgeSourceScope"
  USING ("scope"::TEXT::"GlobalKnowledgeSourceScope");

ALTER TABLE "global_knowledge_source_chunks"
  ALTER COLUMN "scope" TYPE "GlobalKnowledgeSourceScope"
  USING ("scope"::TEXT::"GlobalKnowledgeSourceScope");

DROP TYPE "GlobalKnowledgeSourceScope_old";

CREATE TYPE "SkillStatus" AS ENUM ('draft', 'active', 'archived');

CREATE TYPE "AssistantSkillAssignmentStatus" AS ENUM (
  'active',
  'disabled',
  'archived',
  'plan_disabled'
);

CREATE TYPE "KnowledgeIndexingJobSourceType" AS ENUM (
  'assistant_knowledge_source',
  'global_knowledge_source',
  'skill_document'
);

CREATE TYPE "KnowledgeIndexingJobStatus" AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'failed',
  'needs_review',
  'cancelled'
);

CREATE TYPE "KnowledgeIndexingJobProcessorMode" AS ENUM (
  'auto',
  'local',
  'default_provider',
  'high_quality_fallback'
);

CREATE TYPE "KnowledgeVectorSourceType" AS ENUM (
  'assistant_knowledge_source',
  'global_knowledge_source',
  'skill_document'
);

ALTER TYPE "KnowledgeRetrievalEventSource" ADD VALUE IF NOT EXISTS 'product';
ALTER TYPE "KnowledgeRetrievalEventSource" ADD VALUE IF NOT EXISTS 'skill';
ALTER TYPE "KnowledgeRetrievalEventSource" ADD VALUE IF NOT EXISTS 'web';

ALTER TABLE "platform_runtime_provider_settings"
  ADD COLUMN "document_processing_policy" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "skills" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "status" "SkillStatus" NOT NULL DEFAULT 'draft',
  "name" JSONB NOT NULL,
  "description" JSONB NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "instruction_card" JSONB NOT NULL,
  "icon_emoji" VARCHAR(16),
  "color" VARCHAR(32),
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "skill_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "display_name" VARCHAR(255),
  "description" TEXT,
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(255) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "status" "AssistantKnowledgeSourceStatus" NOT NULL DEFAULT 'processing',
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "processor_provider_key" VARCHAR(64),
  "processor_mode" "KnowledgeIndexingJobProcessorMode",
  "processing_quality" JSONB,
  "last_indexed_at" TIMESTAMPTZ(6),
  "last_reindex_requested_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "skill_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_document_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "skill_document_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "locator" TEXT,
  "content" TEXT NOT NULL,
  "embedding_model_key" VARCHAR(255),
  "embedding_generated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_skill_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "status" "AssistantSkillAssignmentStatus" NOT NULL DEFAULT 'active',
  "disabled_reason" VARCHAR(128),
  "enabled_at" TIMESTAMPTZ(6),
  "disabled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "assistant_skill_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_indexing_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "assistant_id" UUID,
  "skill_id" UUID,
  "requested_by_user_id" UUID,
  "source_type" "KnowledgeIndexingJobSourceType" NOT NULL,
  "source_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL DEFAULT 1,
  "status" "KnowledgeIndexingJobStatus" NOT NULL DEFAULT 'pending',
  "processor_mode" "KnowledgeIndexingJobProcessorMode" NOT NULL DEFAULT 'auto',
  "selected_provider_key" VARCHAR(64),
  "fallback_provider_key" VARCHAR(64),
  "priority" INTEGER NOT NULL DEFAULT 100,
  "pending_dedupe_key" VARCHAR(256),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "retry_after_at" TIMESTAMPTZ(6),
  "scheduler_claim_token" VARCHAR(64),
  "scheduler_claim_epoch" INTEGER,
  "scheduler_claimed_at" TIMESTAMPTZ(6),
  "scheduler_claim_expires_at" TIMESTAMPTZ(6),
  "extraction_quality" JSONB,
  "result_payload" JSONB,
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "knowledge_indexing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_vector_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "assistant_id" UUID,
  "skill_id" UUID,
  "source_type" "KnowledgeVectorSourceType" NOT NULL,
  "source_id" UUID NOT NULL,
  "chunk_id" UUID,
  "source_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "embedding_model_key" VARCHAR(255) NOT NULL,
  "embedding_vector" vector NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "knowledge_vector_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "skills_workspace_status_order_idx"
  ON "skills" ("workspace_id", "status", "display_order");

CREATE INDEX "skills_workspace_category_status_idx"
  ON "skills" ("workspace_id", "category", "status");

CREATE INDEX "skills_created_by_created_idx"
  ON "skills" ("created_by_user_id", "created_at" DESC);

CREATE INDEX "skill_documents_skill_status_created_idx"
  ON "skill_documents" ("skill_id", "status", "created_at" DESC);

CREATE INDEX "skill_documents_workspace_status_created_idx"
  ON "skill_documents" ("workspace_id", "status", "created_at" DESC);

CREATE INDEX "skill_documents_created_by_created_idx"
  ON "skill_documents" ("created_by_user_id", "created_at" DESC);

CREATE UNIQUE INDEX "skill_document_chunks_doc_version_index_key"
  ON "skill_document_chunks" ("skill_document_id", "source_version", "chunk_index");

CREATE INDEX "skill_document_chunks_skill_created_idx"
  ON "skill_document_chunks" ("skill_id", "created_at" DESC);

CREATE INDEX "skill_document_chunks_workspace_skill_created_idx"
  ON "skill_document_chunks" ("workspace_id", "skill_id", "created_at" DESC);

CREATE UNIQUE INDEX "assistant_skill_assignments_assistant_skill_key"
  ON "assistant_skill_assignments" ("assistant_id", "skill_id");

CREATE INDEX "assistant_skill_assignments_assistant_status_updated_idx"
  ON "assistant_skill_assignments" ("assistant_id", "status", "updated_at" DESC);

CREATE INDEX "assistant_skill_assignments_workspace_skill_status_idx"
  ON "assistant_skill_assignments" ("workspace_id", "skill_id", "status");

CREATE UNIQUE INDEX "knowledge_indexing_jobs_pending_dedupe_key"
  ON "knowledge_indexing_jobs" ("pending_dedupe_key");

CREATE INDEX "knowledge_indexing_jobs_claim_idx"
  ON "knowledge_indexing_jobs" ("status", "retry_after_at", "priority", "created_at");

CREATE INDEX "knowledge_indexing_jobs_source_created_idx"
  ON "knowledge_indexing_jobs" ("source_type", "source_id", "created_at" DESC);

CREATE INDEX "knowledge_indexing_jobs_workspace_status_created_idx"
  ON "knowledge_indexing_jobs" ("workspace_id", "status", "created_at" DESC);

CREATE INDEX "knowledge_indexing_jobs_assistant_status_created_idx"
  ON "knowledge_indexing_jobs" ("assistant_id", "status", "created_at" DESC);

CREATE INDEX "knowledge_indexing_jobs_skill_status_created_idx"
  ON "knowledge_indexing_jobs" ("skill_id", "status", "created_at" DESC);

CREATE UNIQUE INDEX "knowledge_vector_chunks_source_version_model_key"
  ON "knowledge_vector_chunks"
    ("source_type", "source_id", "source_version", "chunk_index", "embedding_model_key");

CREATE INDEX "knowledge_vector_chunks_workspace_source_model_idx"
  ON "knowledge_vector_chunks" ("workspace_id", "source_type", "embedding_model_key");

CREATE INDEX "knowledge_vector_chunks_assistant_source_model_idx"
  ON "knowledge_vector_chunks" ("assistant_id", "source_type", "embedding_model_key");

CREATE INDEX "knowledge_vector_chunks_skill_model_idx"
  ON "knowledge_vector_chunks" ("skill_id", "embedding_model_key");

ALTER TABLE "skills"
  ADD CONSTRAINT "skills_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skills"
  ADD CONSTRAINT "skills_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "app_users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skills"
  ADD CONSTRAINT "skills_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "app_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "skill_documents"
  ADD CONSTRAINT "skill_documents_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_documents"
  ADD CONSTRAINT "skill_documents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_documents"
  ADD CONSTRAINT "skill_documents_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "app_users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_document_chunks"
  ADD CONSTRAINT "skill_document_chunks_document_id_fkey"
    FOREIGN KEY ("skill_document_id") REFERENCES "skill_documents" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_document_chunks"
  ADD CONSTRAINT "skill_document_chunks_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_document_chunks"
  ADD CONSTRAINT "skill_document_chunks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_skill_assignments"
  ADD CONSTRAINT "assistant_skill_assignments_assistant_id_user_id_fkey"
    FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants" ("id", "user_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_skill_assignments"
  ADD CONSTRAINT "assistant_skill_assignments_workspace_id_user_id_fkey"
    FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members" ("workspace_id", "user_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_skill_assignments"
  ADD CONSTRAINT "assistant_skill_assignments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_skill_assignments"
  ADD CONSTRAINT "assistant_skill_assignments_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_indexing_jobs"
  ADD CONSTRAINT "knowledge_indexing_jobs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "knowledge_indexing_jobs"
  ADD CONSTRAINT "knowledge_indexing_jobs_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_indexing_jobs"
  ADD CONSTRAINT "knowledge_indexing_jobs_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_indexing_jobs"
  ADD CONSTRAINT "knowledge_indexing_jobs_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "app_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "knowledge_vector_chunks"
  ADD CONSTRAINT "knowledge_vector_chunks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "knowledge_vector_chunks"
  ADD CONSTRAINT "knowledge_vector_chunks_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_vector_chunks"
  ADD CONSTRAINT "knowledge_vector_chunks_skill_id_fkey"
    FOREIGN KEY ("skill_id") REFERENCES "skills" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
