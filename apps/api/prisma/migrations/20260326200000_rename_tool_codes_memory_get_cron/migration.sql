-- Rename tool catalog codes to match OpenClaw tool names.
-- Wrapped in IF EXISTS because on a fresh DB this migration runs before
-- the table is created (step8_e1); the auto-seed will use the correct names.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tool_catalog_tools') THEN
    UPDATE "tool_catalog_tools" SET "code" = 'memory_get', "display_name" = 'Memory Get', "description" = 'Safe snippet read from memory files with optional offset/lines.' WHERE "code" = 'memory_center_read';
    UPDATE "tool_catalog_tools" SET "code" = 'cron', "display_name" = 'Cron', "description" = 'Manage gateway cron jobs and send wake events.' WHERE "code" = 'tasks_center_control';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workspace_tool_usage_daily_counters') THEN
    UPDATE "workspace_tool_usage_daily_counters" SET "tool_code" = 'memory_get' WHERE "tool_code" = 'memory_center_read';
    UPDATE "workspace_tool_usage_daily_counters" SET "tool_code" = 'cron' WHERE "tool_code" = 'tasks_center_control';
  END IF;
END $$;
