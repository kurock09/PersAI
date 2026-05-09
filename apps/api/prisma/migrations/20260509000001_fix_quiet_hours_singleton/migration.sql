-- Repair migration: add singleton column to notification_quiet_hours if missing.
-- This handles the case where the first attempt of 20260509000000 dropped workspace_id
-- but was rolled back before ADD COLUMN singleton could execute, leaving the table
-- in a half-migrated state (no workspace_id, no singleton).

-- Step 1: Add singleton column if it doesn't exist yet.
ALTER TABLE notification_quiet_hours ADD COLUMN IF NOT EXISTS singleton BOOLEAN NOT NULL DEFAULT TRUE;

-- Step 2: Add unique constraint on singleton if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'notification_quiet_hours'
      AND indexname = 'notification_quiet_hours_singleton_key'
  ) THEN
    ALTER TABLE notification_quiet_hours ADD CONSTRAINT "notification_quiet_hours_singleton_key" UNIQUE (singleton);
  END IF;
END $$;

-- Step 3: Ensure data integrity — exactly one row with singleton = TRUE.
-- If table is empty, insert a default row. If multiple rows exist, keep only the earliest.
DO $$
DECLARE
  row_count INT;
BEGIN
  SELECT COUNT(*) INTO row_count FROM notification_quiet_hours;

  IF row_count = 0 THEN
    -- No rows at all: insert a safe default.
    INSERT INTO notification_quiet_hours (id, singleton, enabled, start_local, end_local, timezone_mode, applies_to_sources, created_at, updated_at)
    VALUES (gen_random_uuid(), TRUE, FALSE, '22:00', '08:00', 'workspace_default', '{}', NOW(), NOW());
  ELSIF row_count > 1 THEN
    -- Multiple rows: delete all except the first by created_at.
    DELETE FROM notification_quiet_hours
    WHERE id NOT IN (
      SELECT id FROM notification_quiet_hours ORDER BY created_at ASC LIMIT 1
    );
    UPDATE notification_quiet_hours SET singleton = TRUE;
  ELSE
    -- Exactly one row: ensure singleton flag is set.
    UPDATE notification_quiet_hours SET singleton = TRUE;
  END IF;
END $$;
