ALTER TABLE "assistant_memory_registry_items"
ADD COLUMN "embedding_vector" JSONB,
ADD COLUMN "embedding_model_key" TEXT,
ADD COLUMN "embedding_generated_at" TIMESTAMPTZ(6);
