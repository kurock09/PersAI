-- ADR-161 D2a: server-only DeepSeek replay trace. This is operational
-- provider state; canonical chat messages and tool exchanges remain authority.
CREATE TABLE "deepseek_chat_append_traces" (
    "chat_id" UUID NOT NULL,
    "active_epoch" INTEGER NOT NULL DEFAULT 0,
    "next_ordinal" INTEGER NOT NULL DEFAULT 0,
    "config_hash" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deepseek_chat_append_traces_pkey" PRIMARY KEY ("chat_id"),
    CONSTRAINT "deepseek_chat_append_traces_active_epoch_check" CHECK ("active_epoch" >= 0),
    CONSTRAINT "deepseek_chat_append_traces_next_ordinal_check" CHECK ("next_ordinal" >= 0),
    CONSTRAINT "deepseek_chat_append_traces_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "deepseek_chat_append_trace_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" UUID NOT NULL,
    "epoch" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source_key" VARCHAR(256) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "content_text" TEXT,
    "content_json" JSONB,
    "state_key" VARCHAR(256),
    "revision" INTEGER,
    "supersedes" VARCHAR(256),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deepseek_chat_append_trace_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deepseek_chat_append_trace_events_content_check"
      CHECK ("content_text" IS NOT NULL OR "content_json" IS NOT NULL),
    CONSTRAINT "deepseek_chat_append_trace_events_epoch_check" CHECK ("epoch" > 0),
    CONSTRAINT "deepseek_chat_append_trace_events_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "deepseek_chat_append_trace_events_revision_check"
      CHECK ("revision" IS NULL OR "revision" >= 0),
    CONSTRAINT "deepseek_chat_append_trace_events_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "deepseek_chat_append_traces"("chat_id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "deepseek_chat_append_trace_events_chat_id_epoch_ordinal_key"
  ON "deepseek_chat_append_trace_events"("chat_id", "epoch", "ordinal");
CREATE UNIQUE INDEX "deepseek_chat_append_trace_events_chat_id_epoch_source_key_key"
  ON "deepseek_chat_append_trace_events"("chat_id", "epoch", "source_key");
CREATE INDEX "deepseek_chat_append_trace_events_chat_id_epoch_ordinal_idx"
  ON "deepseek_chat_append_trace_events"("chat_id", "epoch", "ordinal");
