ALTER TABLE "runtime_sessions"
ADD COLUMN "memory_extraction_watermark" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "AssistantBackgroundCompactionJobTrigger"
ADD VALUE IF NOT EXISTS 'idle_extract';
