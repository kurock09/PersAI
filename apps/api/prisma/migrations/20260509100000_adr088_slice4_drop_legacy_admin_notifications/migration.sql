-- ADR-088 Slice 4: Drop legacy admin notification tables and enums.
-- Replaces workspace_admin_notification_channels + admin_notification_deliveries
-- with notification_channel_registry rows + notification_delivery_attempts
-- handled by the unified notification platform (AdminWebhookChannelAdapter).
--
-- Order: drop child table first (admin_notification_deliveries has FK → channels),
-- then parent (workspace_admin_notification_channels), then orphaned enums.
-- Also upsert system_event notification_policies row if not present.

-- 1. Drop child table (deliveries reference channels)
DROP TABLE IF EXISTS "admin_notification_deliveries";

-- 2. Drop parent table
DROP TABLE IF EXISTS "workspace_admin_notification_channels";

-- 3. Drop orphaned enums
DROP TYPE IF EXISTS "AdminNotificationDeliveryStatus";
DROP TYPE IF EXISTS "AdminNotificationChannelStatus";
DROP TYPE IF EXISTS "AdminNotificationChannelType";

-- 4. Ensure system_event policy row exists (defaults: enabled=false, admin_webhook channel,
--    static_fallback renderer, respectQuietHours=false).
--    Operator enables it from Admin > Notifications when webhook is configured.
INSERT INTO "notification_policies"
  (id, source, enabled, channels, cooldown_minutes, max_per_day,
   escalation_after_minutes, escalation_channel, respect_quiet_hours,
   render_strategy, render_instruction_ref, template_id, config,
   created_at, updated_at)
VALUES
  (gen_random_uuid(), 'system_event', false, ARRAY['admin_webhook']::text[],
   NULL, NULL, NULL, NULL, false,
   'static_fallback', NULL, NULL, '{}'::jsonb,
   NOW(), NOW())
ON CONFLICT (source) DO NOTHING;
