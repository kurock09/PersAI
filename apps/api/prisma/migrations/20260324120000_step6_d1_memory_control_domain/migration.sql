-- AlterTable
ALTER TABLE "assistant_governance" ADD COLUMN "memory_control" JSONB;

-- Backfill from legacy nested shape (pre-D1 experiments)
UPDATE "assistant_governance"
SET "memory_control" = "policy_envelope"->'memoryControl'
WHERE "policy_envelope" IS NOT NULL
  AND "policy_envelope" ? 'memoryControl';

-- Baseline for all remaining rows (MVP memory policy + hooks; runtime behavior remains OpenClaw-owned)
UPDATE "assistant_governance"
SET "memory_control" = '{"schema":"persai.memoryControl.v1","policy":{"globalMemoryReadAllSurfaces":true,"allowedGlobalWriteSurfaces":["web"],"denyGroupSourcedGlobalWrites":true},"provenance":{"schemaVersion":1,"requireSurfaceTag":true,"requireChannelTagWhenPresent":true},"visibilityHooks":{"exposeSourceMetadataToUser":true},"forgetRequestMarkers":[],"audit":{"delegateToGovernanceAuditHook":true}}'::jsonb
WHERE "memory_control" IS NULL;
