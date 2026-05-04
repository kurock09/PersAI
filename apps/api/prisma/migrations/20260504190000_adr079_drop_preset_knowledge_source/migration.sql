-- ADR-079 follow-up: drop `preset` from runtime knowledge sources.
-- preset was prompt/preset internals leaking through orchestrated retrieval; runtime is
-- now native-only and admin-managed Product KB plus subscription/plan facts cover the
-- product surface, so the preset value is removed from the model-facing source vocabulary
-- and the observability enum.

-- Telemetry rows referring to the removed source are deleted before the enum is rebuilt;
-- the data was operational observability only.
DELETE FROM "knowledge_retrieval_events" WHERE "source" = 'preset';
DELETE FROM "knowledge_retrieval_rollups" WHERE "source" = 'preset';

-- Postgres does not support dropping a value from an enum in place. The standard rebuild
-- pattern is: rename the old enum, create the target enum, migrate dependent columns,
-- drop the old enum.
ALTER TYPE "KnowledgeRetrievalEventSource" RENAME TO "KnowledgeRetrievalEventSource_old";

CREATE TYPE "KnowledgeRetrievalEventSource" AS ENUM (
  'document',
  'global',
  'product',
  'skill',
  'memory',
  'chat',
  'subscription',
  'web'
);

ALTER TABLE "knowledge_retrieval_events"
  ALTER COLUMN "source" TYPE "KnowledgeRetrievalEventSource"
  USING "source"::text::"KnowledgeRetrievalEventSource";

ALTER TABLE "knowledge_retrieval_rollups"
  ALTER COLUMN "source" TYPE "KnowledgeRetrievalEventSource"
  USING "source"::text::"KnowledgeRetrievalEventSource";

DROP TYPE "KnowledgeRetrievalEventSource_old";
