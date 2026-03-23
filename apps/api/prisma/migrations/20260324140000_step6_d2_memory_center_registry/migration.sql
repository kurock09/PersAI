-- CreateEnum
CREATE TYPE "AssistantMemoryRegistrySourceType" AS ENUM ('web_chat');

-- CreateTable
CREATE TABLE "assistant_memory_registry_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "chat_id" UUID,
    "related_user_message_id" UUID,
    "related_assistant_message_id" UUID,
    "summary" VARCHAR(500) NOT NULL,
    "source_type" "AssistantMemoryRegistrySourceType" NOT NULL,
    "source_label" VARCHAR(64),
    "forgotten_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_memory_registry_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_memory_registry_items_assistant_id_created_at_idx" ON "assistant_memory_registry_items"("assistant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "assistant_memory_registry_items" ADD CONSTRAINT "assistant_memory_registry_items_assistant_id_user_id_fkey" FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_memory_registry_items" ADD CONSTRAINT "assistant_memory_registry_items_workspace_id_user_id_fkey" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members"("workspace_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
