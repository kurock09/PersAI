-- ADR-088 Semantic channel enum extension
-- Adds two semantic (non-adapter) channel values to NotificationChannelType:
--   user_preferred  → resolved at delivery time from assistant.preferredNotificationChannel
--   current_thread  → resolved at delivery time from intent.surface + intent.chatId
-- These values are never stored in notification_channel_registry (no adapter exists for them).
-- The delivery worker expands them before adapter selection.

ALTER TYPE "NotificationChannelType" ADD VALUE IF NOT EXISTS 'user_preferred';
ALTER TYPE "NotificationChannelType" ADD VALUE IF NOT EXISTS 'current_thread';

-- Update policy defaults for user-facing notification sources.
-- These rows are upserted so a fresh install (no rows yet) and an existing install
-- (rows from earlier migrations) both reach the target state.

INSERT INTO "notification_policies" (id, source, enabled, channels, cooldown_minutes, max_per_day,
  escalation_after_minutes, escalation_channel, respect_quiet_hours, render_strategy,
  render_instruction_ref, template_id, config, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'idle_reengagement', false, ARRAY['user_preferred']::text[], 1440, NULL,
   NULL, 'web_notification_center', true, 'grounded_llm', NULL, NULL,
   '{"idleHours":24}'::jsonb, now(), now()),
  (gen_random_uuid(), 'quota_advisory', true, ARRAY['current_thread']::text[], 60, NULL,
   NULL, NULL, false, 'grounded_llm', NULL, NULL, '{}'::jsonb, now(), now()),
  (gen_random_uuid(), 'reminder', true, ARRAY['user_preferred']::text[], NULL, NULL,
   NULL, 'web_notification_center', false, 'grounded_llm', NULL, NULL, '{}'::jsonb, now(), now()),
  (gen_random_uuid(), 'background_task_push', true, ARRAY['user_preferred']::text[], NULL, NULL,
   NULL, 'web_notification_center', false, 'grounded_llm', NULL, NULL, '{}'::jsonb, now(), now()),
  (gen_random_uuid(), 'billing_lifecycle', true, ARRAY['email']::text[], NULL, NULL,
   NULL, 'admin_webhook', false, 'template', NULL, NULL,
   '{"assistantPushEnabled":false,"rules":{"trial_ending":{"enabled":true,"offsetDays":3},"trial_expired":{"enabled":true,"offsetDays":null},"renewal_failed":{"enabled":true,"offsetDays":null},"grace_ending":{"enabled":true,"offsetDays":1},"grace_expired":{"enabled":true,"offsetDays":null},"payment_recovered":{"enabled":true,"offsetDays":null}}}'::jsonb,
   now(), now()),
  (gen_random_uuid(), 'system_event', false, ARRAY['admin_webhook']::text[], NULL, NULL,
   NULL, NULL, false, 'static_fallback', NULL, NULL, '{}'::jsonb, now(), now()),
  (gen_random_uuid(), 'admin_system', true, ARRAY['admin_webhook']::text[], NULL, NULL,
   NULL, NULL, false, 'template', NULL, NULL, '{}'::jsonb, now(), now())
ON CONFLICT (source) DO UPDATE SET
  channels          = EXCLUDED.channels,
  escalation_channel = EXCLUDED.escalation_channel,
  updated_at        = now();
