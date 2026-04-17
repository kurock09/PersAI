-- ADR-072 T15-5 follow-up: generalize reminder rows into scheduled actions

CREATE TYPE "AssistantTaskRegistryAudience" AS ENUM ('user', 'assistant');

ALTER TABLE "assistant_task_registry_items"
ADD COLUMN "audience" "AssistantTaskRegistryAudience" NOT NULL DEFAULT 'user',
ADD COLUMN "action_type" VARCHAR(64),
ADD COLUMN "action_payload_json" JSONB;
