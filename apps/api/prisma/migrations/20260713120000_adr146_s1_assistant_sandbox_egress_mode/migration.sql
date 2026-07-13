-- ADR-146 Slice 1: canonical Assistant.sandboxEgressMode + plan JSON cleanup.
-- Existing assistants backfill to restricted via NOT NULL DEFAULT.
-- Dead plan sandboxPolicy.networkAccessEnabled is deleted with no alias.

CREATE TYPE "AssistantSandboxEgressMode" AS ENUM ('restricted', 'full_public');

ALTER TABLE "assistants"
ADD COLUMN "sandbox_egress_mode" "AssistantSandboxEgressMode" NOT NULL DEFAULT 'restricted';

UPDATE "plan_catalog_plans"
SET "billing_provider_hints" =
  COALESCE("billing_provider_hints", '{}'::jsonb)
    #- '{sandboxPolicy,networkAccessEnabled}'
WHERE "billing_provider_hints" #> '{sandboxPolicy,networkAccessEnabled}' IS NOT NULL;
