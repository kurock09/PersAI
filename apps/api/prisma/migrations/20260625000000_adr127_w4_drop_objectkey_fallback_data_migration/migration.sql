-- ADR-127 W4 — one-shot data migration: rename objectKey → storagePath in
-- assistant_media_jobs.request_json[].attachments[].
--
-- Gate for the isAttachmentRef validator cleanup in the same wave:
-- any in-flight jobs whose request_json.attachments[] still carry the pre-v3
-- "objectKey" field (instead of "storagePath") are rewritten here before the
-- validator fallback is removed. The UPDATE is idempotent: rows whose
-- attachments already carry "storagePath" (or carry no "objectKey") are
-- untouched. An empty production set is a valid no-op.
--
-- The outer WHERE clause skips rows that have no "attachments" key, have a
-- non-array "attachments" value, or have no element that needs renaming —
-- making this safe to run repeatedly without double-processing.

UPDATE assistant_media_jobs
SET request_json = jsonb_set(
  request_json,
  '{attachments}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE
          WHEN att ? 'storagePath' THEN att
          WHEN att ? 'objectKey'   THEN (att - 'objectKey') || jsonb_build_object('storagePath', att->>'objectKey')
          ELSE att
        END
      )
      FROM jsonb_array_elements(request_json->'attachments') AS att
    ),
    '[]'::jsonb
  )
)
WHERE request_json ? 'attachments'
  AND jsonb_typeof(request_json->'attachments') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(request_json->'attachments') AS att
    WHERE att ? 'objectKey' AND NOT (att ? 'storagePath')
  );
