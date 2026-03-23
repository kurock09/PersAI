-- D3: ensure memory_control documents carry explicit trusted 1:1 write list and sourceClassification for policy evaluation

UPDATE "assistant_governance"
SET "memory_control" = jsonb_set(
  "memory_control",
  '{policy,trustedOneToOneGlobalWriteSurfaces}',
  COALESCE(
    "memory_control"#>'{policy,trustedOneToOneGlobalWriteSurfaces}',
    "memory_control"#>'{policy,allowedGlobalWriteSurfaces}',
    '["web"]'::jsonb
  ),
  true
)
WHERE "memory_control" IS NOT NULL
  AND (
    ("memory_control"->'policy'->'trustedOneToOneGlobalWriteSurfaces') IS NULL
    OR jsonb_typeof("memory_control"->'policy'->'trustedOneToOneGlobalWriteSurfaces') = 'null'
  );

UPDATE "assistant_governance"
SET "memory_control" = jsonb_set(
  "memory_control",
  '{sourceClassification}',
  COALESCE(
    "memory_control"->'sourceClassification',
    '{"schemaVersion":1,"globalWriteRequiresTrust":"trusted_1to1","groupSourcedGlobalWriteClass":"group","trustedDirectThreadClass":"trusted_1to1"}'::jsonb
  ),
  true
)
WHERE "memory_control" IS NOT NULL
  AND (
    ("memory_control"->'sourceClassification') IS NULL
    OR jsonb_typeof("memory_control"->'sourceClassification') = 'null'
  );
