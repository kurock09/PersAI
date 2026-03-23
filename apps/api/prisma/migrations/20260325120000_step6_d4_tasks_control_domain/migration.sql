-- AlterTable
ALTER TABLE "assistant_governance" ADD COLUMN "tasks_control" JSONB;

-- Backfill from legacy nested shape (pre-D4 experiments)
UPDATE "assistant_governance"
SET "tasks_control" = "policy_envelope"->'tasksControl'
WHERE "policy_envelope" IS NOT NULL
  AND "policy_envelope" ? 'tasksControl'
  AND jsonb_typeof("policy_envelope"->'tasksControl') = 'object';

-- Baseline for remaining rows (MVP tasks control; execution/scheduling remains OpenClaw-owned)
UPDATE "assistant_governance"
SET "tasks_control" = '{"schema":"persai.tasksControl.v1","ownership":{"schemaVersion":1,"model":"user_assistant_owner"},"sourceSurfaces":{"schemaVersion":1,"knownSurfaces":["web"],"requireSurfaceTag":true},"controlLifecycle":{"schemaVersion":1,"statusKinds":["scheduled","enabled","disabled","cancelled","superseded"],"executionOwnedBy":"openclaw_runtime"},"enablement":{"schemaVersion":1,"userMayDisable":true,"userMayEnable":true},"cancellation":{"schemaVersion":1,"userMayCancel":true},"commercialQuota":{"schemaVersion":1,"tasksExcludedFromPlanQuotas":true},"audit":{"schemaVersion":1,"delegateToGovernanceAuditHook":true}}'::jsonb
WHERE "tasks_control" IS NULL;
