CREATE TABLE "assistant_telegram_album_collectors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "telegram_chat_id" VARCHAR(64) NOT NULL,
  "telegram_chat_type" VARCHAR(32) NOT NULL,
  "telegram_user_id" VARCHAR(64) NOT NULL,
  "media_group_id" VARCHAR(64) NOT NULL,
  "caption" TEXT,
  "parts_json" JSONB NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "last_part_at" TIMESTAMPTZ(6) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'collecting',
  "scheduler_claim_token" VARCHAR(64),
  "scheduler_claimed_at" TIMESTAMPTZ(6),
  "scheduler_claim_expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_telegram_album_collectors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_telegram_album_collectors_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_telegram_album_collectors_chat_id_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assistant_telegram_album_collectors_assistant_chat_group_key"
  ON "assistant_telegram_album_collectors"("assistant_id", "telegram_chat_id", "media_group_id");

CREATE INDEX "assistant_telegram_album_collectors_status_last_part_idx"
  ON "assistant_telegram_album_collectors"("status", "last_part_at");
