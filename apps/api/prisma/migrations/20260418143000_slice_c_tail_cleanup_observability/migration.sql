-- CreateEnum
CREATE TYPE "KnowledgeRetrievalEventKind" AS ENUM ('search', 'fetch');

-- CreateEnum
CREATE TYPE "KnowledgeRetrievalEventSource" AS ENUM ('document', 'global', 'memory', 'chat', 'preset', 'subscription');

-- CreateEnum
CREATE TYPE "KnowledgeRetrievalMode" AS ENUM ('lexical', 'hybrid');

-- CreateEnum
CREATE TYPE "KnowledgeRetrievalOutcome" AS ENUM ('success', 'empty', 'error');

-- CreateTable
CREATE TABLE "knowledge_retrieval_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "assistant_id" UUID,
    "event_kind" "KnowledgeRetrievalEventKind" NOT NULL,
    "source" "KnowledgeRetrievalEventSource" NOT NULL,
    "retrieval_mode" "KnowledgeRetrievalMode" NOT NULL,
    "outcome" "KnowledgeRetrievalOutcome" NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "lexical_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "vector_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "helper_applied" BOOLEAN NOT NULL DEFAULT false,
    "fetch_depth" INTEGER NOT NULL DEFAULT 0,
    "fetched_chars" INTEGER NOT NULL DEFAULT 0,
    "embedding_model_key" VARCHAR(255),
    "helper_model_key" VARCHAR(255),
    "helper_provider_key" VARCHAR(64),
    "helper_input_tokens" INTEGER,
    "helper_output_tokens" INTEGER,
    "helper_total_tokens" INTEGER,
    "error_code" VARCHAR(128),
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_retrieval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_retrieval_rollups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "source" "KnowledgeRetrievalEventSource" NOT NULL,
    "searches_total" INTEGER NOT NULL DEFAULT 0,
    "fetches_total" INTEGER NOT NULL DEFAULT 0,
    "success_total" INTEGER NOT NULL DEFAULT 0,
    "empty_total" INTEGER NOT NULL DEFAULT 0,
    "error_total" INTEGER NOT NULL DEFAULT 0,
    "lexical_total" INTEGER NOT NULL DEFAULT 0,
    "hybrid_total" INTEGER NOT NULL DEFAULT 0,
    "helper_applied_total" INTEGER NOT NULL DEFAULT 0,
    "embedding_query_total" INTEGER NOT NULL DEFAULT 0,
    "duration_ms_total" BIGINT NOT NULL DEFAULT 0,
    "max_duration_ms" INTEGER NOT NULL DEFAULT 0,
    "result_count_total" INTEGER NOT NULL DEFAULT 0,
    "lexical_candidates_total" INTEGER NOT NULL DEFAULT 0,
    "vector_candidates_total" INTEGER NOT NULL DEFAULT 0,
    "fetch_depth_total" INTEGER NOT NULL DEFAULT 0,
    "max_fetch_depth" INTEGER NOT NULL DEFAULT 0,
    "fetched_chars_total" BIGINT NOT NULL DEFAULT 0,
    "max_fetched_chars" INTEGER NOT NULL DEFAULT 0,
    "helper_input_tokens_total" INTEGER NOT NULL DEFAULT 0,
    "helper_output_tokens_total" INTEGER NOT NULL DEFAULT 0,
    "helper_total_tokens_total" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_retrieval_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_retrieval_events_workspace_id_event_kind_created_at_idx" ON "knowledge_retrieval_events"("workspace_id", "event_kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "knowledge_retrieval_events_assistant_id_event_kind_created_at_idx" ON "knowledge_retrieval_events"("assistant_id", "event_kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "knowledge_retrieval_events_source_event_kind_created_at_idx" ON "knowledge_retrieval_events"("source", "event_kind", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_retrieval_rollups_workspace_id_source_key" ON "knowledge_retrieval_rollups"("workspace_id", "source");

-- CreateIndex
CREATE INDEX "knowledge_retrieval_rollups_workspace_id_updated_at_idx" ON "knowledge_retrieval_rollups"("workspace_id", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "knowledge_retrieval_events" ADD CONSTRAINT "knowledge_retrieval_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_retrieval_events" ADD CONSTRAINT "knowledge_retrieval_events_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_retrieval_rollups" ADD CONSTRAINT "knowledge_retrieval_rollups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
