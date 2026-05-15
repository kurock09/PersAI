-- ADR-097 Phase 2a: document domain persistence foundation.

CREATE TYPE "AssistantDocumentType" AS ENUM ('pdf_document', 'presentation');

CREATE TYPE "AssistantDocumentStatus" AS ENUM (
  'drafting',
  'rendering',
  'ready',
  'failed',
  'archived'
);

CREATE TYPE "AssistantDocumentDescriptorMode" AS ENUM (
  'create_pdf_document',
  'create_presentation',
  'revise_document',
  'export_or_redeliver'
);

CREATE TYPE "AssistantDocumentVersionStatus" AS ENUM (
  'draft',
  'render_requested',
  'rendering',
  'ready',
  'failed',
  'superseded'
);

CREATE TYPE "AssistantDocumentRenderProvider" AS ENUM ('pdfmonkey', 'gamma');

CREATE TYPE "AssistantDocumentOutputFormat" AS ENUM ('pdf', 'pptx');

CREATE TYPE "AssistantDocumentRenderJobStatus" AS ENUM (
  'queued',
  'running',
  'provider_processing',
  'fetching_output',
  'ready_for_delivery',
  'delivered',
  'failed',
  'expired',
  'canceled'
);

CREATE TABLE "assistant_documents" (
  "doc_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "document_type" "AssistantDocumentType" NOT NULL,
  "current_version_id" UUID,
  "status" "AssistantDocumentStatus" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_documents_pkey" PRIMARY KEY ("doc_id"),
  CONSTRAINT "assistant_documents_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_documents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_documents_chat_id_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assistant_documents_assistant_status_updated_idx"
  ON "assistant_documents"("assistant_id", "status", "updated_at");

CREATE INDEX "assistant_documents_chat_updated_idx"
  ON "assistant_documents"("chat_id", "updated_at");

CREATE INDEX "assistant_documents_workspace_updated_idx"
  ON "assistant_documents"("workspace_id", "updated_at");

CREATE UNIQUE INDEX "assistant_documents_current_version_id_key"
  ON "assistant_documents"("current_version_id");

CREATE TABLE "assistant_document_versions" (
  "version_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "parent_version_id" UUID,
  "descriptor_mode" "AssistantDocumentDescriptorMode" NOT NULL,
  "source_json" JSONB NOT NULL,
  "provider_input_json" JSONB,
  "source_summary_text" TEXT,
  "source_outline_json" JSONB,
  "status" "AssistantDocumentVersionStatus" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_document_versions_pkey" PRIMARY KEY ("version_id"),
  CONSTRAINT "assistant_document_versions_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "assistant_documents"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_versions_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_versions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assistant_document_versions_doc_version_number_key"
  ON "assistant_document_versions"("doc_id", "version_number");

CREATE INDEX "assistant_document_versions_assistant_created_idx"
  ON "assistant_document_versions"("assistant_id", "created_at" DESC);

CREATE INDEX "assistant_document_versions_doc_created_idx"
  ON "assistant_document_versions"("doc_id", "created_at" DESC);

CREATE INDEX "assistant_document_versions_workspace_created_idx"
  ON "assistant_document_versions"("workspace_id", "created_at" DESC);

ALTER TABLE "assistant_document_versions"
  ADD CONSTRAINT "assistant_document_versions_parent_version_id_fkey"
  FOREIGN KEY ("parent_version_id")
  REFERENCES "assistant_document_versions"("version_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "assistant_documents"
  ADD CONSTRAINT "assistant_documents_current_version_id_fkey"
  FOREIGN KEY ("current_version_id")
  REFERENCES "assistant_document_versions"("version_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "assistant_document_render_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "surface" "AssistantChatSurface" NOT NULL,
  "provider" "AssistantDocumentRenderProvider" NOT NULL,
  "output_format" "AssistantDocumentOutputFormat" NOT NULL,
  "status" "AssistantDocumentRenderJobStatus" NOT NULL,
  "source_user_message_id" UUID,
  "request_json" JSONB,
  "provider_status_json" JSONB,
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_retry_at" TIMESTAMPTZ(6),
  "scheduler_claim_token" VARCHAR(64),
  "scheduler_claimed_at" TIMESTAMPTZ(6),
  "scheduler_claim_expires_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_document_render_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_document_render_jobs_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "assistant_documents"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_render_jobs_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "assistant_document_versions"("version_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_render_jobs_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_render_jobs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_render_jobs_chat_id_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assistant_document_render_jobs_assistant_status_updated_idx"
  ON "assistant_document_render_jobs"("assistant_id", "status", "updated_at");

CREATE INDEX "assistant_document_render_jobs_chat_status_updated_idx"
  ON "assistant_document_render_jobs"("chat_id", "status", "updated_at");

CREATE INDEX "assistant_document_render_jobs_workspace_status_updated_idx"
  ON "assistant_document_render_jobs"("workspace_id", "status", "updated_at");

CREATE INDEX "assistant_document_render_jobs_doc_created_idx"
  ON "assistant_document_render_jobs"("doc_id", "created_at" DESC);

CREATE INDEX "assistant_document_render_jobs_status_updated_idx"
  ON "assistant_document_render_jobs"("status", "updated_at");

CREATE TABLE "assistant_document_provider_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "provider" "AssistantDocumentRenderProvider" NOT NULL,
  "external_document_id" VARCHAR(255),
  "external_render_id" VARCHAR(255),
  "latest_provider_status" VARCHAR(128),
  "provider_metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_document_provider_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_document_provider_mappings_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "assistant_documents"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_provider_mappings_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "assistant_document_versions"("version_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_provider_mappings_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assistant_document_provider_mappings_doc_provider_updated_idx"
  ON "assistant_document_provider_mappings"("doc_id", "provider", "updated_at");

CREATE INDEX "assistant_document_provider_mappings_version_provider_idx"
  ON "assistant_document_provider_mappings"("version_id", "provider");

CREATE INDEX "assistant_document_provider_mappings_workspace_provider_updated_idx"
  ON "assistant_document_provider_mappings"("workspace_id", "provider", "updated_at");

CREATE TABLE "assistant_document_delivered_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "render_job_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "assistant_file_id" UUID NOT NULL,
  "output_mime_type" VARCHAR(255) NOT NULL,
  "completion_assistant_message_id" UUID,
  "delivered_at" TIMESTAMPTZ(6) NOT NULL,
  "is_current_output" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_document_delivered_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_document_delivered_files_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "assistant_documents"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_delivered_files_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "assistant_document_versions"("version_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_delivered_files_render_job_id_fkey"
    FOREIGN KEY ("render_job_id") REFERENCES "assistant_document_render_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_delivered_files_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_delivered_files_assistant_file_id_fkey"
    FOREIGN KEY ("assistant_file_id") REFERENCES "assistant_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assistant_document_delivered_files_doc_delivered_idx"
  ON "assistant_document_delivered_files"("doc_id", "delivered_at" DESC);

CREATE INDEX "assistant_document_delivered_files_version_delivered_idx"
  ON "assistant_document_delivered_files"("version_id", "delivered_at" DESC);

CREATE INDEX "assistant_document_delivered_files_assistant_file_id_idx"
  ON "assistant_document_delivered_files"("assistant_file_id");

CREATE INDEX "assistant_document_delivered_files_workspace_delivered_idx"
  ON "assistant_document_delivered_files"("workspace_id", "delivered_at" DESC);

CREATE TABLE "assistant_document_revision_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doc_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "previous_version_id" UUID,
  "new_version_id" UUID NOT NULL,
  "user_revision_request_text" TEXT,
  "interpreted_patch_intent" TEXT,
  "structured_patch_json" JSONB,
  "provider_edit_ref" VARCHAR(255),
  "runtime_provenance_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_document_revision_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_document_revision_logs_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "assistant_documents"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_document_revision_logs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assistant_document_revision_logs_doc_created_idx"
  ON "assistant_document_revision_logs"("doc_id", "created_at" DESC);

CREATE INDEX "assistant_document_revision_logs_workspace_created_idx"
  ON "assistant_document_revision_logs"("workspace_id", "created_at" DESC);

ALTER TABLE "assistant_document_revision_logs"
  ADD CONSTRAINT "assistant_document_revision_logs_previous_version_id_fkey"
  FOREIGN KEY ("previous_version_id")
  REFERENCES "assistant_document_versions"("version_id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "assistant_document_revision_logs"
  ADD CONSTRAINT "assistant_document_revision_logs_new_version_id_fkey"
  FOREIGN KEY ("new_version_id")
  REFERENCES "assistant_document_versions"("version_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
