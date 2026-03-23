-- CreateTable
CREATE TABLE "assistant_audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "assistant_id" UUID,
    "actor_user_id" UUID,
    "event_category" VARCHAR(64) NOT NULL,
    "event_code" VARCHAR(128) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL DEFAULT 'succeeded',
    "summary" VARCHAR(255) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_audit_events_assistant_id_created_at_idx"
ON "assistant_audit_events" ("assistant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_audit_events_workspace_id_created_at_idx"
ON "assistant_audit_events" ("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_audit_events_event_category_created_at_idx"
ON "assistant_audit_events" ("event_category", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "assistant_audit_events"
ADD CONSTRAINT "assistant_audit_events_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_audit_events"
ADD CONSTRAINT "assistant_audit_events_assistant_id_fkey"
FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_audit_events"
ADD CONSTRAINT "assistant_audit_events_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateFunction
CREATE OR REPLACE FUNCTION reject_assistant_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'assistant_audit_events rows are append-only';
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER assistant_audit_events_no_update
BEFORE UPDATE ON "assistant_audit_events"
FOR EACH ROW
EXECUTE FUNCTION reject_assistant_audit_event_mutation();

-- CreateTrigger
CREATE TRIGGER assistant_audit_events_no_delete
BEFORE DELETE ON "assistant_audit_events"
FOR EACH ROW
EXECUTE FUNCTION reject_assistant_audit_event_mutation();
