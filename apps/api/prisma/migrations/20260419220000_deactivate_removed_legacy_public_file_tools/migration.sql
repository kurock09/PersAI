-- Clean Step 20 public tool catalog truth.
-- Removed legacy public split file-tool rows should stay inactive in current DB truth.

UPDATE "tool_catalog_tools"
SET "status" = 'inactive',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN ('read_file', 'write_file', 'edit_file', 'send_media_to_user')
  AND "status" = 'active';
