ALTER TABLE "assistant_knowledge_sources"
  ADD COLUMN "processor_provider_key" VARCHAR(64),
  ADD COLUMN "processor_mode" "KnowledgeIndexingJobProcessorMode",
  ADD COLUMN "processing_quality" JSONB;

ALTER TABLE "global_knowledge_sources"
  ADD COLUMN "processor_provider_key" VARCHAR(64),
  ADD COLUMN "processor_mode" "KnowledgeIndexingJobProcessorMode",
  ADD COLUMN "processing_quality" JSONB;
