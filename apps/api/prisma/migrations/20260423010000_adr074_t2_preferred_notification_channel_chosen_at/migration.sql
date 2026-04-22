-- ADR-074 Slice T2 — Auto-route T1 pushes to first-bound notification channel.
--
-- Adds the `preferred_notification_channel_chosen_at` "D-marker" column to
-- `assistants` so the new `AutoSelectNotificationChannelOnBindService` helper
-- can distinguish between:
--
--   * "Still on the `web` default — never explicitly chosen" (NULL)
--   * "User has actively picked a channel; do not auto-override" (non-NULL)
--
-- Per Slice T2 decision Q2-D: every successful manual preference update via
-- the Settings UI writes this timestamp, and the first auto-set on a fresh
-- non-web-channel bind also writes it. Once non-NULL, the auto-set helper
-- treats the choice as binding and is a no-op.
--
-- Per Slice T2 decision Q7-B: this same migration performs a one-time
-- backfill so existing assistants that already have a fully-claimed Telegram
-- owner binding (i.e. `metadata.telegramDmChatId` is populated) but still
-- sit on the `web` default get promoted to `telegram` immediately on
-- rollout. Without this backfill the founder (and any early TG-bound user)
-- would have to manually re-pick `Telegram` in Settings to start receiving
-- T1 audience="user" pushes through the existing
-- `tryDeliverReminderToTelegram` path.
--
-- Idempotent by construction: the backfill `WHERE` clause filters
-- `chosen_at IS NULL`, so re-running the migration (e.g. on api-migrate pod
-- restart) is a no-op. The `metadata->>'telegramDmChatId' IS NOT NULL`
-- guard prevents promoting an assistant whose claim is mid-flight and lacks
-- the DM target metadata required by `tryDeliverReminderToTelegram`.
--
-- Reversible: drop the column. Backfill cannot be undone (and should not
-- need to be) because the migration only flips assistants that had no
-- explicit preference recorded.

-- AlterTable: add the D-marker column (nullable, no index — read together
-- with the row).
ALTER TABLE "assistants"
  ADD COLUMN "preferred_notification_channel_chosen_at" TIMESTAMPTZ(6);

-- One-time backfill: promote currently-TG-bound-but-still-on-web-default
-- assistants to `telegram` so T1 audience="user" pushes start routing
-- through `DeliverReminderNotificationService.tryDeliverReminderToTelegram`
-- on the next scheduled run after rollout.
UPDATE "assistants" a
SET
  "preferred_notification_channel" = 'telegram',
  "preferred_notification_channel_chosen_at" = NOW()
WHERE a."preferred_notification_channel_chosen_at" IS NULL
  AND a."preferred_notification_channel" = 'web'
  AND EXISTS (
    SELECT 1
    FROM "assistant_channel_surface_bindings" b
    WHERE b."assistant_id" = a."id"
      AND b."provider_key" = 'telegram'
      AND b."surface_type" = 'telegram_bot'
      AND b."binding_state" = 'active'
      AND b."metadata"->>'telegramDmChatId' IS NOT NULL
  );
