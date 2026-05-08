-- ADR-088 Slice 3: Transactional migration
-- 1. Seed notification_policies for billing_lifecycle per workspace
-- 2. Strip notification policy fields from billing_lifecycle_settings.metadata
-- 3. Fix reminder policy respectQuietHours (Slice 2 carry-over)
-- 4. Drop billing_lifecycle_notification_jobs table
-- 5. Drop legacy enums

-- Step 1: Create one notification_policies row per workspace for billing_lifecycle.
-- Config carries per-rule sub-policy (new canonical shape for this source).
-- ON CONFLICT DO NOTHING: safe to re-run; existing rows stay unchanged.
INSERT INTO notification_policies (
  id,
  workspace_id,
  source,
  enabled,
  channels,
  cooldown_minutes,
  max_per_day,
  escalation_after_minutes,
  escalation_channel,
  respect_quiet_hours,
  render_strategy,
  render_instruction_ref,
  template_id,
  config,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  w.id,
  'billing_lifecycle',
  true,
  ARRAY['email'],
  NULL,
  NULL,
  NULL,
  NULL,
  false,
  'template',
  NULL,
  NULL,
  COALESCE(
    (
      SELECT
        jsonb_build_object(
          'assistantPushEnabled',
          COALESCE((bls.metadata -> 'notificationPolicy' ->> 'assistantPushEnabled')::boolean, false),
          'rules',
          jsonb_build_object(
            'trial_ending',   jsonb_build_object('enabled', true, 'offsetDays', 3),
            'trial_expired',  jsonb_build_object('enabled', true, 'offsetDays', null::text::jsonb),
            'renewal_failed', jsonb_build_object('enabled', true, 'offsetDays', null::text::jsonb),
            'grace_ending',   jsonb_build_object('enabled', true, 'offsetDays', 1),
            'grace_expired',  jsonb_build_object('enabled', true, 'offsetDays', null::text::jsonb),
            'payment_recovered', jsonb_build_object('enabled', true, 'offsetDays', null::text::jsonb)
          )
        )
      FROM billing_lifecycle_settings bls
      WHERE bls.id = 'global'
    ),
    '{
      "assistantPushEnabled": false,
      "rules": {
        "trial_ending":      {"enabled": true, "offsetDays": 3},
        "trial_expired":     {"enabled": true, "offsetDays": null},
        "renewal_failed":    {"enabled": true, "offsetDays": null},
        "grace_ending":      {"enabled": true, "offsetDays": 1},
        "grace_expired":     {"enabled": true, "offsetDays": null},
        "payment_recovered": {"enabled": true, "offsetDays": null}
      }
    }'::jsonb
  ),
  NOW(),
  NOW()
FROM workspaces w
ON CONFLICT (workspace_id, source) DO NOTHING;

-- Step 2: Remove notification-policy fields from billing_lifecycle_settings.metadata.
-- The notification policy is now owned by notification_policies; metadata keeps only
-- gracePeriodDays / globalFallbackPlanCode governance fields.
UPDATE billing_lifecycle_settings
SET metadata = (metadata::jsonb - 'notificationPolicy')
WHERE metadata::jsonb ? 'notificationPolicy';

-- Step 3: Fix reminder notification_policies row: respectQuietHours must be false
-- (ADR §6 — reminders opt out of quiet hours; Slice 2 per-intent override was correct,
-- now the policy row itself is corrected).
UPDATE notification_policies
SET respect_quiet_hours = false
WHERE source = 'reminder';

-- Step 4: Drop the legacy billing lifecycle notification jobs table.
-- All billing notifications now flow through notification_intents.
-- ADR-088 §13 — no legacy table survives past the slice that absorbs it.
DROP TABLE IF EXISTS billing_lifecycle_notification_jobs CASCADE;

-- Step 5: Drop legacy enum types (orphaned after table drop).
DROP TYPE IF EXISTS "BillingLifecycleNotificationChannel";
DROP TYPE IF EXISTS "BillingLifecycleNotificationJobStatus";
