-- Rename tool catalog codes to match OpenClaw tool names
UPDATE "tool_catalog_tools" SET "code" = 'memory_get', "display_name" = 'Memory Get', "description" = 'Safe snippet read from memory files with optional offset/lines.' WHERE "code" = 'memory_center_read';
UPDATE "tool_catalog_tools" SET "code" = 'cron', "display_name" = 'Cron', "description" = 'Manage gateway cron jobs and send wake events.' WHERE "code" = 'tasks_center_control';

-- Rename tool codes in daily usage counters (plain string column, no FK)
UPDATE "workspace_tool_usage_daily_counters" SET "tool_code" = 'memory_get' WHERE "tool_code" = 'memory_center_read';
UPDATE "workspace_tool_usage_daily_counters" SET "tool_code" = 'cron' WHERE "tool_code" = 'tasks_center_control';
