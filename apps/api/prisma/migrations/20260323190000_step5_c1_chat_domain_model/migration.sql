-- CreateEnum
CREATE TYPE "AssistantChatSurface" AS ENUM ('web');

-- CreateEnum
CREATE TYPE "AssistantChatMessageAuthor" AS ENUM ('user', 'assistant', 'system');

-- AlterTable
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_id_user_id_key" UNIQUE ("id", "user_id");

-- CreateTable
CREATE TABLE "assistant_chats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "surface" "AssistantChatSurface" NOT NULL,
    "surface_thread_key" TEXT NOT NULL,
    "title" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" UUID NOT NULL,
    "assistant_id" UUID NOT NULL,
    "author" "AssistantChatMessageAuthor" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_chats_assistant_id_surface_surface_thread_key_key" ON "assistant_chats"("assistant_id", "surface", "surface_thread_key");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_chats_id_assistant_id_key" ON "assistant_chats"("id", "assistant_id");

-- CreateIndex
CREATE INDEX "assistant_chat_messages_chat_id_created_at_idx" ON "assistant_chat_messages"("chat_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_assistant_id_user_id_fkey" FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_workspace_id_user_id_fkey" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members"("workspace_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_chat_messages" ADD CONSTRAINT "assistant_chat_messages_chat_id_assistant_id_fkey" FOREIGN KEY ("chat_id", "assistant_id") REFERENCES "assistant_chats"("id", "assistant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_chat_messages" ADD CONSTRAINT "assistant_chat_messages_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
