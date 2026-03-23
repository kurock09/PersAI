# SESSION-HANDOFF

## 2026-03-26 - Step 7 P2 admin plan management UI/API

### What changed

- Added owner-gated admin plan management API:
  - `GET /api/v1/admin/plans`
  - `POST /api/v1/admin/plans`
  - `PATCH /api/v1/admin/plans/{code}`
- Added centralized plan management application service (`ManageAdminPlansService`) and expanded plan catalog repository for list/create/update flows.
- Added `/app` owner-only admin section for plan create/edit with serious control-plane forms:
  - naming and metadata
  - default-on-registration
  - trial + duration
  - entitlement and limits controls
- Extended contracts/OpenAPI + generated client models for admin plan endpoints and payloads.
- Docs updated: ADR-025, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P2 requires direct admin-side plan packaging controls without coupling to a billing vendor or exposing raw DB internals.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `docs/ADR/025-admin-plan-management-p2.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- No billing provider console/workflow in P2 (checkout, subscription lifecycle, invoices/webhooks remain out of scope).
- Owner-gate uses workspace owner check; full admin RBAC expansion remains Step 9 scope.
- Entitlement enforcement runtime/quotas are not added in P2; this slice is plan management control surface only.

### Next recommended step

- Step 7 **P3** subscription state + billing abstraction, keeping P1/P2 provider-agnostic boundaries intact.

### Ready commit message

- `feat(api-web): add step 7 p2 owner-gated admin plan management ui and api`

## 2026-03-26 - Step 7 P1 plan catalog and entitlement model

### What changed

- Added canonical plan catalog persistence:
  - `plan_catalog_plans` (`code`, `status`, provider-agnostic metadata, `isDefaultFirstRegistrationPlan`, `isTrialPlan`, `trialDurationDays`)
  - `plan_catalog_entitlements` (1:1 by plan with grouped entitlement JSON arrays for capabilities, tool classes, channels/surfaces, limits permissions)
- Added DB integrity constraints:
  - partial unique index for single default first-registration plan
  - trial duration check (`is_trial_plan=false => null`, `is_trial_plan=true => >0`)
- Governance baseline creation now resolves `quotaPlanCode` from active default-first-registration plan in catalog (nullable fallback when catalog is empty).
- Seed baseline now inserts/updates provider-agnostic default trial plan `starter_trial` (14 days) and canonical entitlement payload.
- Docs updated: ADR-024, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P1 makes plan packaging and entitlement truth explicit in the control plane without coupling to a billing vendor or introducing subscription workflow scope.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326170000_step7_p1_plan_catalog_entitlements/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `docs/ADR/024-plan-catalog-and-entitlements-p1.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- No plan-management API/UI in P1.
- No billing provider workflows (checkout, subscription state machine, invoices/webhooks).
- No entitlement enforcement engine yet; P1 defines canonical storage and governance default assignment only.

### Next recommended step

- Step 7 **P2** admin plan management UI (or management API first) while keeping P1 provider-agnostic model unchanged.

### Ready commit message

- `feat(api): add step 7 p1 canonical plan catalog and entitlement model`

## 2026-03-26 - Step 6 D5 Tasks Center MVP

### What changed

- Added **`assistant_task_registry_items`** and APIs: list tasks, pause (`disable`), resume (`enable`), stop (`cancel`), with sorting and **409** when `tasks_control` denies an action.
- Web **Tasks** section in the assistant editor (after Memory): Active / Inactive groups, source pill, next-run messaging, warm copy; **EDITOR_SECTIONS** includes `Tasks`.
- OpenAPI/contracts + Clerk middleware routes; `globals.css` task-center styling; `test:tasks-user-controls`; web tests for Tasks nav + mocked list.
- Docs: ADR-023, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `DESIGN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D5 delivers the agreed Tasks Center MVP: inspect and control reminders/tasks without exposing raw runtime or building a workflow designer.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`, migration `20260326120000_step6_d5_tasks_center_registry`
- `apps/api/src/modules/workspace-management/**` (task domain, repo, services, controller, module, `tasks-user-controls.ts`)
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/web/app/app/app-flow.client.tsx`, `assistant-api-client.ts`, `app-flow.client.test.tsx`, `globals.css`
- `apps/api/test/tasks-user-controls.test.ts`, `apps/api/package.json`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `docs/ADR/023-tasks-center-mvp-d5.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/api run test:tasks-user-controls` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires Postgres)

### Known risks / intentional limits

- Registry may stay **empty** until OpenClaw/sync (or ops) inserts rows; UI explains that honestly.
- Control actions update **PersAI registry state only** in D5; runtime must consume/sync separately.
- Cancelled items cannot be re-enabled from the API.

### Next recommended step

- Step 7 **P1** plan catalog (per `docs/ROADMAP.md`) or wire task registry population from OpenClaw when contract-ready.

### Ready commit message

- `feat(api-web): add step 6 d5 tasks center registry and ui`

## 2026-03-25 - Step 6 D4 tasks control domain hardening

### What changed

- Added canonical **`tasks_control`** on `assistant_governance` with default **`persai.tasksControl.v1`**: ownership (`user_assistant_owner`), source/surface hooks (`knownSurfaces`, `requireSurfaceTag`), control lifecycle **labels** (`statusKinds` + `executionOwnedBy: openclaw_runtime`), enable/disable and cancel flags, **`commercialQuota.tasksExcludedFromPlanQuotas: true`**, audit delegation to governance `auditHook`.
- Resolution + materialization: **`openclawWorkspace.tasksControl`** uses column → `policyEnvelope.tasksControl` → defaults; governance layer snapshot includes raw `tasksControl`.
- API/OpenAPI/contracts: **`governance.tasksControl`** on assistant lifecycle reads.
- **PRODUCT.md** corrected: tasks/reminders are not a commercial quota dimension (aligned with envelope).
- Docs: ADR-022, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D4 hardens the hybrid model: PersAI owns control/visibility metadata; OpenClaw owns execution — without a backend scheduler or task router.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`, migration `20260325120000_step6_d4_tasks_control_domain`
- `apps/api/src/modules/workspace-management/domain/assistant-tasks-control.defaults.ts`, `tasks-control-resolve.ts`, `assistant-governance.entity.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`, `assistant-lifecycle.mapper.ts`, `assistant-lifecycle.types.ts`
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/api/test/tasks-control-resolve.test.ts`, `apps/api/package.json`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/022-tasks-control-domain-d4.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run test:tasks-control` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires Postgres)

### Known risks / intentional limits

- No task rows, list APIs, or UI (D5); envelope is control-plane only.
- OpenClaw must still interpret `openclawWorkspace.tasksControl` if/when runtime integration needs it.

### Next recommended step

- Step 7 **P1** plan catalog (per `docs/ROADMAP.md`) or OpenClaw task-registry population when ready.

### Ready commit message

- `feat(api): add step 6 d4 tasks control envelope and materialization`

## 2026-03-24 - Step 6 D3 memory source policy enforcement

### What changed

- Enforced global memory **read** policy on all Memory Center–related APIs (list, forget-by-id, do-not-remember) using `globalMemoryReadAllSurfaces` on the resolved `memory_control` envelope.
- Enforced global **registry write** policy after successful web chat turns: caller supplies explicit `memoryWriteContext` (`web` + `trusted_1to1`); denies `group` and non–trusted-1:1 classifications; requires surface in both allowed and trusted 1:1 write lists.
- Extended default `memory_control` with `trustedOneToOneGlobalWriteSurfaces` and `sourceClassification`; Prisma migration backfills existing JSON documents.
- Docs: ADR-021, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D3 requires the agreed memory source policy to be **evaluated in code**, not implied by JSON alone, with explicit trust/surface classification in the control model.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/domain/memory-source-policy.ts`, `memory-control-resolve.ts`, `assistant-memory-control.defaults.ts`
- `apps/api/src/modules/workspace-management/application/record-web-chat-memory-turn.service.ts`, `send-web-chat-turn.service.ts`, `stream-web-chat-turn.service.ts`, `list-assistant-memory-items.service.ts`, `forget-assistant-memory-item.service.ts`, `do-not-remember-assistant-memory.service.ts`, `materialize-assistant-published-version.service.ts`
- `apps/api/prisma/migrations/20260324160000_step6_d3_memory_source_policy_envelope/migration.sql`
- `apps/api/test/memory-source-policy.test.ts`, `apps/api/package.json`
- `docs/ADR/021-memory-source-policy-d3.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run test:memory-policy` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires local Postgres)

### Known risks / intentional limits

- Only **web** is a typed transport surface; channel/group ingest is intentionally unsupported—future surfaces must thread explicit `GlobalMemoryWriteAttemptContext`.
- Disabling `denyGroupSourcedGlobalWrites` still does not allow group → global registry (explicit not-supported path).
- Registry write denial **skips** registry insert only; chat completion remains successful.

### Next recommended step

- Step 6 **D5** Tasks Center MVP (per `docs/ROADMAP.md`).

### Ready commit message

- `feat(api): enforce step 6 d3 global memory source policy`

## 2026-03-23 - Step 6 D2 Memory Center MVP

### What changed

- Delivered Memory Center MVP (web): list of calm one-line summaries from completed web chat turns, source/type pill, forget-from-list, and “Do not remember this” on streamed assistant messages after IDs reconcile to server UUIDs.
- Backend: table `assistant_memory_registry_items`, record hook after successful `SendWebChatTurnService` / `StreamWebChatTurnService` completion, list/forget/do-not-remember endpoints, governance `forgetRequestMarkers` append on do-not-remember.
- Contracts/OpenAPI + Clerk middleware routes; minimal global CSS for memory cards and quiet buttons.
- Docs: ADR-020, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP` (D2 done), `CHANGELOG`, this handoff.

### Why changed

- D2 requires a trustworthy user-facing memory surface without raw OpenClaw internals or an admin console.

### Files touched (high level)

- `apps/api/prisma/*`, new migration `20260324140000_step6_d2_memory_center_registry`
- `apps/api/src/modules/workspace-management/**` (memory services, repos, controller, stream/send wiring)
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/web/app/app/app-flow.client.tsx`, `assistant-api-client.ts`, `app-flow.client.test.tsx`, `globals.css`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `docs/ADR/020-memory-center-mvp-d2.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm run prisma:migrate:check` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm --filter @persai/web run build` — passed

### Known risks / intentional limits

- Summaries are derived from web chat transcripts, not a live export of OpenClaw runtime memory.
- Interrupted/partial stream turns do not create registry rows.
- Do-not-remember appends control-plane markers; runtime application in OpenClaw is not implemented in this slice.

### Next recommended step

- Step 6 `D3` memory source policy enforcement (ingest/write gates) building on registry + `memory_control`.

### Ready commit message

- `feat(api-web): add step 6 d2 memory center and web chat do-not-remember`

## 2026-03-23 - Step 6 D1 memory control domain hardening

### What changed

- Hardened backend memory **control plane** while keeping OpenClaw as runtime memory behavior owner:
  - added Prisma column `assistant_governance.memory_control` and migration with backfill from `policyEnvelope.memoryControl` when set
  - seeded new assistants with default `persai.memoryControl.v1` envelope (`createDefaultMemoryControlEnvelope`)
  - materialization now resolves effective memory control from column → legacy nested key → default
  - included `memoryControl` in materialization governance layer snapshot for auditability
  - exposed `governance.memoryControl` on assistant lifecycle API + OpenAPI/contracts
- Documented boundary in `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, ADR-019; marked D1 complete in `docs/ROADMAP.md`.

### Why changed

- D1 requires explicit governable memory policy/hooks/markers in the control plane without moving runtime memory mechanics into `apps/api`.
- Prior code only read optional `policyEnvelope.memoryControl` during materialization; there was no canonical persisted baseline.

### Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260324120000_step6_d1_memory_control_domain/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-governance.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-memory-control.defaults.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts
- apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/*
- apps/web/app/app/app-flow.client.test.tsx
- docs/ADR/019-memory-control-domain-d1.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm run prisma:migrate:check` — passed (local Postgres)
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks

- Existing materialized specs keep prior `content_hash` until republish/reapply path creates a new spec; new publishes pick up enriched governance layer including `memoryControl`.
- Clients must tolerate new `governance.memoryControl` field (nullable object).

### Next recommended step

- Step 6 `D2` Memory Center MVP (read-focused UX) using `governance.memoryControl` + future memory list APIs as designed.

### Ready commit message

- `feat(api): add step 6 d1 memory control envelope and materialization wiring`

## 2026-03-23 - OpenClaw patch protection hardening

### What changed

- Added deploy-safety protections around OpenClaw compatibility patch usage:
  - added `infra/dev/gitops/validate-openclaw-compat-patch.sh`
    - resolves pinned SHA from `infra/dev/gitops/openclaw-approved-sha.txt`
    - materializes OpenClaw at that exact SHA
    - runs `git apply --check` for `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`
  - wired the validator into `.github/workflows/ci.yml` so malformed patch files fail in CI before deployment workflows
  - strengthened `.github/workflows/openclaw-dev-image-publish.yml` patch step by adding an explicit `git apply --check` preflight before `git apply`

### Why changed

- Deploy failed with `error: corrupt patch at line 15` during patch apply.
- This adds an early deterministic gate so patch formatting or drift issues are caught before image publish/deploy path.

### Files touched

- infra/dev/gitops/validate-openclaw-compat-patch.sh
- .github/workflows/ci.yml
- .github/workflows/openclaw-dev-image-publish.yml
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- Not run locally in this slice (workflow and script hardening only).

### Known risks

- Validation depends on cloning `OPENCLAW_FORK_REPO`; transient GitHub/network outages can fail the guard even when patch is valid.
- Guard checks patch applicability against the pinned SHA only; patch may still fail if workflow target SHA is changed without updating the pin.

### Next recommended step

- Trigger CI once to confirm validator pass, then trigger `OpenClaw Dev Image Publish` to verify apply preflight and publish path end-to-end.

### Ready commit message

- `ci(gitops): add openclaw patch preflight validation guards`

## 2026-03-23 - Step 5 C6 chat error/degradation UX slice

### What changed

- Completed Step 5 slice `C6` only (human-friendly chat error/degradation UX):
  - added web chat UX error-classification layer in `apps/web` API client
  - mapped transport/runtime failures to user-facing classes with guidance:
    - auth/session
    - input validation
    - assistant-not-live lifecycle gate
    - active chat cap
    - runtime unreachable
    - runtime timeout
    - runtime degraded
    - runtime auth failure
    - provider/tool/channel-style failures
    - stream incomplete/partial outcomes
  - updated web chat UI to show friendly issue message + next-step guidance instead of raw error text
  - preserved honest streaming behavior:
    - partial outputs remain visible and preserved
    - failure/degradation guidance remains explicit but non-technical
  - updated docs:
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C6` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C6 requires user-facing clarity for chat degradation/error states without leaking runtime internals.
- Prior path could surface raw backend/runtime message text directly.
- New layer keeps messaging honest and actionable while preserving admin/support depth separation.

### Files touched

- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C6 classification is rule-based message/status mapping, not a dedicated centralized taxonomy service.
- Support/admin diagnostic depth remains intentionally outside normal user path and is not surfaced in this UI slice.

### Next recommended step

- Start Step 6 `D1` memory control domain while preserving C1-C6 chat boundary and UX behavior.

### Ready commit message

- `feat(web): add step 5 c6 human-friendly chat degradation and error UX classes`

## 2026-03-23 - Step 5 C5 active web chats cap slice

### What changed

- Completed Step 5 slice `C5` only (active web chats cap enforcement):
  - added backend cap enforcement for web chat transport paths:
    - synchronous path (`C2`) in `SendWebChatTurnService`
    - streaming path (`C3`) in `StreamWebChatTurnService`
  - cap is checked only when creating a **new** web chat thread (`surfaceThreadKey` not yet present)
  - existing thread turns continue to work even when cap is reached
  - cap counts active chats only (`archivedAt = null`)
  - added admin-configurable API config/env threshold:
    - `WEB_ACTIVE_CHATS_CAP` (default `20`)
  - wired cap env into examples and Helm values:
    - `apps/api/.env.local.example`
    - `apps/api/.env.dev.example`
    - `infra/helm/values.yaml`
    - `infra/helm/values-dev.yaml`
  - web `/app` now shows explicit user-facing guidance when cap is reached
  - updated docs:
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C5` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C5 requires a real, user-visible enforcement point for active web chat limits.
- The limit must block new chat creation explicitly without silent failure or destructive side effects.
- Cap must stay operationally tunable by admins without introducing billing implementation scope.

### Files touched

- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts
- apps/web/app/app/app-flow.client.tsx
- packages/config/src/api-config.ts
- apps/api/.env.local.example
- apps/api/.env.dev.example
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/*
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C5 currently enforces a single global per-assistant web active-chat cap value from API config; no plan/tier-specific limits yet.
- Cap enforcement is transport-path based (new-thread creation point), not a separate dedicated quota subsystem.
- C6 degradation/error UX refinements are not yet implemented.

### Next recommended step

- Proceed to Step 5 `C6` (chat error/degradation UX) while preserving explicit C5 cap guidance and non-destructive cap behavior.

### Ready commit message

- `feat(api-web): add step 5 c5 active web chats cap enforcement and guidance`

## 2026-03-23 - Step 5 C4 web chat list and actions slice

### What changed

- Completed Step 5 slice `C4` only (GPT-style web chat list and core chat actions):
  - added backend web chat list endpoint:
    - `GET /api/v1/assistant/chats/web`
  - added backend chat actions:
    - rename: `PATCH /api/v1/assistant/chats/web/:chatId`
    - archive: `POST /api/v1/assistant/chats/web/:chatId/archive`
    - hard delete: `DELETE /api/v1/assistant/chats/web/:chatId`
  - hard delete requires explicit confirmation payload:
    - `confirmText=DELETE`
  - implemented hard delete as true destructive delete:
    - removes chat row
    - removes related chat message rows
    - no soft-delete aliasing
  - added list metadata projection from canonical records:
    - `messageCount`
    - `lastMessagePreview`
    - timestamps and archive state
  - updated web `/app` with GPT-style chat list UI and actions:
    - open thread in composer
    - rename
    - archive
    - hard delete with explicit typed confirmation
  - updated contracts/docs:
    - OpenAPI + generated contract client/models
    - ADR `docs/ADR/018-web-chat-list-and-destructive-actions.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C4` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C4 requires user-facing chat management controls, not only transport/send UX.
- GPT-style chat list actions are now mapped to canonical backend records introduced in C1.
- Delete behavior is kept explicit and honest: destructive delete must not be masked as archive.

### Files touched

- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts
- apps/api/src/modules/workspace-management/application/web-chat.types.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/*
- docs/ADR/018-web-chat-list-and-destructive-actions.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C4 list metadata preview is basic text projection (no rich excerpt formatting yet).
- Hard delete is irreversible by design and removes persisted history records.
- Telegram chat management remains out of scope.

### Next recommended step

- Proceed to Step 5 `C5` (active web chats cap) while preserving explicit archive/delete semantics from C4.

### Ready commit message

- `feat(web-api): add step 5 c4 web chat list with rename archive and hard delete`

## 2026-03-23 - Step 5 C3 streaming web chat slice

### What changed

- Completed Step 5 slice `C3` only (streaming-first web chat transport and UI path):
  - added backend streaming endpoint:
    - `POST /api/v1/assistant/chat/web/stream`
  - added streaming application service orchestration:
    - pre-stream lifecycle/apply gate enforcement
    - canonical user message persistence before stream starts
    - runtime stream delta handling
    - explicit completion/interruption/failure outcomes
  - added OpenClaw adapter streaming boundary method:
    - calls `POST /api/v1/runtime/chat/web/stream`
    - parses NDJSON runtime stream chunks (`delta|done`)
  - extended OpenClaw compatibility patch with streaming runtime endpoint:
    - `POST /api/v1/runtime/chat/web/stream`
  - kept C2 request/response transport endpoint in place for compatibility, but switched web UX to streaming-first path
  - updated web `/app` chat behavior:
    - primary send path is streaming (`Send message (stream)`)
    - live delta rendering
    - user-triggered interruption (`Stop streaming`)
    - honest partial-output state visibility
  - preserved canonical record truth during streaming:
    - on completion: assistant full message persisted
    - on interrupted/failed with partial text: partial assistant message persisted + system marker persisted
  - updated docs:
    - `docs/ADR/017-web-chat-streaming-first-transport.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C3` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C3 requirement is streaming-first web chat as the primary happy path.
- Streaming needed to preserve transparency for interruption/failure and avoid pretending full completion when runtime output is partial.
- Existing C1/C2 record-vs-runtime boundary is preserved by persisting records in backend while keeping runtime session truth in OpenClaw.

### Files touched

- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/*
- docs/ADR/017-web-chat-streaming-first-transport.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- Streaming protocol is currently SSE from API and NDJSON from adapter/runtime; advanced resume/replay semantics are not implemented.
- Runtime streaming behavior in dev depends on OpenClaw compatibility patch path.
- C4 chat list/actions and persistence-backed chat history UX are not implemented yet.

### Next recommended step

- Proceed to Step 5 `C4` (chat list and chat actions) while keeping streaming-first path and record-vs-runtime split intact.

### Ready commit message

- `feat(web-api): add step 5 c3 streaming-first web chat transport and ui path`

## 2026-03-23 - Step 5 C2 web chat backend transport slice

### What changed

- Completed Step 5 slice `C2` only (web chat backend transport baseline):
  - added backend transport endpoint in `apps/api`:
    - `POST /api/v1/assistant/chat/web`
  - added application service for web chat turn transport:
    - parses/validates transport request payload
    - enforces assistant lifecycle/apply gate
    - resolves/creates canonical C1 chat record by `(assistantId, surface=web, surfaceThreadKey)`
    - appends user message record before runtime call
    - appends assistant message record after runtime call
  - extended OpenClaw runtime adapter boundary with web chat turn operation:
    - `POST /api/v1/runtime/chat/web`
  - updated auth middleware route protection for new endpoint
  - added OpenAPI contract for new endpoint and generated client updates in `packages/contracts`
  - extended OpenClaw source compatibility patch to include auth-protected `POST /api/v1/runtime/chat/web` endpoint for dev image workflow patching
  - updated docs:
    - `docs/ADR/016-web-chat-backend-transport-boundary.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C2` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C2 introduces minimal backend transport for web chat while preserving boundaries established in C1 and A8.
- Backend record/history truth remains canonical and runtime session/context truth remains in OpenClaw.
- Lifecycle/apply gate prevents transport from bypassing assistant publish/apply model.

### Files touched

- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/application/web-chat.types.ts
- apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/*
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- docs/ADR/016-web-chat-backend-transport-boundary.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C2 transport is synchronous request/response only (no streaming/backpressure semantics).
- OpenClaw web chat endpoint in this phase is compatibility-level and requires patched image path in dev workflow.
- Telegram and broader multi-surface transport handling remain intentionally out of scope.

### Next recommended step

- Proceed to Step 5 `C3` (streaming web chat transport) while preserving C1/C2 record-vs-runtime boundary.

### Ready commit message

- `feat(api): add step 5 c2 web chat backend transport through openclaw adapter`

## 2026-03-23 - Step 5 C1 chat domain model slice

### What changed

- Completed Step 5 slice `C1` only (backend chat record domain baseline):
  - added chat record persistence model in `apps/api` Prisma:
    - `assistant_chats`
    - `assistant_chat_messages`
  - added chat surface-awareness at identity level:
    - `assistant_chats` unique thread key `(assistant_id, surface, surface_thread_key)`
    - C1 surface baseline is `web`
  - added ownership/scope constraints for chat records:
    - assistant ownership tie via `(assistant_id, user_id) -> assistants(id, user_id)`
    - workspace scope tie via `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - added backend domain/repository wiring in `workspace-management`:
    - chat entity + message entity
    - chat repository contract
    - Prisma repository implementation
    - Nest provider registration
  - added ADR for C1 boundary decision:
    - `docs/ADR/015-chat-record-model-and-runtime-session-boundary.md`
  - updated docs:
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/DATA-MODEL.md`
    - `docs/ROADMAP.md` (`C1` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- Step 5 requires canonical backend chat/history records before transport and streaming slices.
- Product boundary requires preserving split ownership:
  - backend owns user-facing record/history truth
  - OpenClaw owns runtime session/context truth
- Surface-aware threading must be explicit now so future web and non-web surfaces do not collapse into one global thread model.

### Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323190000_step5_c1_chat_domain_model/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-chat.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-chat-message.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- docs/ADR/015-chat-record-model-and-runtime-session-boundary.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/api run typecheck` - passed
- `corepack pnpm run typecheck` - failed in existing `packages/contracts` (`src/mutator/custom-fetch.ts`: missing `process` type), unrelated to C1 chat-domain changes

### Known risks

- C1 introduces storage/repository baseline only; chat transport/API behavior is intentionally deferred.
- Message append ordering in C1 is timestamp-based (`created_at`) and does not yet include explicit streaming/event sequencing semantics.
- `surface` enum is intentionally `web`-only in C1; adding other surfaces requires explicit next-slice model extension.

### Next recommended step

- Proceed to Step 5 `C2` (web chat backend transport) using the C1 record model as persistence boundary.

### Ready commit message

- `feat(api): add step 5 c1 chat record domain model with surface-aware threading`

## 2026-03-23 - Step 4 closure stabilization slice

### What changed

- Closed Step 4 validation loop with a narrow web/docs stabilization slice:
  - hardened browser/runtime API base URL resolution in `packages/contracts/src/mutator/custom-fetch.ts`
  - normalized first-time assistant state handling in `apps/web/app/app/assistant-api-client.ts` (`GET /assistant` `404` -> `null`)
  - accepted `200|201` for onboarding/assistant create-publish-rollback-reset flows in web API clients
  - applied minimal visual baseline in `apps/web/app/globals.css` (cards, spacing, form/button states, typography)
  - aligned hybrid live-test config to same-origin API pathing in `apps/web/.env.local` (`/api/v1` + rewrite target)
- Updated docs for Step 4 closure and stabilization:
  - `docs/CHANGELOG.md`
  - `docs/ROADMAP.md`
  - `docs/SESSION-HANDOFF.md`
- Added agent-facing hybrid live-test runbook:
  - created `docs/LIVE-TEST-HYBRID.md` for `local web + GKE api` validation flow
  - linked this runbook from:
    - `AGENTS.md`
    - `README.md`

### Why changed

- Live validation across two accounts surfaced stability gaps after onboarding/assistant bootstrap:
  - false-fatal `404` handling for assistant-not-created state
  - browser-side fetch fallback that could bypass same-origin proxy and fail in hybrid mode
- A minimal style baseline was required to make Step 4 control surface usable without waiting for full design/polish phases.
- Goal: close Step 4 as functionally complete and operationally verifiable without backend/API scope expansion.

### Files touched

- packages/contracts/src/mutator/custom-fetch.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/me-api-client.ts
- apps/web/app/globals.css
- docs/LIVE-TEST-HYBRID.md
- AGENTS.md
- README.md
- docs/CHANGELOG.md
- docs/ROADMAP.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- Manual live checks in hybrid mode (`local web + GKE api port-forward`) - passed for onboarding/assistant create/publish/apply paths

### Known risks

- Hybrid mode remains dependent on a stable local `kubectl port-forward` session for `svc/api` on `localhost:3001`.
- Full visual polish/design-system scope is intentionally deferred; current styling is baseline-only.

### Next recommended step

- Start Step 5 `Web Chat Core` (`C1`) while preserving Step 4 closure behavior.
- Optionally define a dedicated `Step 4.5 UI polish` milestone if design polish should be tracked independently before Step 5 expansion.

### Ready commit message

- `docs: close step 4 with hybrid stability fixes and minimal web styling baseline`

## What changed

- Completed Step 4 slice `B6` only (assistant activity/update markers in `apps/web`):
  - added lightweight `Assistant activity and updates` block to the user control surface
  - added non-intrusive ordinary markers for meaningful user-facing lifecycle updates
  - added recovery-worthy markers for apply failure/degraded outcomes and recent rollback/reset actions
  - added quiet no-update branch (`No visible assistant updates right now.`) to avoid notification noise
  - kept markers read-only and aligned with control-plane truth (no draft/version mutation side effects)
  - kept admin/debug runtime internals hidden from marker UI
  - updated web tests for:
    - ordinary marker visibility
    - recovery-worthy marker visibility
    - no-meaningful-update branch
- Completed Step 4 slice `B5` only (rollback/reset UX in `apps/web`):
  - added `Lifecycle safety controls` block with user-facing rollback and reset actions
  - rollback UX:
    - target-version input
    - explicit rollback action wired to `POST /assistant/rollback`
    - human-readable feedback after request
  - reset UX:
    - explicit semantics copy (reset assistant content; not account deletion)
    - required confirmation checkbox
    - required `RESET` typed confirmation
    - reset action wired to `POST /assistant/reset`
  - preserved lifecycle semantics from backend model:
    - rollback creates a new latest published snapshot from selected version
    - reset creates a new blank assistant content baseline while preserving ownership/workspace scope
  - preserved B1-B4 dashboard/editor/publish-apply state behavior
  - updated web tests for rollback flow and reset confirmation/execution flow
- Completed Step 4 slice `B4` only (publish/apply UX state model in `apps/web`):
  - added explicit publish/apply state labels in global status area
  - publish-state labels surfaced:
    - `Draft has changes`
    - `Publishing`
    - `Published`
    - `Draft only`
  - apply-state labels surfaced:
    - `Applying`
    - `Live`
    - `Failed`
    - `Not requested`
  - added rollback-availability visibility (`yes|no`) based on published version history
  - added `Publish draft` UI action wired to `POST /assistant/publish`
  - kept publish/apply separated in UX copy and backend mapping (no fake merged state)
  - kept runtime diagnostics/details hidden; only coarse user-safe status and message are displayed
  - updated web tests for publish/apply state mapping and publish action transition behavior
- Completed Step 4 slice `B3` only (dual-path setup flow in `apps/web`):
  - added `Assistant setup paths` block with two explicit branches:
    - quick start path
    - advanced setup path
  - quick start path applies a guided baseline into draft fields
  - advanced setup path applies manual display name + instructions into draft fields
  - both paths now write through control-plane draft API only:
    - `PATCH /assistant/draft`
  - when assistant is absent, setup path auto-creates assistant first via:
    - `POST /assistant`
    then applies draft update
  - setup flow explicitly does not publish and does not change runtime apply state directly
  - preserved B1/B2 behavior: onboarding gate, global publish/status bar, sectioned editor shell
  - updated web tests for quick-start and advanced-setup draft flow
- Completed Step 4 slice `B2` only (assistant editor sections in `apps/web`):
  - added sectioned assistant editor shell (not a wizard) under `/app` completed-onboarding branch
  - introduced visible editor sections:
    - Persona
    - Memory
    - Tools & Integrations
    - Channels
    - Limits & Safety Summary
    - Publish History
  - surfaced a global publish/status bar above editor sections with lifecycle truth:
    - draft truth (`draft.updatedAt`)
    - draft publish state (unpublished changes vs matches latest published snapshot)
    - published truth (`latestPublishedVersion`)
    - apply truth (`runtimeApply.status` + optional error)
  - kept B1 create-assistant flow for assistant-absent state
  - kept onboarding gate and protected route behavior unchanged
  - updated web tests for section visibility and assistant-absent behavior
- Completed Step 4 slice `B1` only (assistant dashboard shell in `apps/web`):
  - replaced completed-onboarding `/app` "Me" view with a minimal assistant-first dashboard shell
  - added primary status/control block that surfaces control-plane truth:
    - draft truth (`draft.updatedAt`)
    - published truth (`latestPublishedVersion`)
    - apply truth (`runtimeApply.status` + optional apply error message)
  - added basic assistant summary block with assistant identity, draft summary, and apply version pointers
  - preserved existing protected route + onboarding gate behavior
  - added web assistant API client wiring:
    - `GET /assistant` returns `null` on `404` for assistant-not-created state
    - `POST /assistant` creates assistant from the dashboard when absent
  - updated web tests for dashboard completed branch and assistant-absent branch
- Closed the remaining A8 apply-route compatibility gap:
  - added workflow-driven OpenClaw source patching in `.github/workflows/openclaw-dev-image-publish.yml`
  - added patch file `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`
  - patch injects auth-protected endpoint `POST /api/v1/runtime/spec/apply` into OpenClaw gateway HTTP server
  - endpoint validates minimal payload shape and returns JSON ack instead of `404`
- Added deterministic OpenClaw rollout wiring for patched images:
  - introduced `openclaw.image.digest` in Helm values and deployment template (digest-aware image ref)
  - OpenClaw workflow now reads docker build digest output and updates both:
    - `openclaw.image.tag`
    - `openclaw.image.digest`
    in `infra/helm/values-dev.yaml`
  - this ensures Argo applies a real OpenClaw rollout after each patched image build, even when approved SHA tag string is unchanged
- Added OpenClaw pre-session guidance baseline for agent startup discipline:
  - created `docs/OPENCLAW-PRESESSION.md` with mandatory OpenClaw docs pack, role-based optional links, and a 60-second pre-session checklist
  - updated `AGENTS.md` mandatory startup reading order to include `docs/OPENCLAW-PRESESSION.md`
  - recorded this baseline in `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md`
- Applied a narrow A8 runtime stabilization slice before Step 4:
  - added missing API runtime adapter wiring in Helm values (`OPENCLAW_ADAPTER_ENABLED`, `OPENCLAW_BASE_URL`, `OPENCLAW_GATEWAY_TOKEN`)
  - enabled adapter in dev values with in-cluster OpenClaw URL (`http://openclaw:18789`)
  - hardened `AssistantRuntimePreflightService` to return degraded preflight state (`live=false`, `ready=false`) on adapter-level failures instead of surfacing unhandled `500`
- Fixed the `api-migrate` Argo PreSync hook lifecycle deadlock:
  - changed `cloud-sql-proxy` from a regular Job sidecar container to a sidecar-style `initContainer` with `restartPolicy: Always`
  - added explicit proxy readiness wait in `api-migrate` before Prisma commands run
  - result: migration hook can now complete and reach `Succeeded` instead of hanging in `Running` after SQL steps finish
- Applied deploy reliability hardening for automatic DB migration + verification on each sync:
  - added new Helm template `infra/helm/templates/api-migrate-job.yaml`
  - `api-migrate` runs as Argo `PreSync` hook using API image + same env/secret + Cloud SQL proxy in sidecar-style init lifecycle
  - hook command is strict:
    - `corepack pnpm run prisma:migrate:deploy`
    - `corepack pnpm run prisma:migrate:status`
  - sync fails if migration/apply/status fails (prevents app/schema drift)
- Enabled dev Argo application automated sync:
  - `prune: true`
  - `selfHeal: true`
  - `CreateNamespace=true`
- Added migration automation guidance in:
  - `README.md`
  - `infra/dev/gitops/README.md`
  - `infra/dev/gke/RUNBOOK.md`
- Applied a narrow OpenClaw deploy automation slice:
  - extended `.github/workflows/openclaw-dev-image-publish.yml` to auto-update `infra/helm/values-dev.yaml` `openclaw.image.tag` to `OPENCLAW_APPROVED_SHA` after successful image publish on `main`
  - added `paths-ignore` for `infra/helm/values-dev.yaml` to prevent self-trigger loops from workflow-generated commits
- This removes the manual OpenClaw GitOps tag promotion step after push.
- Applied a narrow post-A8 deploy-automation hotfix to keep dev auto-deploy stable after `main` pushes.
- Fixed dev image pinning workflow behavior in `.github/workflows/dev-image-publish.yml`:
  - now updates only `global.images.tag` in `infra/helm/values-dev.yaml`
  - no longer rewrites every YAML `tag` field
- Restored dev values tag strategy in `infra/helm/values-dev.yaml`:
  - `api.image.tag=""` and `web.image.tag=""` (inherit `global.images.tag`)
  - `openclaw.image.tag` pinned back to approved OpenClaw SHA `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- This removes the recurring failure mode where OpenClaw was forced to non-existent app commit tags.
- Completed Step 3 slice `A8` only (OpenClaw thin adapter for preflight + apply/reapply).
- Added dedicated runtime adapter boundary:
  - application-level adapter interface + coarse DTO/error model
  - infrastructure-level OpenClaw HTTP implementation only
- Added first adapter interactions:
  - runtime preflight via `GET /healthz` + `GET /readyz`
  - apply/reapply via `POST /api/v1/runtime/spec/apply`
  - apply payload source is A7 materialized spec only (`openclawBootstrap`, `openclawWorkspace`, `contentHash`)
- Added apply execution flow service and wired lifecycle actions:
  - publish/rollback/reset now attempt runtime apply after materialization
  - apply-state transitions are explicit: `pending -> in_progress -> succeeded|failed|degraded`
  - coarse adapter error categories are persisted into `runtimeApply.error`
- Added two control-plane endpoints:
  - `POST /api/v1/assistant/reapply`
  - `GET /api/v1/assistant/runtime/preflight`
- Added OpenClaw adapter env/config baseline in `packages/config` + API env examples.
- Preserved architectural boundaries:
  - domain/application layers stay OpenClaw-agnostic
  - no chat relay, no Telegram/channels work
  - no behavior-level OpenClaw integration
- Updated docs:
  - `docs/ADR/014-openclaw-apply-reapply-adapter.md`
  - `docs/ARCHITECTURE.md`
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A8` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- Platform-managed updates should be visible enough to feel trustworthy, but not noisy enough to feel intrusive.
- B6 introduces lightweight markers that separate ordinary updates from recovery-worthy events while preserving the soft auto-update model.
- This keeps user-facing transparency high without leaking admin/support diagnostics or turning the UI into an alert feed.
- Step 4 requires safe lifecycle recovery controls in user-facing UI before deeper activity/history work.
- B5 provides rollback/reset controls that match backend semantics and force explicit reset confirmation to prevent accidental destructive assistant-content resets.
- The UI now communicates rollback vs reset consequences without introducing account-deletion behavior or hiding meaningful impact.
- Step 4 requires a user-friendly but honest lifecycle model where users can understand publish and apply as separate truths.
- B4 makes publish/apply progress and failure outcomes visible without exposing raw runtime internals.
- This keeps lifecycle transparency aligned with control-plane state and prepares rollback/reset UX work in B5.
- Step 4 requires setup UX that supports both fast-start users and advanced users while preserving explicit lifecycle truth.
- B3 introduces two setup paths that always land in draft state, preventing hidden live-state mutation and avoiding accidental publish side effects.
- This keeps control-plane consistency with B1/B2 and prepares B4 publish/apply UX without widening into full persona/memory feature depth.
- Step 4 requires a sectioned control surface so assistant management does not collapse into one oversized settings page.
- B2 establishes editor information architecture and keeps lifecycle status globally visible while preserving draft/publish/apply control-plane truth.
- This creates a stable foundation for B3-B6 without introducing chat-first drift or raw runtime file exposure.
- Step 4 product order requires assistant control surface visibility before chat expansion.
- Prior `/app` completed branch showed account/workspace baseline only, so assistant lifecycle/apply truth was not visible to users.
- B1 introduces a minimal assistant-managed shell that keeps control-plane lifecycle truth explicit without expanding into full editor/chat/tasks/memory scope.
- Live A8 check after runtime wiring fix showed one final blocker before Step 4:
  - preflight was healthy, but `publish/reapply` still failed because OpenClaw returned `404` on `/api/v1/runtime/spec/apply`
- This slice restores the exact A8 route contract while keeping domain/application boundaries and avoiding behavior-level runtime expansion.
- Post-fix live check showed patched OpenClaw route was still absent because deployment did not roll:
  - OpenClaw image tag remained text-identical (`approved SHA`) and `IfNotPresent` prevented guaranteed refresh
  - deployment spec therefore stayed effectively unchanged and existing pod/image digest remained old
- Digest pinning closes this rollout gap without changing the approved-SHA governance model.
- Team requested a single source for OpenClaw pre-session reading so every new agent session starts with consistent runtime/ops assumptions.
- This reduces session drift when working on Step 4+ slices that depend on stable control-plane/runtime boundary understanding.
- Live A1-A8 validation showed A8 runtime drift in dev:
  - adapter env/secret wiring was absent in API runtime values, so apply path failed as configuration-disabled
  - preflight endpoint surfaced adapter exceptions as `500`, making operator/UX checks noisy
- This slice keeps A8 boundary/scope unchanged while making runtime status reporting stable and explicit.
- User-required turnkey deploy path was still blocked by one recurring issue: successful migration SQL with non-terminating hook lifecycle.
- The previous Job-sidecar pattern left `api-migrate` in `Running/Terminating`, which blocked Argo sync completion and required manual cleanup.
- The fix keeps the same migration guarantees but removes the hook completion deadlock.
- User requirement: deploy must be turnkey and stable without manual DB migration steps.
- Previous flow allowed successful rollout while migrations could be skipped/failing, creating future break risk.
- New PreSync migration hook guarantees schema update + verification before API rollout is considered successful.
- User requirement: no manual OpenClaw deploy/tag step after push.
- OpenClaw image build was automated, but tag promotion in GitOps values was still manual.
- The new workflow step closes this gap while preserving separation:
  - app workflow controls `global.images.tag`
  - OpenClaw workflow controls `openclaw.image.tag`
- The previous broad `sed` replacement rewrote all `tag:` lines in dev values, including OpenClaw pinning.
- That caused `openclaw` rollout failures (`ImagePullBackOff`) when app commit SHA tags did not exist for OpenClaw image.
- The hotfix makes image pinning deterministic and aligned with intended ownership:
  - app deploys follow `${GITHUB_SHA}` via `global.images.tag`
  - OpenClaw remains pinned to approved source SHA
- A8 activates the first real runtime bridge while preserving control-plane boundaries from O6/A7.
- Materialized spec is now not only stored but also consumed by a thin adapter for runtime apply/reapply.
- Coarse failure outcomes are explicitly surfaced in apply state for later UX/admin use.

## Decisions made

- OpenClaw integration remains adapter-only (infrastructure layer); no OpenClaw transport types in domain/application.
- HTTP remains the first transport; WebSocket remains out of scope.
- A8 adapter interactions are intentionally narrow:
  - preflight probes (`/healthz`, `/readyz`)
  - apply/reapply of materialized spec (`/api/v1/runtime/spec/apply`)
- Coarse boundary error model is stable and explicit:
  - `runtime_unreachable`
  - `auth_failure`
  - `timeout`
  - `invalid_response`
  - `runtime_degraded`
- Reapply is explicit and does not create a new published version.

## Files touched

- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- .github/workflows/openclaw-dev-image-publish.yml
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- infra/helm/templates/openclaw-deployment.yaml
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- AGENTS.md
- docs/OPENCLAW-PRESESSION.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- infra/helm/templates/api-migrate-job.yaml
- infra/dev/gitops/argocd/application-dev.yaml
- .github/workflows/openclaw-dev-image-publish.yml
- README.md
- infra/dev/gitops/README.md
- infra/dev/gke/RUNBOOK.md
- .github/workflows/dev-image-publish.yml
- infra/helm/values-dev.yaml
- apps/api/.env.dev.example
- apps/api/.env.local.example
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts
- apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts
- apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts
- apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts
- apps/api/src/modules/workspace-management/application/reset-assistant.service.ts
- apps/api/src/modules/workspace-management/domain/assistant.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- packages/config/src/api-config.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/step2-client.ts
- packages/contracts/src/generated/model/\*
- docs/ADR/014-openclaw-apply-reapply-adapter.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- No new Prisma migration in A8.

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed

## Known risks

- Migration hook depends on Cloud SQL access rights for API runtime GSA (`roles/cloudsql.client`).
- If Cloud SQL IAM/scopes are broken, sync will now fail fast (desired behavior) until infra permissions are fixed.
- Argo application status can remain stale (`operationState`) after forced hook cleanup; if observed, clear the stale operation once and then rely on the fixed hook template for future sync cycles.
- Runtime apply endpoint contract in OpenClaw is assumed at `/api/v1/runtime/spec/apply`; any drift must be handled via adapter contract update.
- Current OpenClaw compatibility endpoint acknowledges apply payloads and validates shape/auth, but does not yet execute behavior-level assistant runtime mutation.
- Existing historical published versions without materialized spec will fail apply/reapply with `invalid_response` until backfilled/materialized.
- Adapter is synchronous request/response only; no async apply job tracking yet.

## Next recommended step

- Commit/push this hook lifecycle fix, then run one `main` push verification cycle:
  - confirm `api-migrate` reaches `Succeeded` (not `Running/Terminating`)
  - confirm workflow updates only `global.images.tag`
  - confirm OpenClaw workflow updates `openclaw.image.tag` to approved SHA
  - confirm Argo auto-sync completes without manual terminate/delete operations.
