-- ADR-086 Slice 2: durable async media-job foundation.

CREATE TYPE "AssistantMediaJobKind" AS ENUM ('image', 'audio', 'video');

CREATE TYPE "AssistantMediaJobStatus" AS ENUM (
  'queued',
  'running',
  'completion_pending',
  'delivered',
  'failed',
  'canceled',
  'expired'
);

CREATE TABLE "assistant_media_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "surface" "AssistantChatSurface" NOT NULL,
  "kind" "AssistantMediaJobKind" NOT NULL,
  "status" "AssistantMediaJobStatus" NOT NULL,
  "source_client_turn_id" VARCHAR(128),
  "source_user_message_id" UUID,
  "assistant_acknowledgement_message_id" UUID,
  "completion_assistant_message_id" UUID,
  "last_error_code" VARCHAR(128),
  "last_error_message" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_media_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_media_jobs_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_media_jobs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_media_jobs_chat_id_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assistant_media_jobs_assistant_status_updated_idx"
  ON "assistant_media_jobs"("assistant_id", "status", "updated_at");

CREATE INDEX "assistant_media_jobs_chat_status_updated_idx"
  ON "assistant_media_jobs"("chat_id", "status", "updated_at");

CREATE INDEX "assistant_media_jobs_workspace_status_updated_idx"
  ON "assistant_media_jobs"("workspace_id", "status", "updated_at");

CREATE INDEX "assistant_media_jobs_status_updated_idx"
  ON "assistant_media_jobs"("status", "updated_at");
