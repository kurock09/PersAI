-- ADR-152 checkpoint 2 pass A: same-row narration and continuation ownership.
ALTER TABLE "assistant_async_job_handles"
  ADD COLUMN "source_finalized_at" TIMESTAMPTZ(6),
  ADD COLUMN "narration_decision_at" TIMESTAMPTZ(6),
  ADD COLUMN "terminal_observed_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_depth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "ready_at" TIMESTAMPTZ(6),
  ADD COLUMN "dispatched_at" TIMESTAMPTZ(6),
  ADD COLUMN "dispatch_receipt_request_id" VARCHAR(128),
  ADD COLUMN "continuation_assistant_message_id" UUID,
  ADD COLUMN "continuation_artifacts_attempted_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_artifacts_delivered_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_artifacts_result" VARCHAR(32),
  ADD COLUMN "continuation_artifacts_error" VARCHAR(1000),
  ADD COLUMN "continuation_external_attempted_at" TIMESTAMPTZ(6),
  ADD COLUMN "continuation_external_result" VARCHAR(32),
  ADD COLUMN "continuation_external_error" VARCHAR(1000),
  ADD COLUMN "completed_at" TIMESTAMPTZ(6),
  ADD COLUMN "failed_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN "max_retries" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "last_error_code" VARCHAR(64),
  ADD COLUMN "last_error_message" VARCHAR(1000);

ALTER TABLE "assistant_document_render_jobs"
  ADD COLUMN "source_client_turn_id" VARCHAR(128);

ALTER TABLE "assistant_async_job_handles"
  ADD CONSTRAINT "assistant_async_job_handles_continuation_depth_check"
    CHECK ("continuation_depth" BETWEEN 0 AND 4),
  ADD CONSTRAINT "assistant_async_job_handles_retry_bounds_check"
    CHECK ("retry_count" >= 0 AND "max_retries" BETWEEN 1 AND 32),
  ADD CONSTRAINT "assistant_async_job_handles_narration_owner_check"
    CHECK (
      "narration_owner" IS NULL OR
      "narration_owner" IN ('current_turn', 'continuation', 'legacy')
    ),
  ADD CONSTRAINT "assistant_async_job_handles_narration_decision_check"
    CHECK (
      "narration_decision" IS NULL OR
      "narration_decision" IN (
        'current_turn_inline', 'notify_subscribed', 'legacy_completion',
        'continuation_depth_exhausted'
      )
    );

CREATE INDEX "assistant_async_job_handles_chat_id_source_client_turn_id_idx"
  ON "assistant_async_job_handles"("chat_id", "source_client_turn_id");
CREATE INDEX "assistant_async_job_handles_state_claim_expires_at_idx"
  ON "assistant_async_job_handles"("state", "claim_expires_at");
CREATE INDEX "assistant_async_job_handles_source_finalized_at_updated_at_idx"
  ON "assistant_async_job_handles"("source_finalized_at", "updated_at");

CREATE UNIQUE INDEX "assistant_async_job_handles_continuation_client_turn_id_key"
  ON "assistant_async_job_handles"("continuation_client_turn_id");

-- Continuation-created jobs inherit exact unattended depth. Ordinary user turns
-- have no matching continuation clientTurnId and therefore reset to depth 0.
CREATE OR REPLACE FUNCTION "mint_assistant_async_job_handle"()
RETURNS trigger AS $$
DECLARE
  handle_kind "AssistantAsyncJobHandleKind";
  source_turn VARCHAR(128);
  handle_thread VARCHAR(255);
  inherited_depth INTEGER := 0;
BEGIN
  handle_kind := CASE TG_TABLE_NAME
    WHEN 'assistant_media_jobs' THEN 'media'::"AssistantAsyncJobHandleKind"
    ELSE 'document'::"AssistantAsyncJobHandleKind"
  END;
  source_turn := COALESCE(
    to_jsonb(NEW)->>'source_client_turn_id',
    to_jsonb(NEW)->>'source_user_message_id'
  );
  SELECT "surface_thread_key" INTO handle_thread
  FROM "assistant_chats"
  WHERE "id" = NEW."chat_id";
  IF source_turn IS NOT NULL THEN
    SELECT LEAST("continuation_depth" + 1, 4) INTO inherited_depth
    FROM "assistant_async_job_handles"
    WHERE "continuation_client_turn_id" = source_turn;
    inherited_depth := COALESCE(inherited_depth, 0);
  END IF;
  INSERT INTO "assistant_async_job_handles" (
    "job_ref", "kind", "canonical_job_id", "assistant_id", "workspace_id",
    "user_id", "chat_id", "channel", "thread_key", "source_client_turn_id",
    "source_user_message_id", "continuation_depth"
  ) VALUES (
    'jr1.' || handle_kind::text || '.' ||
      replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
    handle_kind, NEW."id", NEW."assistant_id", NEW."workspace_id", NEW."user_id",
    NEW."chat_id", NEW."surface", handle_thread, source_turn, NEW."source_user_message_id",
    inherited_depth
  )
  ON CONFLICT ("kind", "canonical_job_id") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
