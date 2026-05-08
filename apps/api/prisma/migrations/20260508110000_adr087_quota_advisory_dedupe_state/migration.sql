CREATE TABLE "assistant_quota_advisory_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "channel" "RuntimeConversationChannel" NOT NULL,
  "external_thread_key" VARCHAR(255) NOT NULL,
  "dedupe_key" VARCHAR(512) NOT NULL,
  "limit_code" VARCHAR(128) NOT NULL,
  "display_name" VARCHAR(255) NOT NULL,
  "threshold_code" VARCHAR(64) NOT NULL,
  "warning_threshold_percent" INTEGER NOT NULL,
  "current_percent" INTEGER NOT NULL,
  "period_started_at" TIMESTAMPTZ(6),
  "period_ends_at" TIMESTAMPTZ(6),
  "period_source" VARCHAR(32),
  "delivered_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_quota_advisory_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_quota_advisory_states_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_quota_advisory_states_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assistant_quota_advisory_states_dedupe_key_key"
  ON "assistant_quota_advisory_states"("dedupe_key");

CREATE INDEX "assistant_quota_advisory_states_assistant_id_channel_external_thread_key_delivered_at_idx"
  ON "assistant_quota_advisory_states"("assistant_id", "channel", "external_thread_key", "delivered_at" DESC);

CREATE INDEX "assistant_quota_advisory_states_workspace_id_delivered_at_idx"
  ON "assistant_quota_advisory_states"("workspace_id", "delivered_at" DESC);
