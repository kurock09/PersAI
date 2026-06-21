-- ADR-123 follow-up: open the sandbox delivery MIME allowlist uniformly across
-- every plan so operators never hit a delivery-MIME wall and never have to edit
-- it by hand per plan.
--
-- "*/*" is the allow-all sentinel honored by RuntimeFilesToolService.assertMimeAllowed.
-- This is safe because the real ceiling is the persist-time media validation
-- (apps/api/.../media/media-security-policy.ts: ALLOWED_MEDIA_MIMES +
-- DANGEROUS_FILE_EXTENSIONS), which runs on every produced artifact regardless
-- of this delivery allowlist. Plans that have no stored sandboxPolicy override
-- already inherit the new "*/*" default from DEFAULT_RUNTIME_SANDBOX_POLICY, so
-- this statement only needs to rewrite plans that carry an explicit override.
UPDATE "plan_catalog_plans"
SET "billing_provider_hints" = jsonb_set(
  "billing_provider_hints"::jsonb,
  '{sandboxPolicy,artifactMimeAllowlist}',
  '["*/*"]'::jsonb,
  false
)
WHERE "billing_provider_hints" IS NOT NULL
  AND jsonb_typeof("billing_provider_hints" -> 'sandboxPolicy' -> 'artifactMimeAllowlist') = 'array'
  AND "billing_provider_hints" -> 'sandboxPolicy' -> 'artifactMimeAllowlist' <> '["*/*"]'::jsonb;
