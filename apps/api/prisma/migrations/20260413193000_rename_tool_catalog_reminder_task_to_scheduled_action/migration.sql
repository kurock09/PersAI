-- Hard-rename the persisted reminder_task tool catalog entry to scheduled_action.
-- This preserves the existing tool row id so plan activations keep pointing at
-- the same tool record, and it also migrates daily quota counters to the new
-- tool code without double-counting.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tool_catalog_tools') THEN
    IF EXISTS (SELECT 1 FROM "tool_catalog_tools" WHERE "code" = 'reminder_task')
      AND NOT EXISTS (SELECT 1 FROM "tool_catalog_tools" WHERE "code" = 'scheduled_action') THEN
      UPDATE "tool_catalog_tools"
      SET
        "code" = 'scheduled_action',
        "display_name" = 'Scheduled Action',
        "description" = 'Schedule actions for both user-visible reminders and hidden assistant follow-ups.'
      WHERE "code" = 'reminder_task';
    END IF;

    UPDATE "tool_catalog_tools"
    SET
      "display_name" = 'Scheduled Action',
      "description" = 'Schedule actions for both user-visible reminders and hidden assistant follow-ups.'
    WHERE "code" = 'scheduled_action';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'workspace_tool_usage_daily_counters'
  ) THEN
    INSERT INTO "workspace_tool_usage_daily_counters" (
      "workspace_id",
      "tool_code",
      "date",
      "call_count",
      "created_at",
      "updated_at"
    )
    SELECT
      "workspace_id",
      'scheduled_action',
      "date",
      SUM("call_count"),
      MIN("created_at"),
      MAX("updated_at")
    FROM "workspace_tool_usage_daily_counters"
    WHERE "tool_code" IN ('reminder_task', 'scheduled_action')
    GROUP BY "workspace_id", "date"
    ON CONFLICT ("workspace_id", "tool_code", "date")
    DO UPDATE SET
      "call_count" = EXCLUDED."call_count",
      "created_at" = LEAST(
        "workspace_tool_usage_daily_counters"."created_at",
        EXCLUDED."created_at"
      ),
      "updated_at" = GREATEST(
        "workspace_tool_usage_daily_counters"."updated_at",
        EXCLUDED."updated_at"
      );

    DELETE FROM "workspace_tool_usage_daily_counters"
    WHERE "tool_code" = 'reminder_task';
  END IF;
END $$;
