ALTER TABLE "assistant_memory_registry_items"
ADD COLUMN "superseded_at" TIMESTAMPTZ(6),
ADD COLUMN "superseded_by_memory_id" TEXT;
