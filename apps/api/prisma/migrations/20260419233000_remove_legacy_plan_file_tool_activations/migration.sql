-- Clean Step 20 plan activation truth.
-- Historical split file-tool activations must not survive in admin plan projections.

DELETE FROM "plan_catalog_tool_activations" AS activation
USING "tool_catalog_tools" AS tool
WHERE activation."tool_id" = tool."id"
  AND tool."code" IN ('read_file', 'write_file', 'edit_file', 'send_media_to_user');
