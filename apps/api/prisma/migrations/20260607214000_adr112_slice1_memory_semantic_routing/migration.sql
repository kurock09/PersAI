CREATE TYPE "AssistantMemoryRegistryDurability" AS ENUM ('identity', 'episodic');

CREATE TYPE "AssistantMemoryRegistryStability" AS ENUM ('stable', 'time_bound');

ALTER TABLE "assistant_memory_registry_items"
ADD COLUMN "durability" "AssistantMemoryRegistryDurability",
ADD COLUMN "stability" "AssistantMemoryRegistryStability",
ADD COLUMN "confidence" DOUBLE PRECISION;
