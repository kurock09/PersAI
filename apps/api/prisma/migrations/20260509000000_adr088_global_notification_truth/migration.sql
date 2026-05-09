-- ADR-088 Multi-user correction: move notification singleton tables to global truth.
-- notification_channel_registry, notification_policies, notification_quiet_hours
-- become global singletons with no workspace_id column.
--
-- Safety contract:
--   1. If per-workspace config divergence is detected for any channel or source,
--      the migration ABORTS with RAISE EXCEPTION (operator must reconcile manually).
--   2. If all per-workspace rows are identical (the expected state from seed loop),
--      the migration aggregates to one global row per channel/source.
--   3. Idempotent: re-running on an already-migrated schema is a no-op.
--
-- ORDERING NOTE: DELETE + INSERT must happen BEFORE adding UNIQUE constraints.
--   With workspace_id still present, each channel_type/source has one row per workspace.
--   Adding UNIQUE(channel_type) before deduplication would fail with 23505.
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  divergence_count INT;
BEGIN
  -- ── Step 1: Check for config divergence in notification_channel_registry ────
  -- Skip if workspace_id column no longer exists (idempotency guard).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_channel_registry'
      AND column_name = 'workspace_id'
  ) THEN
    SELECT COUNT(*) INTO divergence_count
    FROM (
      SELECT channel_type,
             COUNT(DISTINCT config::text) AS distinct_configs,
             COUNT(DISTINCT enabled::text) AS distinct_enabled
      FROM notification_channel_registry
      GROUP BY channel_type
      HAVING COUNT(DISTINCT config::text) > 1
          OR COUNT(DISTINCT enabled::text) > 1
    ) sub;

    IF divergence_count > 0 THEN
      RAISE EXCEPTION
        'ADR-088 migration aborted: notification_channel_registry has diverging per-workspace configs for % channel type(s). Reconcile manually before running this migration.',
        divergence_count;
    END IF;
  END IF;

  -- ── Step 2: Check for config divergence in notification_policies ────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_policies'
      AND column_name = 'workspace_id'
  ) THEN
    SELECT COUNT(*) INTO divergence_count
    FROM (
      SELECT source,
             COUNT(DISTINCT (channels::text || enabled::text || COALESCE(config::text, ''))) AS distinct_configs
      FROM notification_policies
      GROUP BY source
      HAVING COUNT(DISTINCT (channels::text || enabled::text || COALESCE(config::text, ''))) > 1
    ) sub;

    IF divergence_count > 0 THEN
      RAISE EXCEPTION
        'ADR-088 migration aborted: notification_policies has diverging per-workspace configs for % source(s). Reconcile manually before running this migration.',
        divergence_count;
    END IF;
  END IF;
END $$;

-- ── Step 3: Migrate notification_channel_registry to global singleton ────────
-- Skip if already migrated (workspace_id column gone).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_channel_registry'
      AND column_name = 'workspace_id'
  ) THEN
    -- Create a temp global table with one row per channel_type (pick first workspace's data).
    CREATE TEMP TABLE _ncr_global AS
    SELECT DISTINCT ON (channel_type)
      gen_random_uuid() AS new_id,
      channel_type,
      enabled,
      config,
      health_status,
      consecutive_failures,
      last_delivery_at,
      last_failure_at,
      created_at,
      updated_at
    FROM notification_channel_registry
    ORDER BY channel_type, created_at ASC;

    -- Drop all constraints that reference workspace_id.
    ALTER TABLE notification_channel_registry DROP CONSTRAINT IF EXISTS "notification_channel_registry_workspace_id_channel_type_key";
    ALTER TABLE notification_channel_registry DROP CONSTRAINT IF EXISTS "notification_channel_registry_workspace_id_fkey";

    -- Drop the workspace_id column.
    ALTER TABLE notification_channel_registry DROP COLUMN IF EXISTS workspace_id;

    -- Deduplicate FIRST: remove all existing rows and insert one global row per channel_type.
    -- UNIQUE constraint is added AFTER this step to avoid 23505 on duplicate channel_type values.
    DELETE FROM notification_channel_registry;
    INSERT INTO notification_channel_registry (id, channel_type, enabled, config, health_status, consecutive_failures, last_delivery_at, last_failure_at, created_at, updated_at)
    SELECT new_id, channel_type, enabled, config, health_status, consecutive_failures, last_delivery_at, last_failure_at, created_at, updated_at
    FROM _ncr_global;

    DROP TABLE _ncr_global;

    -- Add unique constraint on channel_type alone AFTER deduplication.
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'notification_channel_registry'
          AND indexname = 'notification_channel_registry_channel_type_key'
      ) THEN
        ALTER TABLE notification_channel_registry ADD CONSTRAINT "notification_channel_registry_channel_type_key" UNIQUE (channel_type);
      END IF;
    END $inner$;
  END IF;
END $$;

-- ── Step 4: Migrate notification_policies to global singleton ─────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_policies'
      AND column_name = 'workspace_id'
  ) THEN
    -- Create temp global table with one row per source.
    CREATE TEMP TABLE _np_global AS
    SELECT DISTINCT ON (source)
      gen_random_uuid() AS new_id,
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
    FROM notification_policies
    ORDER BY source, created_at ASC;

    -- Drop per-workspace unique index and FK.
    ALTER TABLE notification_policies DROP CONSTRAINT IF EXISTS "notification_policies_workspace_id_source_key";
    ALTER TABLE notification_policies DROP CONSTRAINT IF EXISTS "notification_policies_workspace_id_fkey";

    -- Drop the workspace_id column.
    ALTER TABLE notification_policies DROP COLUMN IF EXISTS workspace_id;

    -- Deduplicate FIRST: remove all existing rows and insert one global row per source.
    DELETE FROM notification_policies;
    INSERT INTO notification_policies (id, source, enabled, channels, cooldown_minutes, max_per_day, escalation_after_minutes, escalation_channel, respect_quiet_hours, render_strategy, render_instruction_ref, template_id, config, created_at, updated_at)
    SELECT new_id, source, enabled, channels, cooldown_minutes, max_per_day, escalation_after_minutes, escalation_channel, respect_quiet_hours, render_strategy, render_instruction_ref, template_id, config, created_at, updated_at
    FROM _np_global;

    DROP TABLE _np_global;

    -- Add unique constraint on source alone AFTER deduplication.
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'notification_policies'
          AND indexname = 'notification_policies_source_key'
      ) THEN
        ALTER TABLE notification_policies ADD CONSTRAINT "notification_policies_source_key" UNIQUE (source);
      END IF;
    END $inner$;
  END IF;
END $$;

-- ── Step 5: Migrate notification_quiet_hours to global singleton ──────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_quiet_hours'
      AND column_name = 'workspace_id'
  ) THEN
    -- Capture the first (and likely only) quiet hours row.
    CREATE TEMP TABLE _nqh_global AS
    SELECT
      gen_random_uuid() AS new_id,
      enabled,
      start_local,
      end_local,
      timezone_mode,
      default_timezone,
      applies_to_sources,
      created_at,
      updated_at
    FROM notification_quiet_hours
    ORDER BY created_at ASC
    LIMIT 1;

    -- Drop FK and unique index on workspace_id.
    ALTER TABLE notification_quiet_hours DROP CONSTRAINT IF EXISTS "notification_quiet_hours_workspace_id_key";
    ALTER TABLE notification_quiet_hours DROP CONSTRAINT IF EXISTS "notification_quiet_hours_workspace_id_fkey";

    -- Drop workspace_id column.
    ALTER TABLE notification_quiet_hours DROP COLUMN IF EXISTS workspace_id;

    -- Add singleton boolean column (TRUE enforces single row via DEFAULT).
    ALTER TABLE notification_quiet_hours ADD COLUMN IF NOT EXISTS singleton BOOLEAN NOT NULL DEFAULT TRUE;

    -- Deduplicate FIRST: remove all rows and insert exactly one global row.
    -- UNIQUE(singleton) is added AFTER this step so we don't hit 23505 from DEFAULT TRUE on many rows.
    DELETE FROM notification_quiet_hours;
    INSERT INTO notification_quiet_hours (id, singleton, enabled, start_local, end_local, timezone_mode, default_timezone, applies_to_sources, created_at, updated_at)
    SELECT new_id, TRUE, enabled, start_local, end_local, timezone_mode, default_timezone, applies_to_sources, created_at, updated_at
    FROM _nqh_global;

    DROP TABLE _nqh_global;

    -- Add unique constraint on singleton AFTER repopulation (exactly one row exists now).
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'notification_quiet_hours'
          AND indexname = 'notification_quiet_hours_singleton_key'
      ) THEN
        ALTER TABLE notification_quiet_hours ADD CONSTRAINT "notification_quiet_hours_singleton_key" UNIQUE (singleton);
      END IF;
    END $inner$;
  END IF;
END $$;

-- ── Step 6: Add index on notification_intents for admin delivery history ──────
-- (workspaceId, createdAt DESC) for efficient per-workspace delivery history queries.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'notification_intents'
      AND indexname = 'notification_intents_workspace_created_idx'
  ) THEN
    CREATE INDEX notification_intents_workspace_created_idx
      ON notification_intents (workspace_id, created_at DESC);
  END IF;
END $$;
