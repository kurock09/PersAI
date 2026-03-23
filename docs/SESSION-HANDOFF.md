# SESSION-HANDOFF

## What changed

- Completed Step 3 slice `A2` only (assistant lifecycle API skeleton).
- Added assistant lifecycle control-plane API entrypoints:
  - `POST /api/v1/assistant`
  - `GET /api/v1/assistant`
  - `PATCH /api/v1/assistant/draft`
- Added thin assistant lifecycle application services in `workspace-management`:
  - create assistant
  - get assistant
  - update assistant draft fields
- Added assistant lifecycle HTTP controller:
  - `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- Extended assistant persistence to support draft update skeleton:
  - added nullable columns in `assistants`:
    - `draft_display_name`
    - `draft_instructions`
    - `draft_updated_at`
  - added migration:
    - `apps/api/prisma/migrations/20260323130000_step3_a2_assistant_lifecycle_api_skeleton/migration.sql`
- Preserved A1 ownership rules:
  - `1 user = 1 assistant` remains DB-enforced by unique `assistants.user_id`
  - assistant remains user-primary and workspace-scoped
  - create flow requires existing workspace membership
- Extended contracts-first artifacts:
  - updated `packages/contracts/openapi.yaml` with assistant lifecycle paths/schemas
  - regenerated typed contracts in `packages/contracts/src/generated/*`
- Updated docs:
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A2` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- A2 requires minimal lifecycle entrypoints over A1 model so assistant control-plane actions can start without runtime coupling.
- This keeps `apps/api` as lifecycle/governance source of truth while preserving strict OpenClaw boundary.

## Decisions made

- Lifecycle API skeleton scope is only create/get/draft-update.
- Draft update mutates only draft fields on `assistants`, no version creation.
- `POST /api/v1/assistant` is explicit create and fails with conflict if assistant already exists.
- Assistant create uses current user workspace membership for workspace scope.
- No behavior/runtime coupling added:
  - no OpenClaw calls
  - no publish/version snapshots
  - no rollback/reset
  - no chat/channels/integrations APIs

## Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323120000_step3_a1_assistant_domain_model/migration.sql
- apps/api/prisma/migrations/20260323130000_step3_a2_assistant_lifecycle_api_skeleton/migration.sql
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/domain/assistant.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant.repository.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts
- apps/api/src/modules/workspace-management/application/create-assistant.service.ts
- apps/api/src/modules/workspace-management/application/get-assistant-by-user-id.service.ts
- apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts
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

- Added new Prisma migration file for A2:
  - `20260323130000_step3_a2_assistant_lifecycle_api_skeleton`
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

- A2 provides lifecycle skeleton only; clients must handle 404 until assistant is explicitly created.
- Migration must be applied before draft fields are available at runtime.
- The create flow currently derives workspace scope from existing membership selection strategy (active first, fallback latest).

## Next recommended step

- Implement Step 3 slice `A3` only: draft/publish/version model while preserving A2 endpoint boundaries and keeping OpenClaw runtime integration out of scope.
