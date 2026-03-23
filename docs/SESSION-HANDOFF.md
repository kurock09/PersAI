# SESSION-HANDOFF

## What changed

- Completed Step 3 slice `A7` only (materialized runtime spec baseline).
- Added deterministic materialization storage model:
  - table/model: `assistant_materialized_specs`
  - unique by `published_version_id` (one materialization per published version)
  - stores layered payload, OpenClaw-native outputs, deterministic documents, and content hash
- Added DB migration:
  - `apps/api/prisma/migrations/20260323170000_step3_a7_materialized_runtime_spec/migration.sql`
- Added backend materialization service:
  - deterministic layer assembly
  - deterministic JSON documents
  - SHA-256 content hash
- Added domain/repository/infrastructure baseline for materialized spec persistence.
- Materialization now runs on lifecycle actions that create a new published version:
  - publish
  - rollback
  - reset
- Extended assistant lifecycle response with `materialization` block:
  - latest materialization id/version linkage/hash/timestamp
  - OpenClaw bootstrap/workspace deterministic documents
- Preserved A1-A6 behavior and boundaries:
  - no OpenClaw apply/runtime call
  - no custom parallel bootstrap framework
  - no raw bootstrap editing endpoint
- Updated docs:
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A7` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- A7 introduces runtime-ready spec materialization as deterministic control-plane projection, keeping source-of-truth in backend lifecycle/governance layers.
- This avoids ad hoc/parallel bootstrap systems and prepares diffable/versionable/auditable artifacts for later apply flow.

## Decisions made

- Materialization layers are assembled deterministically from:
  - ownership/lifecycle context
  - user-owned published snapshot
  - governance envelope layer
  - apply-state context
- OpenClaw-native outputs are persisted directly as:
  - `openclaw_bootstrap`
  - `openclaw_workspace`
- Deterministic text documents and hash are persisted for diff/audit use:
  - `layers_document`
  - `openclaw_bootstrap_document`
  - `openclaw_workspace_document`
  - `content_hash`
- No runtime apply execution is introduced in this slice.

## Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323170000_step3_a7_materialized_runtime_spec/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-materialized-spec.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-materialized-spec.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-materialized-spec.repository.ts
- apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts
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

- Added new Prisma migration file for A7:
  - `20260323170000_step3_a7_materialized_runtime_spec`
- Migration apply command was not executed in this slice (file added only).

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed

## Known risks

- Materialization is deterministic and persisted, but runtime apply integration is still deferred.
- Existing published versions from before A7 are not auto-materialized unless explicitly materialized/backfilled later.
- OpenClaw-native output schema is baseline and may need controlled extension in later slices.

## Next recommended step

- Implement Step 3 slice `A8` only: OpenClaw apply/reapply adapter consuming A7 materialized outputs.
