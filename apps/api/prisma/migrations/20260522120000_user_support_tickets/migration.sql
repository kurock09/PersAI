-- User support tickets + user_support notification source

CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'pending', 'answered', 'closed');
CREATE TYPE "SupportTicketMessageAuthor" AS ENUM ('user', 'admin', 'system');

ALTER TYPE "NotificationSource" ADD VALUE IF NOT EXISTS 'user_support';

CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "assistant_id" UUID NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
    "subject" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "answered_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "author" "SupportTicketMessageAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "admin_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_user_id_assistant_id_created_at_idx" ON "support_tickets"("user_id", "assistant_id", "created_at" DESC);
CREATE INDEX "support_tickets_status_updated_at_idx" ON "support_tickets"("status", "updated_at" DESC);
CREATE INDEX "support_tickets_workspace_id_created_at_idx" ON "support_tickets"("workspace_id", "created_at" DESC);
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at" ASC);

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "notification_policies" (
    "id",
    "source",
    "class",
    "enabled",
    "channels",
    "cooldown_minutes",
    "max_per_day",
    "escalation_after_minutes",
    "escalation_channel",
    "respect_quiet_hours",
    "render_strategy",
    "render_instruction_ref",
    "template_id",
    "config",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    'user_support',
    'transactional',
    true,
    ARRAY['email', 'user_preferred']::"NotificationChannelType"[],
    NULL,
    NULL,
    NULL,
    'web_notification_center',
    false,
    'template',
    NULL,
    'support.reply',
    '{"assistantPushEnabled":true}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "notification_policies" WHERE "source" = 'user_support'
);
