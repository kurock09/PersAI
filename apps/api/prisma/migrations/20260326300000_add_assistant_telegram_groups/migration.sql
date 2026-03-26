-- CreateTable
CREATE TABLE "assistant_telegram_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "telegram_chat_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "member_count" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assistant_telegram_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_telegram_groups_assistant_id_telegram_chat_id_key" ON "assistant_telegram_groups"("assistant_id", "telegram_chat_id");

-- AddForeignKey
ALTER TABLE "assistant_telegram_groups" ADD CONSTRAINT "assistant_telegram_groups_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
