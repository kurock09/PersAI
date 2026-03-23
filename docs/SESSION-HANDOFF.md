# SESSION-HANDOFF

## What changed

- Completed Step 3 slice `A4` only (rollback/reset semantics).
- Added rollback/reset lifecycle entrypoints:
  - `POST /api/v1/assistant/rollback`
  - `POST /api/v1/assistant/reset`
- Implemented rollback semantics in control-plane:
  - input requires `targetVersion`
  - rollback creates a **new latest** published version snapshot copied from target version
  - rollback updates mutable draft values to the same rolled-back snapshot
  - historical published rows are not updated/deleted
- Implemented reset semantics in control-plane:
  - reset creates a **new latest** published version snapshot with blank values (`null`)
  - reset clears mutable draft values to blank (`null`)
  - assistant identity/ownership/workspace scope remain intact
  - no default deletion of secrets/integration attachment layer
- Preserved A1-A3 behavior:
  - existing create/get/draft/publish endpoints remain
  - no runtime apply/OpenClaw calls introduced
- Updated docs:
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A4` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- A4 requires explicit separation of rollback and reset semantics before runtime apply is introduced.
- Control-plane lifecycle must support safe state recovery actions without deleting platform attachment layers.

## Decisions made

- Rollback is modeled as "publish snapshot from an existing version", not mutation of old versions.
- Reset is modeled as "publish new blank state + clear draft", not deletion of assistant ownership scope.
- Neither rollback nor reset performs runtime apply/openclaw execution.
- Neither rollback nor reset deletes secrets/integrations by default.

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
- apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts
- apps/api/src/modules/workspace-management/application/reset-assistant.service.ts
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

- No new DB schema migration required for A4 semantics.

## Tests run / result

- Pending update after running A4 validation commands.

## Known risks

- Rollback/reset remain control-plane state transitions only until A5 runtime apply model exists.
- Concurrent publish/rollback/reset can still surface version conflicts and require retry.
- Reset currently uses blank snapshot semantics; policy-driven selective reset is deferred.

## Next recommended step

- Implement Step 3 slice `A5` only: runtime apply state model, keeping OpenClaw-specific behavior behind infrastructure boundaries.
