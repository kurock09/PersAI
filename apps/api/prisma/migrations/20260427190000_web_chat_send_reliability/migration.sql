-- Web chat send reliability: durable logical-turn attempts and idempotent staged attachments.

ALTER TABLE "assistant_chat_message_attachments"
  ADD COLUMN "client_turn_id" VARCHAR(128),
  ADD COLUMN "client_attachment_id" VARCHAR(128);

CREATE INDEX "assistant_chat_message_attachments_chat_id_client_turn_id_idx"
  ON "assistant_chat_message_attachments"("chat_id", "client_turn_id");

CREATE UNIQUE INDEX "assistant_chat_message_attachments_assistant_chat_client_attachment_uidx"
  ON "assistant_chat_message_attachments"("assistant_id", "chat_id", "client_attachment_id")
;

CREATE TABLE "assistant_web_chat_turn_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "surface_thread_key" TEXT NOT NULL,
  "client_turn_id" VARCHAR(128) NOT NULL,
  "surface_client" VARCHAR(64),
  "status" VARCHAR(32) NOT NULL,
  "chat_id" UUID,
  "user_message_id" UUID,
  "assistant_message_id" UUID,
  "responded_at" TIMESTAMPTZ(6),
  "terminal_payload" JSONB,
  "error_code" VARCHAR(128),
  "error_message" TEXT,
  "accepted_at" TIMESTAMPTZ(6),
  "running_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "interrupted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_web_chat_turn_attempts_assistant_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_web_chat_turn_attempts_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_web_chat_turn_attempts_chat_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assistant_web_chat_turn_attempts_logical_turn_uidx"
  ON "assistant_web_chat_turn_attempts"("assistant_id", "user_id", "surface_thread_key", "client_turn_id");

CREATE INDEX "assistant_web_chat_turn_attempts_assistant_user_client_idx"
  ON "assistant_web_chat_turn_attempts"("assistant_id", "user_id", "client_turn_id");

CREATE INDEX "assistant_web_chat_turn_attempts_chat_id_idx"
  ON "assistant_web_chat_turn_attempts"("chat_id");

CREATE INDEX "assistant_web_chat_turn_attempts_status_updated_at_idx"
  ON "assistant_web_chat_turn_attempts"("status", "updated_at");
