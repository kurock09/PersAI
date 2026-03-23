# SESSION-HANDOFF

## What changed

- Completed Step 3 slice `A6` only (assistant governance baseline).
- Added platform-managed governance persistence model:
  - table/model: `assistant_governance`
  - one governance row per assistant (`assistant_id` unique)
  - fields:
    - `capability_envelope`
    - `secret_refs`
    - `policy_envelope`
    - `quota_plan_code`
    - `quota_hook`
    - `audit_hook`
- Added DB migration:
  - `apps/api/prisma/migrations/20260323160000_step3_a6_assistant_governance_baseline/migration.sql`
- Added governance domain/repository/infrastructure baseline in `workspace-management`.
- Assistant create now initializes baseline governance row.
- Extended assistant lifecycle response with `governance` block.
- Preserved A1-A5 behavior and boundaries:
  - no runtime/OpenClaw calls
  - no backend behavior routing
  - no tools/quotas engines implemented in this slice
- Updated docs:
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A6` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- A6 introduces baseline governance structure around assistants while keeping backend as control-plane, not behavior engine.
- Governance must be separated from user-owned draft/version truth to keep lifecycle and platform overlays decoupled.

## Decisions made

- Governance is modeled in dedicated platform-managed storage (`assistant_governance`), separate from:
  - user draft state (`assistants.draft_*`)
  - immutable user-owned published versions (`assistant_published_versions`)
- Governance is exposed as lifecycle read-model data only in this slice.
- No runtime enforcement/behavior execution is attached to governance yet.

## Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323160000_step3_a6_assistant_governance_baseline/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-governance.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-governance.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts
- apps/api/src/modules/workspace-management/application/create-assistant.service.ts
- apps/api/src/modules/workspace-management/application/get-assistant-by-user-id.service.ts
- apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts
- apps/api/src/modules/workspace-management/application/reset-assistant.service.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/step2-client.ts
- packages/contracts/src/generated/model/\*
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Added new Prisma migration file for A6:
  - `20260323160000_step3_a6_assistant_governance_baseline`
- Migration apply command was not executed in this slice (file added only).

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed

## Known risks

- Governance envelopes/hooks are placeholders and not enforced by dedicated engines yet.
- Assistants created before A6 may not yet have governance row until backfill or lifecycle write path.
- Quotas/tools/audit implementations remain deferred and must consume this governance model later.

## Next recommended step

- Implement Step 3 slice `A7` only: materialized runtime spec derived from user-owned lifecycle truth plus platform-managed governance envelopes.
