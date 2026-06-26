-- ADR-128 follow-up: full-size image processing in the sandbox must not kill
-- the session pod. Existing plan sandbox policies were stored with a 256 MiB
-- memory cap, which is too low for ordinary 3000x4000 Pillow batches.
--
-- Keep operator overrides that are already higher than 1 GiB.
WITH updated_plans AS (
  UPDATE "plan_catalog_plans"
  SET "billing_provider_hints" = jsonb_set(
    "billing_provider_hints"::jsonb,
    '{sandboxPolicy,maxMemoryBytesPerJob}',
    to_jsonb(1073741824),
    true
  )
  WHERE "billing_provider_hints" IS NOT NULL
    AND jsonb_typeof("billing_provider_hints"::jsonb -> 'sandboxPolicy') = 'object'
    AND (
      "billing_provider_hints"::jsonb #>> '{sandboxPolicy,maxMemoryBytesPerJob}' IS NULL
      OR (
        "billing_provider_hints"::jsonb #>> '{sandboxPolicy,maxMemoryBytesPerJob}' ~ '^[0-9]+$'
        AND ("billing_provider_hints"::jsonb #>> '{sandboxPolicy,maxMemoryBytesPerJob}')::bigint < 1073741824
      )
    )
  RETURNING 1
)
UPDATE "platform_config_generations"
SET "generation" = "generation" + 1,
    "updated_at" = NOW()
WHERE "id" = 'global'
  AND EXISTS (SELECT 1 FROM updated_plans);
