CREATE TABLE "model_cost_ledger_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "assistant_id" UUID,
    "user_id" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(256) NOT NULL,
    "capability" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "surface" VARCHAR(64) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "billing_mode" VARCHAR(64) NOT NULL,
    "raw_usage" JSONB NOT NULL,
    "actual_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "price_catalog_version" VARCHAR(128) NOT NULL,
    "price_catalog_snapshot" JSONB NOT NULL,
    "source_event_id" VARCHAR(128),
    "request_correlation_id" VARCHAR(128),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_cost_ledger_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "model_cost_ledger_events_workspace_id_occurred_at_idx"
    ON "model_cost_ledger_events"("workspace_id", "occurred_at" DESC);

CREATE INDEX "model_cost_ledger_events_workspace_id_purpose_occurred_at_idx"
    ON "model_cost_ledger_events"("workspace_id", "purpose", "occurred_at" DESC);

CREATE INDEX "model_cost_ledger_events_provider_model_occurred_at_idx"
    ON "model_cost_ledger_events"("provider", "model", "occurred_at" DESC);

ALTER TABLE "assistant_chat_message_attachments"
    ADD COLUMN "billing_facts_json" JSONB;

ALTER TABLE "assistant_media_jobs"
    ADD COLUMN "billing_facts_json" JSONB;
