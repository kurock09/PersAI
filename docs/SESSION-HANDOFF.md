# SESSION-HANDOFF

## What changed

- Completed Step 3 slice `A3` only (draft/publish/version model).
- Added immutable published-version persistence model:
  - Prisma model/table: `assistant_published_versions`
  - fields:
    - `id`
    - `assistant_id`
    - `version` (per-assistant sequence)
    - `snapshot_display_name`
    - `snapshot_instructions`
    - `published_by_user_id`
    - `created_at`
- Added A3 migration:
  - `apps/api/prisma/migrations/20260323140000_step3_a3_draft_publish_version_model/migration.sql`
- Added minimal publish control-plane entrypoint:
  - `POST /api/v1/assistant/publish`
- Extended assistant lifecycle state payload:
  - `latestPublishedVersion` (nullable)
- Implemented publish use-case in application/domain layers:
  - publish snapshots current draft into immutable version row
  - version increments sequentially per assistant
- Enforced immutability for published versions:
  - DB trigger rejects `UPDATE` and `DELETE` on `assistant_published_versions`
- Preserved A1/A2 behavior:
  - existing create/get/draft-update endpoints remain unchanged
  - no runtime/OpenClaw calls introduced
- Updated docs:
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A3` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- A3 requires explicit draft vs published separation so assistant config is not treated as a live mutable blob.
- Backend control plane must own immutable user version truth before apply/runtime concerns are introduced.

## Decisions made

- Draft remains mutable on `assistants` (`draft_*` fields).
- Publish creates immutable snapshot rows in `assistant_published_versions`.
- Published version numbering is per-assistant and monotonic (`1,2,3,...`).
- Publish is control-plane only at this stage:
  - no runtime apply
  - no rollback/reset
  - no OpenClaw runtime coupling

## Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323120000_step3_a1_assistant_domain_model/migration.sql
- apps/api/prisma/migrations/20260323130000_step3_a2_assistant_lifecycle_api_skeleton/migration.sql
- apps/api/prisma/migrations/20260323140000_step3_a3_draft_publish_version_model/migration.sql
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/domain/assistant-published-version.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-published-version.repository.ts
- apps/api/src/modules/workspace-management/domain/assistant.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant.repository.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts
- apps/api/src/modules/workspace-management/application/create-assistant.service.ts
- apps/api/src/modules/workspace-management/application/get-assistant-by-user-id.service.ts
- apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-published-version.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/step2-client.ts
- packages/contracts/src/generated/model/\*
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Added new Prisma migration file for A3:
  - `20260323140000_step3_a3_draft_publish_version_model`
- Migration apply command was not executed in this slice (file added only).

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed
- `corepack pnpm run lint` (full repo) not executed in this slice due pre-existing unrelated formatting debt in repo root/infra docs.

## Known risks

- Published-version immutability is DB-enforced, but only after migration is applied in runtime environments.
- Sequential version allocation can surface conflict under concurrent publish calls; service returns conflict and publish should be retried.
- A3 does not include runtime apply state tracking yet, so publish completion means snapshot persistence only.

## Next recommended step

- Implement Step 3 slice `A4` only: rollback/reset semantics over published versions, still without introducing runtime apply behavior.
