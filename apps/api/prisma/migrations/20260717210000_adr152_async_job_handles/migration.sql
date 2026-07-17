-- ADR-152 checkpoint 1: additive opaque async-job handle mapping.
CREATE TYPE "AssistantAsyncJobHandleKind" AS ENUM ('media', 'document');
CREATE TYPE "AssistantAsyncJobHandleState" AS ENUM (
  'none',
  'subscribed',
  'ready',
  'claimed',
  'dispatched',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE "assistant_async_job_handles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_ref" VARCHAR(96) NOT NULL,
  "kind" "AssistantAsyncJobHandleKind" NOT NULL,
  "canonical_job_id" UUID NOT NULL,
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "channel" "AssistantChatSurface" NOT NULL,
  "thread_key" VARCHAR(255),
  "source_client_turn_id" VARCHAR(128),
  "source_user_message_id" UUID,
  "state" "AssistantAsyncJobHandleState" NOT NULL DEFAULT 'none',
  "terminal_snapshot_json" JSONB,
  "narration_owner" VARCHAR(32),
  "narration_decision" VARCHAR(64),
  "continuation_client_turn_id" VARCHAR(128),
  "claim_token" VARCHAR(64),
  "claim_expires_at" TIMESTAMPTZ(6),
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_async_job_handles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_async_job_handles_job_ref_key" UNIQUE ("job_ref"),
  CONSTRAINT "assistant_async_job_handles_kind_canonical_job_id_key" UNIQUE ("kind", "canonical_job_id"),
  CONSTRAINT "assistant_async_job_handles_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_async_job_handles_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_async_job_handles_chat_id_fkey"
    FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "assistant_async_job_handles_assistant_id_workspace_id_user_id_chat_id_idx"
  ON "assistant_async_job_handles"("assistant_id", "workspace_id", "user_id", "chat_id");
CREATE INDEX "assistant_async_job_handles_state_next_retry_at_idx"
  ON "assistant_async_job_handles"("state", "next_retry_at");

CREATE FUNCTION "mint_assistant_async_job_handle"()
RETURNS trigger AS $$
DECLARE
  handle_kind "AssistantAsyncJobHandleKind";
  source_turn VARCHAR(128);
  handle_thread VARCHAR(255);
BEGIN
  handle_kind := CASE TG_TABLE_NAME
    WHEN 'assistant_media_jobs' THEN 'media'::"AssistantAsyncJobHandleKind"
    ELSE 'document'::"AssistantAsyncJobHandleKind"
  END;
  source_turn := to_jsonb(NEW)->>'source_client_turn_id';
  SELECT "surface_thread_key" INTO handle_thread
  FROM "assistant_chats"
  WHERE "id" = NEW."chat_id";
  INSERT INTO "assistant_async_job_handles" (
    "job_ref", "kind", "canonical_job_id", "assistant_id", "workspace_id",
    "user_id", "chat_id", "channel", "thread_key", "source_client_turn_id",
    "source_user_message_id"
  ) VALUES (
    'jr1.' || handle_kind::text || '.' ||
      replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
    handle_kind, NEW."id", NEW."assistant_id", NEW."workspace_id", NEW."user_id",
    NEW."chat_id", NEW."surface", handle_thread, source_turn, NEW."source_user_message_id"
  )
  ON CONFLICT ("kind", "canonical_job_id") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "assistant_media_jobs_mint_async_handle"
AFTER INSERT ON "assistant_media_jobs"
FOR EACH ROW EXECUTE FUNCTION "mint_assistant_async_job_handle"();

CREATE TRIGGER "assistant_document_render_jobs_mint_async_handle"
AFTER INSERT ON "assistant_document_render_jobs"
FOR EACH ROW EXECUTE FUNCTION "mint_assistant_async_job_handle"();
