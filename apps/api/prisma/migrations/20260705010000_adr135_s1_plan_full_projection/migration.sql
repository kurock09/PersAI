-- ADR-135 Slice S1 — per-plan fullProjection boolean for catalog vs full tool wire projection.
--
-- Backfill uses D2 platform defaults (13 full / 11 catalog) on runtime model-visible
-- tool codes. Non-D2 catalog rows default to full projection.

ALTER TABLE "plan_catalog_tool_activations"
  ADD COLUMN "full_projection" BOOLEAN;

UPDATE "plan_catalog_tool_activations" AS pcta
SET "full_projection" = CASE t.code
  WHEN 'skill' THEN TRUE
  WHEN 'todo_write' THEN TRUE
  WHEN 'files' THEN TRUE
  WHEN 'shell' THEN TRUE
  WHEN 'grep' THEN TRUE
  WHEN 'glob' THEN TRUE
  WHEN 'exec' THEN TRUE
  WHEN 'web_search' THEN TRUE
  WHEN 'web_fetch' THEN TRUE
  WHEN 'memory_write' THEN TRUE
  WHEN 'image_edit' THEN TRUE
  WHEN 'image_generate' THEN FALSE
  WHEN 'video_generate' THEN FALSE
  WHEN 'document' THEN FALSE
  WHEN 'presentation' THEN FALSE
  WHEN 'browser' THEN FALSE
  WHEN 'tts' THEN FALSE
  WHEN 'scheduled_action' THEN FALSE
  WHEN 'background_task' THEN FALSE
  WHEN 'persai_tool_quota_status' THEN FALSE
  ELSE TRUE
END
FROM "tool_catalog_tools" AS t
WHERE pcta."tool_id" = t.id;

ALTER TABLE "plan_catalog_tool_activations"
  ALTER COLUMN "full_projection" SET NOT NULL;
