# SESSION-HANDOFF

## What changed

- Completed Step 3 slice `A1` (assistant domain model baseline) with minimal scope.
- Added first-class assistant persistence model in backend control plane:
  - Prisma model/table: `assistants`
  - fields: `id`, `user_id`, `workspace_id`, `created_at`, `updated_at`
- Enforced MVP rule `1 user = 1 assistant` in DB:
  - unique constraint on `assistants.user_id`
- Enforced assistant as user-primary and workspace-scoped in DB:
  - FK `assistants.user_id -> app_users.id`
  - FK `assistants.workspace_id -> workspaces.id`
  - scoped-membership FK `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
- Added Prisma migration for this model:
  - `apps/api/prisma/migrations/20260323120000_step3_a1_assistant_domain_model/migration.sql`
- Added minimal assistant backend module baseline in `workspace-management` (no API routes):
  - domain entity/type
  - repository contract
  - Prisma repository implementation
  - read service (`GetAssistantByUserIdService`)
- Updated docs:
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A1` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- A1 requires introducing assistant as a standalone control-plane entity before any lifecycle/runtime/chat features.
- This establishes strict ownership truth in `apps/api` while keeping OpenClaw and chat concerns out of scope.

## Decisions made

- Assistant remains independent from `app_users` and `workspaces` as its own domain entity/table.
- Enforce `1 user = 1 assistant` at DB level (not by controller/runtime logic).
- Assistant is explicitly scoped to a workspace membership pair `(workspace_id, user_id)`.
- No API or behavior expansion in A1:
  - no lifecycle endpoints
  - no publish/version model
  - no runtime apply state
  - no OpenClaw calls
  - no chat/channels/Telegram/tool routing logic

## Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323120000_step3_a1_assistant_domain_model/migration.sql
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/workspace-management/domain/assistant.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant.repository.ts
- apps/api/src/modules/workspace-management/application/get-assistant-by-user-id.service.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Added new Prisma migration file for A1:
  - `20260323120000_step3_a1_assistant_domain_model`
- Migration apply command was not executed in this slice (file added only).

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed
- `corepack pnpm run lint` (full repo) - not clean due pre-existing Prettier issues in unrelated files:
  - `.github/workflows/openclaw-dev-image-publish.yml`
  - `infra/dev/gitops/README.md`
  - `infra/dev/gke/README.md`
  - `infra/dev/gke/RUNBOOK.md`
  - `README.md`

## Known risks

- Current backend module baseline is intentionally minimal and not yet exposed via API.
- Migration introduces new table and constraints; environments must run Prisma migration before using assistant persistence.
- Multi-module Prisma client usage exists (`identity-access` and `workspace-management`) and should be revisited when A2 introduces lifecycle API wiring.

## Next recommended step

- Implement Step 3 slice `A2` only: assistant lifecycle API skeleton over existing A1 persistence model, while keeping OpenClaw integration and publish/version logic out of scope.
