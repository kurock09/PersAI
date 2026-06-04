-- ADR-108 Slice 8: retire `videoGenerateMonthlyUnitsLimit` from plan rows.
--
-- Slice 8 removes the legacy per-unit monthly counter for `video_generate`
-- from every plan editor / projection / contract surface; the VC wallet
-- (`videoVcoinMonthlyGrant` + `WorkspaceVcoinBalance`) is the sole
-- accounting source for `video_generate` going forward.
--
-- This migration strips the dead key from the persisted JSON so that:
--   1. New code paths cannot accidentally resurrect the value via
--      `quotaAccounting.videoGenerateMonthlyUnitsLimit` reads.
--   2. Future `pg_dump` / DR snapshots stop carrying the deprecated key.
--
-- The application-level parser already ignores the field (see
-- `parsePlanQuotaHints` in `track-workspace-quota-usage.service.ts`),
-- so this migration is non-functional at runtime — it only cleans
-- the stored JSON. No table shape changes.

UPDATE "plan_catalog_plans"
SET "billing_provider_hints" =
    COALESCE("billing_provider_hints", '{}'::jsonb)
        #- '{quotaAccounting,videoGenerateMonthlyUnitsLimit}'
        #- '{videoGenerateMonthlyUnitsLimit}'
WHERE
    "billing_provider_hints" IS NOT NULL
    AND (
        "billing_provider_hints" #> '{quotaAccounting,videoGenerateMonthlyUnitsLimit}' IS NOT NULL
        OR "billing_provider_hints" ? 'videoGenerateMonthlyUnitsLimit'
    );
