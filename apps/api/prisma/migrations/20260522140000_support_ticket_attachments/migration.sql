-- Support ticket image attachments + per-user read cursor for unread indicators.

ALTER TABLE "support_tickets"
ADD COLUMN IF NOT EXISTS "user_last_read_at" TIMESTAMPTZ(6);

CREATE TABLE "support_ticket_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "file_name" VARCHAR(255),
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_ticket_attachments_message_id_created_at_idx"
ON "support_ticket_attachments"("message_id", "created_at" ASC);

ALTER TABLE "support_ticket_attachments"
ADD CONSTRAINT "support_ticket_attachments_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "support_ticket_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
