-- ADR-088: Unified notification platform – Slice 2 conversational migration
-- Migrates workspace_notification_policies → notification_policies.
-- Drops legacy tables: assistant_notification_outbox, assistant_quota_advisory_states,
--   workspace_notification_policies.
-- Drops legacy columns: notification_outbox_id (assistant_background_task_runs),
--   assistant_notification_outbox_id (billing_lifecycle_notification_jobs).
-- Removes whatsapp from AssistantPreferredNotificationChannel.
-- Drops legacy enums: AssistantNotificationOutboxSource, AssistantNotificationOutboxStatus,
--   WorkspaceNotificationPolicySource.

-- ── Step 1: Data-migrate workspace_notification_policies → notification_policies ──────────────

-- idle_reengagement: map idleHours/cooldownHours/llmInstruction into config JSONB
INSERT INTO "notification_policies" (
  "id",
  "workspace_id",
  "source",
  "enabled",
  "channels",
  "cooldown_minutes",
  "max_per_day",
  "escalation_after_minutes",
  "escalation_channel",
  "respect_quiet_hours",
  "render_strategy",
  "render_instruction_ref",
  "config",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  "workspace_id",
  'idle_reengagement'::"NotificationSource",
  "enabled",
  ARRAY['telegram_thread', 'web_notification_center']::TEXT[],
  "cooldown_hours" * 60,
  NULL,
  NULL,
  NULL,
  true,
  'grounded_llm'::"NotificationRenderStrategy",
  NULL,
  jsonb_build_object(
    'llmInstruction', "llm_instruction",
    'idleHours',      "idle_hours",
    'cooldownHours',  "cooldown_hours"
  ),
  "created_at",
  "updated_at"
FROM "workspace_notification_policies"
WHERE "source" = 'idle_reengagement'
ON CONFLICT ("workspace_id", "source") DO UPDATE SET
  "enabled"           = EXCLUDED."enabled",
  "cooldown_minutes"  = EXCLUDED."cooldown_minutes",
  "config"            = EXCLUDED."config",
  "updated_at"        = EXCLUDED."updated_at";

-- quota_advisory: map llmInstruction into config JSONB
INSERT INTO "notification_policies" (
  "id",
  "workspace_id",
  "source",
  "enabled",
  "channels",
  "cooldown_minutes",
  "max_per_day",
  "escalation_after_minutes",
  "escalation_channel",
  "respect_quiet_hours",
  "render_strategy",
  "render_instruction_ref",
  "config",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  "workspace_id",
  'quota_advisory'::"NotificationSource",
  "enabled",
  ARRAY['telegram_thread', 'web_thread']::TEXT[],
  NULL,
  NULL,
  NULL,
  NULL,
  false,
  'grounded_llm'::"NotificationRenderStrategy",
  NULL,
  jsonb_build_object('llmInstruction', "llm_instruction"),
  "created_at",
  "updated_at"
FROM "workspace_notification_policies"
WHERE "source" = 'quota_advisory'
ON CONFLICT ("workspace_id", "source") DO UPDATE SET
  "enabled"    = EXCLUDED."enabled",
  "config"     = EXCLUDED."config",
  "updated_at" = EXCLUDED."updated_at";

-- ── Step 2: Drop legacy columns (before dropping tables they reference) ────────────────────────

-- notification_outbox_id on assistant_background_task_runs (plain UUID ref, no FK constraint)
ALTER TABLE "assistant_background_task_runs"
  DROP COLUMN IF EXISTS "notification_outbox_id";

-- assistant_notification_outbox_id on billing_lifecycle_notification_jobs (plain UUID ref, no FK constraint)
ALTER TABLE "billing_lifecycle_notification_jobs"
  DROP COLUMN IF EXISTS "assistant_notification_outbox_id";

-- ── Step 3: Drop legacy tables (CASCADE removes FK constraints from referencing tables) ─────────

DROP TABLE IF EXISTS "assistant_notification_outbox" CASCADE;
DROP TABLE IF EXISTS "assistant_quota_advisory_states" CASCADE;
DROP TABLE IF EXISTS "workspace_notification_policies" CASCADE;

-- ── Step 4: Remove whatsapp from AssistantPreferredNotificationChannel enum ───────────────────

-- First update any rows that still use whatsapp → web (defensive; no production users yet)
UPDATE "assistants"
  SET "preferred_notification_channel" = 'web'
  WHERE "preferred_notification_channel" = 'whatsapp';

-- Create the new enum without whatsapp
CREATE TYPE "AssistantPreferredNotificationChannel_new" AS ENUM ('web', 'telegram');

-- Migrate the column type
ALTER TABLE "assistants"
  ALTER COLUMN "preferred_notification_channel"
  TYPE "AssistantPreferredNotificationChannel_new"
  USING "preferred_notification_channel"::TEXT::"AssistantPreferredNotificationChannel_new";

-- Drop old enum and rename
DROP TYPE "AssistantPreferredNotificationChannel";
ALTER TYPE "AssistantPreferredNotificationChannel_new"
  RENAME TO "AssistantPreferredNotificationChannel";

-- ── Step 5: Drop legacy enums (now safe since their tables are gone) ───────────────────────────

DROP TYPE IF EXISTS "AssistantNotificationOutboxSource";
DROP TYPE IF EXISTS "AssistantNotificationOutboxStatus";
DROP TYPE IF EXISTS "WorkspaceNotificationPolicySource";
