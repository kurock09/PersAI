ALTER TABLE "assistant_media_jobs"
    ADD COLUMN "completion_usage_json" JSONB;

ALTER TABLE "assistant_document_render_jobs"
    ADD COLUMN "completion_usage_json" JSONB;

CREATE TABLE "assistant_voice_transcription_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "surface" VARCHAR(64) NOT NULL,
    "billing_facts_json" JSONB,
    "mime_type" VARCHAR(255),
    "original_filename" VARCHAR(255),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_voice_transcription_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_voice_transcription_events_workspace_id_occurred_at_idx"
    ON "assistant_voice_transcription_events"("workspace_id", "occurred_at" DESC);

CREATE INDEX "assistant_voice_transcription_events_assistant_id_occurred_at_idx"
    ON "assistant_voice_transcription_events"("assistant_id", "occurred_at" DESC);

ALTER TABLE "assistant_voice_transcription_events"
    ADD CONSTRAINT "assistant_voice_transcription_events_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_voice_transcription_events"
    ADD CONSTRAINT "assistant_voice_transcription_events_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
