# SESSION-HANDOFF

## 2026-03-25 - ADR-048: native OpenClaw runtime plan (fork-owned code)

### What changed

- Added [docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md](ADR/048-native-openclaw-runtime-from-persai-apply-chat.md): phased fork-side plan (persist apply, session mapping, hydrate persona/memory/tools from `openclawWorkspace` / bootstrap, delegate chat to native agent pipeline, retire compat echo), pointers to fork files (`agent-command`, hooks/cron turn, sessions store), materialization reference in `apps/api`.
- Linked ADR-048 from `docs/API-BOUNDARY.md` (PersAI→OpenClaw contract section).
- `docs/CHANGELOG.md` updated.

### Why changed

- User asked for plan + code for full OpenClaw features with PersAI settings; implementation cannot live in `apps/api` per ADR-012 — ADR records architecture and fork integration phases; executable bridge belongs in the OpenClaw fork PR.

### Files touched (high level)

- `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`, `docs/API-BOUNDARY.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only.

### Next recommended step

- Spike in fork: call `runCronIsolatedAgentTurn` or `agentCommandFromIngress` from runtime HTTP handlers after loading stored apply payload; open PR on `kurock09/openclaw`, then bump `openclaw-approved-sha.txt`.

### Ready commit message

- `docs(adr): add 048 native openclaw runtime from persai apply chat plan`

## 2026-03-25 - Phase B: OpenClaw runtime smoke in LIVE-TEST-HYBRID

### What changed

- Extended [docs/LIVE-TEST-HYBRID.md](LIVE-TEST-HYBRID.md) with **Phase B: OpenClaw runtime smoke**: authenticated `GET /api/v1/assistant/runtime/preflight` through hybrid proxy, optional `kubectl port-forward` to `svc/openclaw:18789` for `healthz`/`readyz`, streaming chat check in `/app`, contract link and GitOps pin note.
- Logged in [docs/CHANGELOG.md](CHANGELOG.md).

### Why changed

- After Phase A contract freeze, operators need a single runbook step for “does OpenClaw work after deploy” without rereading adapter code.

### Files touched (high level)

- `docs/LIVE-TEST-HYBRID.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only.

### Next recommended step

- Run Phase B checks after your deploy; then fork/native runtime parity or Telegram/MAX delivery slices as separate ADR-backed work.

### Ready commit message

- `docs: add phase b openclaw runtime smoke to live-test hybrid`

## 2026-03-25 - Phase A: PersAI to OpenClaw HTTP runtime contract (v1)

### What changed

- Added design-freeze subsection **PersAI to OpenClaw HTTP runtime contract (v1)** to `docs/API-BOUNDARY.md`: normative contract (paths, JSON bodies, NDJSON stream records, auth header, env config keys, adapter error mapping, retry scope), explicit out-of-scope surfaces (Telegram/WhatsApp/MAX on this HTTP API), and compat patch reference behavior for drift checks against `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch` and [ADR-012](ADR/012-openclaw-fork-source-and-deploy-boundary.md).
- Linked the contract from `docs/ARCHITECTURE.md` under OpenClaw boundary.
- Recorded the slice in `docs/CHANGELOG.md`.

### Why changed

- Phase A requires a single documentation anchor so fork/runtime implementers can match PersAI’s adapter without reading Nest code.

### Files touched (high level)

- `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only; no automated tests required.

### Known risks / intentional limits

- Contract documents current adapter + patch behavior; native fork parity remains a later slice.

### Next recommended step

- Phase B/C: deploy validation and/or native runtime parity in fork; extend contract only via explicit doc + ADR if the HTTP surface changes.

### Ready commit message

- `docs: add phase a persai-to-openclaw http runtime contract v1`

## 2026-03-25 - Prisma AbuseSurface enum mapping (web chat stream 500)

### What changed

- Added `@@map("abuse_surface")` to `enum AbuseSurface` in `apps/api/prisma/schema.prisma` so generated SQL uses the existing Postgres enum from Step 10 G2 migrations.
- Regenerated Prisma client (`pnpm --filter @persai/api run prisma:generate`).
- Restored `apps/web/next-env.d.ts` to reference `./.next/types/routes.d.ts` (avoid dev-only path).
- Dropped spurious working-tree noise via `git restore` on `app-flow.client.tsx`, `app-flow.client.test.tsx`, and `assistant-governance.entity.ts` where diffs were empty.

### Why changed

- Live `POST .../assistant/chat/web/stream` returned 500: Prisma referenced non-existent type `public.AbuseSurface` while the DB defines `abuse_surface`.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/web/next-env.d.ts`
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed

### Known risks / intentional limits

- Deploy `api` required for production; no DB migration change (schema already matched DB naming).

### Next recommended step

- Deploy API and re-verify web chat streaming end-to-end.

### Ready commit message

- `fix(api): map AbuseSurface prisma enum to abuse_surface for stream abuse upserts`

## 2026-03-24 - Step 10 G5 WhatsApp and MAX readiness hardening

### What changed

- Hardened OpenClaw provider/surface readiness projection so configured state now resolves from canonical provider binding repository for:
  - `telegram`
  - `whatsapp`
  - `max`
- Removed remaining Telegram-only configured-state assumption for future providers:
  - `whatsapp` and `max` are no longer hardcoded as unconfigured in projection
- Preserved explicit non-flat surface model:
  - WhatsApp surface remains `whatsapp_business`
  - MAX remains split into `max_bot` and `max_mini_app`
- Kept Telegram managed SecretRef lifecycle usability gate intact on top of binding readiness.
- Added targeted G5 test coverage for provider-configured readiness and MAX split-surface behavior.
- Added ADR-047 and updated roadmap/docs for G5.

### Why changed

- G5 requires architecture-only hardening so WhatsApp and MAX can be implemented later without redesign, while preserving existing web/Telegram/system-notification behavior.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/test/openclaw-channel-surface-bindings-g5.test.ts`
- `docs/ADR/047-whatsapp-max-readiness-hardening-g5.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings-g5.test.ts` — passed

### Known risks / intentional limits

- G5 does not implement WhatsApp runtime delivery flow yet.
- G5 does not implement MAX bot or MAX mini-app runtime delivery flow yet.
- Non-Telegram secret lifecycle policies for WhatsApp/MAX remain future work.

### Next recommended step

- Step 11 **H1** design language and product shell alignment.

### Ready commit message

- `refactor(api): harden step 10 g5 provider-surface readiness for whatsapp and max without delivery rollout`

## 2026-03-24 - Step 10 G4 retention/delete/compliance baseline

### What changed

- Finalized explicit MVP legal acceptance behavior:
  - onboarding now requires `acceptTermsOfService=true` and `acceptPrivacyPolicy=true`
  - persisted acceptance version/timestamp fields on `app_users`
- Extended `GET /api/v1/me` read model with explicit `compliance` state:
  - required/accepted ToS and Privacy versions
  - acceptance timestamps
  - retention/delete/audit baseline mode summary
- Tightened onboarding completion semantics:
  - `completed` now requires workspace presence + required legal acceptance
  - `pending` is returned when either workspace or legal acceptance is missing
- Finalized MVP retention/delete baseline as explicit platform behavior:
  - no hidden TTL auto-purge behavior
  - delete remains explicit action-only
  - reset and ownership transfer/recovery stay non-delete actions
- Added ADR-046 and updated roadmap/docs for G4.
- Applied minimal corrective middleware route coverage for existing protected endpoints added in previous slices (Telegram secret lifecycle, admin abuse unblock, admin ownership transfer/recovery).

### Why changed

- G4 requires unambiguous real-platform retention/delete/compliance behavior with explicit user trust boundaries and no hidden retention surprises.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260329130000_step10_g4_retention_delete_compliance_baseline/migration.sql`
- `apps/api/src/modules/identity-access/application/compliance-baseline.ts`
- `apps/api/src/modules/identity-access/application/current-user-state.types.ts`
- `apps/api/src/modules/identity-access/application/get-current-user-state.service.ts`
- `apps/api/src/modules/identity-access/application/upsert-onboarding.service.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/api/test/step2-auth-foundation.e2e.test.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/046-retention-delete-compliance-baseline-g4.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/step2-auth-foundation.e2e.test.ts` — passed
- `corepack pnpm --filter @persai/web run test -- --run app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- G4 does not introduce enterprise retention scheduler/legal hold/regional retention matrix.
- G4 does not add full account/workspace erasure orchestration endpoint.
- Retention remains explicit user/action-driven in MVP; no silent background purge jobs.

### Next recommended step

- Step 10 **G5** WhatsApp and MAX readiness hardening.

### Ready commit message

- `feat(api-web-contracts): add step 10 g4 explicit retention-delete-compliance baseline with legal acceptance state`

## 2026-03-24 - Step 10 G3 recovery and ownership transfer baseline

### What changed

- Added admin-governed ownership flow service and API surfaces:
  - `POST /api/v1/admin/assistants/ownership/transfer`
  - `POST /api/v1/admin/assistants/ownership/recover`
- Added dedicated admin controller/service wiring for ownership transfer and ownership recovery with explicit guarded parsing and conflict checks.
- Extended dangerous admin action scope and step-up action parsing with:
  - `admin.assistant.transfer_ownership`
  - `admin.assistant.recover_ownership`
- Implemented ownership guardrails:
  - assistant must be in admin workspace scope
  - transfer flow requires `currentOwnerUserId` match
  - target owner must be member of assistant workspace
  - target owner must not already own another assistant (MVP one-user-one-assistant rule)
- Defined and returned explicit consequences for attached resources:
  - `resetTriggered=false`
  - `deletionTriggered=false`
  - lifecycle versions preserved
  - memory/chat/task ownership links rebound via assistant owner relation
  - bindings + SecretRef lifecycle metadata preserved
  - prior audit history preserved
- Added ownership-flow audit events:
  - `assistant.ownership_transferred`
  - `assistant.ownership_recovered`
- Added ADR-045 and updated roadmap/docs for G3.

### Why changed

- G3 requires explicit recovery and ownership transfer flows that remain separate from reset/delete semantics, enforce ownership boundaries through governed rules, and preserve audit/RBAC assumptions.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/manage-admin-assistant-ownership.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-assistant-ownership.controller.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/manage-admin-assistant-ownership.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/045-recovery-and-ownership-transfer-g3.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-assistant-ownership.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts` — passed

### Known risks / intentional limits

- No end-user self-service ownership transfer path in G3 (admin-governed flows only).
- No cross-workspace ownership migration in G3.
- Ownership transfer/recovery does not introduce automatic publish/reset/delete behavior and does not broaden into retention/compliance deletion workflows.

### Next recommended step

- Step 10 **G4** retention/delete/compliance baseline.

### Ready commit message

- `feat(api-contracts): add step 10 g3 admin ownership recovery and transfer flows with explicit resource consequences`

## 2026-03-24 - Step 10 G2 abuse and rate-limit enforcement baseline

### What changed

- Added canonical abuse/rate-limit persistence model:
  - `assistant_abuse_guard_states`
  - `assistant_abuse_assistant_states`
- Added centralized abuse protection service for web chat transport boundaries with explicit layered controls:
  - per-user-per-assistant throttle window
  - per-assistant aggregate throttle window
  - surface-aware anti-flood hooks (`web_chat` active baseline)
  - quota-pressure-aware slowdown and temporary block behavior
- Hardened web chat boundaries to enforce G2 abuse decisions and return 429 when active:
  - `POST /api/v1/assistant/chat/web`
  - `POST /api/v1/assistant/chat/web/stream` (prepare path)
- Added admin abuse override/unblock endpoint:
  - `POST /api/v1/admin/abuse-controls/unblock`
  - role gate: `ops_admin|security_admin|super_admin` (+ narrow owner fallback)
  - clears active abuse blocks/slowdowns and applies temporary override window
- Added audit event:
  - `admin.abuse_unblock_applied`
- Added ADR-044 and updated roadmap/docs for G2.

### Why changed

- G2 requires finalized multi-layer abuse/rate-limit protection that goes beyond one rule, preserves normal user flows, aligns with quotas, and gives operators explicit audited unblock recovery controls.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260329100000_step10_g2_abuse_rate_limit_enforcement/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-abuse-guard.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-abuse-guard.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-abuse-guard.repository.ts`
- `apps/api/src/modules/workspace-management/application/enforce-abuse-rate-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-abuse-controls.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-abuse-controls.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforce-abuse-rate-limit.test.ts`
- `apps/api/test/manage-admin-abuse-controls.test.ts`
- `packages/config/src/api-config.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/044-abuse-and-rate-limit-enforcement-g2.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/enforcement-points.test.ts` — passed

### Known risks / intentional limits

- G2 activates abuse enforcement on web chat boundaries only; Telegram/WhatsApp/MAX transport-path activation remains future slice work.
- Slowdown is implemented as temporary 429 response window (explicit retry friction), not delayed queue execution.
- G2 intentionally does not add content-moderation or semantic abuse classification systems.

### Next recommended step

- Step 10 **G3** recovery and ownership transfer flows.

### Ready commit message

- `feat(api-contracts): add step 10 g2 multi-layer abuse and rate-limit enforcement with admin unblock override`

## 2026-03-24 - Step 10 G1 secret lifecycle hardening baseline

### What changed

- Added canonical managed SecretRef lifecycle hardening in assistant governance `secret_refs` (`persai.secretRefs.v1`) with Telegram baseline entry `refs.telegram_bot_token`.
- Added Telegram secret lifecycle APIs:
  - `POST /api/v1/assistant/integrations/telegram/rotate`
  - `POST /api/v1/assistant/integrations/telegram/revoke`
  - `POST /api/v1/assistant/integrations/telegram/emergency-revoke`
- Extended Telegram connect payload to accept optional `ttlDays` (`1..365`) and rotate SecretRef lifecycle metadata during connect/rotate.
- Extended Telegram integration state response with non-sensitive `secretLifecycle` metadata:
  - lifecycle status (`active|revoked|emergency_revoked|expired|legacy_unmanaged`)
  - ref key / manager / version
  - rotate/revoke/expiration timestamps and legacy fallback marker
- Hardened OpenClaw channel/surface projection so Telegram provider readiness now checks binding + SecretRef lifecycle usability (with narrow legacy compatibility fallback for pre-G1 active bindings).
- Added secret lifecycle audit events:
  - `assistant.secret_ref_rotated`
  - `assistant.secret_ref_revoked`
  - `assistant.secret_ref_emergency_revoked`
- Added ADR-043 and updated roadmap/docs for G1.

### Why changed

- Product baseline requires managed secret lifecycle properties (rotation, revoke, TTL, audit, emergency revoke) while preserving SecretRef delivery discipline and avoiding secret-value exposure across UI/domain surfaces.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/assistant-secret-refs-lifecycle.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/test/assistant-secret-refs-lifecycle.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/043-secret-lifecycle-hardening-g1.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/assistant-secret-refs-lifecycle.test.ts` — passed

### Known risks / intentional limits

- G1 lifecycle hardening is implemented for assistant managed SecretRefs (Telegram baseline); broad provider matrix expansion is deferred.
- TTL is enforced at read/evaluation time (computed `expired` status); no background scheduler is added in this slice.
- Existing admin notification webhook `signingSecret` storage model is unchanged in G1.

### Next recommended step

- Step 10 **G2** abuse and rate limit enforcement.

### Ready commit message

- `feat(api-contracts): add step 10 g1 managed secret lifecycle rotation revoke ttl and emergency revoke for telegram secret refs`

## 2026-03-24 - Step 9 F6 progressive rollout and rollback controls baseline

### What changed

- Added platform rollout persistence model:
  - `assistant_platform_rollouts`
  - `assistant_platform_rollout_items`
- Added admin rollout APIs:
  - `GET /api/v1/admin/platform-rollouts`
  - `POST /api/v1/admin/platform-rollouts`
  - `POST /api/v1/admin/platform-rollouts/{rolloutId}/rollback`
- Added rollout service behavior for platform-managed layers:
  - validates bounded rollout patch payload
  - selects targeted assistants by rollout percentage
  - captures per-assistant pre-update governance snapshot
  - updates only platform-managed governance fields
  - triggers soft reapply against latest published version where available
  - stores per-assistant apply outcomes (`succeeded|degraded|failed|skipped`)
- Added explicit rollback behavior:
  - restores captured governance snapshots
  - reapply after restore to align runtime
  - records rollback outcomes and marks rollout operation as `rolled_back`
- Extended dangerous admin step-up action set:
  - `admin.rollout.apply`
  - `admin.rollout.rollback`
- Hardened dangerous role model to be action-scoped:
  - plan dangerous actions stay `business_admin|super_admin`
  - rollout dangerous actions require `ops_admin|super_admin`
  - legacy owner fallback remains compatibility path
- Added audit events for rollout operations:
  - `admin.platform_rollout_applied`
  - `admin.platform_rollout_rolled_back`
- Added `/app` owner section "Platform rollout controls" with:
  - rollout percent + target patch JSON form
  - rollback selector
  - recent rollout operation summary
- Added ADR-042 and updated roadmap/docs for F6.

### Why changed

- F6 requires real operator controls for progressive platform-managed updates with rollback support, while preserving immutable user-owned assistant version truth and keeping soft update behavior.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328220000_step9_f6_rollout_rollback_controls/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-platform-rollouts.service.ts`
- `apps/api/src/modules/workspace-management/application/platform-rollout.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-platform-rollouts.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/042-progressive-rollout-and-rollback-controls-f6.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F6 rollout targeting is percentage-based single-wave execution per request; no automatic staged scheduler is added.
- No automatic rollback-by-threshold policy in this slice.
- Rollout UI uses JSON patch input for platform-managed fields and intentionally does not add a full policy editor.

### Next recommended step

- Step 10 **G1** secret lifecycle hardening.

### Ready commit message

- `feat(api-web): add step 9 f6 progressive rollout and rollback controls for platform-managed updates`

## 2026-03-24 - Step 9 F5 admin system notifications baseline

### What changed

- Added admin system-notification channel persistence model:
  - `workspace_admin_notification_channels`
  - baseline channel type: `webhook`
- Added admin notification delivery log model:
  - `admin_notification_deliveries`
- Added admin notifications API surface:
  - `GET /api/v1/admin/notifications/channels`
  - `PATCH /api/v1/admin/notifications/channels/webhook`
- Added bounded admin notification channel RBAC rules:
  - read/list uses existing admin read surface authorization
  - webhook channel write/manage requires `ops_admin|security_admin|super_admin` (legacy owner fallback preserved)
- Added best-effort non-blocking webhook delivery integration on selected high-signal audit events:
  - `assistant.runtime.apply_failed`
  - `assistant.runtime.apply_degraded`
  - `assistant.runtime.apply_succeeded`
  - `admin.plan_created`
  - `admin.plan_updated`
- Added `/app` admin system-notifications section:
  - webhook channel enable/config form
  - channel state list with latest delivery summary
- Added ADR-041 and updated roadmap/docs for F5.

### Why changed

- F5 requires a mandatory admin notification channel so critical system signals can reach admins outside web UI while preserving web as the primary admin workspace.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328190000_step9_f5_admin_system_notifications/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-system-notification.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-notification-channels.service.ts`
- `apps/api/src/modules/workspace-management/application/deliver-admin-system-notification.service.ts`
- `apps/api/src/modules/workspace-management/application/append-assistant-audit-event.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-notifications.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/041-admin-system-notifications-f5.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F5 supports webhook channel baseline only; no provider matrix, escalation policies, or digest scheduling.
- Delivery is best-effort and non-blocking; retries/backoff orchestration is intentionally out of scope.
- Signal set is intentionally bounded to selected high-signal events in this slice.

### Next recommended step

- Step 9 **F6** progressive rollout and rollback controls baseline.

### Ready commit message

- `feat(api-web): add step 9 f5 admin system-notification channel baseline with webhook delivery`

## 2026-03-24 - Step 9 F4 business cockpit baseline

### What changed

- Added role-gated admin business cockpit endpoint:
  - `GET /api/v1/admin/business/cockpit`
- Added centralized business cockpit read-model service:
  - `ResolveAdminBusinessCockpitService`
  - returns bounded business views for:
    - active assistants
    - active chats
    - channel split
    - publish/apply success (last 7 days snapshot)
    - quota pressure
    - plan usage snapshot
- Added dedicated admin business cockpit UI section in `/app`:
  - serious, scanable read-only business view
  - separate from ops cockpit section
- Kept operational control surfaces in ops cockpit only; business cockpit remains visibility-only.
- Added ADR-040 and updated roadmap/docs for F4.

### Why changed

- F4 requires a compact business cockpit baseline so platform operators can track commercial/product health signals without turning admin UI into a heavy BI dashboard.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/business-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-business-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-business.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/040-business-cockpit-baseline-f4.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- F4 is a baseline snapshot and does not provide long-range BI analytics, trend charts, or export tooling.
- Channel split is bounded to available control-plane signals and currently reflects MVP channel reality.
- Business cockpit intentionally does not add lifecycle/runtime action controls.

### Next recommended step

- Step 9 **F5** admin system notifications baseline.

### Ready commit message

- `feat(api-web): add step 9 f4 business cockpit baseline with bounded commercial and product views`

## 2026-03-24 - Step 9 F3 ops cockpit baseline

### What changed

- Added role-gated admin ops cockpit read endpoint:
  - `GET /api/v1/admin/ops/cockpit`
- Added centralized ops cockpit read-model service:
  - `ResolveAdminOpsCockpitService`
  - returns bounded operator snapshot for:
    - assistant presence and latest published version
    - runtime apply status and error pointer
    - runtime preflight (`live|ready|checkedAt`)
    - topology awareness (`adapterEnabled`, OpenClaw host)
    - high-signal incident projections
- Added bounded incident signal model in cockpit payload:
  - `assistant_absent`
  - `assistant_not_published`
  - `runtime_preflight_unhealthy`
  - `runtime_apply_failed`
  - `runtime_apply_degraded`
  - `runtime_apply_in_progress`
- Added cockpit control visibility model:
  - `reapplySupported` surfaced when latest published version exists
  - `restartSupported` surfaced as `false` in F3 by design
- Added `/app` ops cockpit section (admin/owner surface) with:
  - assistant/runtime status summary
  - publish/apply truth
  - incident signal list
  - runtime topology line
  - `Reapply latest published version` button wired to existing `POST /api/v1/assistant/reapply`
- Added ADR-039 and updated roadmap/docs for Step 9 F3.

### Why changed

- F3 requires a serious and readable operational cockpit baseline so operators can understand assistant/runtime health and lifecycle truth without relying on raw logs or manual DB inspection.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/ops-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-ops.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `apps/web/app/globals.css`
- `docs/ADR/039-ops-cockpit-baseline-f3.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- F3 does not add restart/redeploy orchestration controls.
- F3 does not add historical BI, trends, or dense metrics dashboards.
- Cockpit is intentionally a bounded high-signal snapshot, not an incident timeline/explorer.

### Next recommended step

- Step 9 **F4** business cockpit baseline, reusing F3 operational truth and F1/F2 governance constraints.

### Ready commit message

- `feat(api-web): add step 9 f3 ops cockpit baseline with status signals and reapply control`

## 2026-03-24 - Step 9 F2 admin RBAC and dangerous-action step-up

### What changed

- Added explicit admin RBAC persistence model:
  - `app_user_admin_roles`
  - roles:
    - `ops_admin`
    - `business_admin`
    - `security_admin`
    - `super_admin`
- Added centralized admin authorization/step-up service:
  - `AdminAuthorizationService`
  - role-gated admin read access
  - dangerous admin action enforcement with signed short-lived step-up tokens
- Added admin step-up challenge endpoint:
  - `POST /api/v1/admin/step-up/challenge`
  - action-scoped challenge for:
    - `admin.plan.create`
    - `admin.plan.update`
- Hardened dangerous admin writes:
  - `POST /api/v1/admin/plans` requires `x-persai-step-up-token` for `admin.plan.create`
  - `PATCH /api/v1/admin/plans/{code}` requires `x-persai-step-up-token` for `admin.plan.update`
- Upgraded admin read auth checks from owner-only to role-based (with narrow owner fallback compatibility):
  - `GET /api/v1/admin/plans`
  - `GET /api/v1/admin/plans/visibility`
- Added audit role/actor context for admin actions:
  - new event: `admin.step_up_challenge_issued`
  - enriched events: `admin.plan_created`, `admin.plan_updated` with actor roles + step-up verified flags
- Contracts/OpenAPI updated for:
  - `POST /admin/step-up/challenge`
  - required step-up header on dangerous plan write operations
- Docs updated: ADR-038, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- F2 requires explicit non-collapsed admin role model and hardened dangerous-action confirmation flow so privileged admin operations are role-scoped and step-up protected.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328140000_step9_f2_admin_rbac_stepup/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/ADR/038-admin-rbac-and-stepup-f2.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed

### Known risks / intentional limits

- F2 does not add admin-role management API/UI (assignment/revocation workflows remain future scope).
- Step-up currently protects agreed dangerous plan write actions only; broader privileged-action matrix is future scope.
- Compatibility fallback (`workspace owner` -> implicit `business_admin`) remains intentionally narrow and transitional.

### Next recommended step

- Step 9 **F3** ops cockpit baseline using the F1/F2 audit + RBAC model as authorization and visibility foundation.

### Ready commit message

- `feat(api-web): add step 9 f2 admin rbac model and dangerous-action step-up enforcement`

## 2026-03-24 - Step 9 F1 append-only audit log hardening

### What changed

- Added canonical append-only audit persistence model:
  - `assistant_audit_events`
- Enforced append-only behavior at DB level for audit rows:
  - reject `UPDATE`
  - reject `DELETE`
- Added centralized audit append service in `workspace-management`:
  - `AppendAssistantAuditEventService`
- Wired critical high-signal audit coverage into existing control-plane flows:
  - assistant lifecycle:
    - `assistant.created`
    - `assistant.draft_updated`
    - `assistant.published`
    - `assistant.rollback_published`
    - `assistant.reset_published`
    - `assistant.reapply_requested`
  - runtime apply transitions:
    - `assistant.runtime.apply_in_progress`
    - `assistant.runtime.apply_succeeded`
    - `assistant.runtime.apply_failed`
    - `assistant.runtime.apply_degraded`
  - admin actions:
    - `admin.plan_created`
    - `admin.plan_updated`
  - policy/control:
    - `assistant.memory_forget_marker_appended`
  - channel binding and secret-adjacent token fingerprint change:
    - `assistant.telegram_connected`
    - `assistant.telegram_config_updated`
    - `assistant.telegram_token_fingerprint_updated`
- Docs updated: ADR-037, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- F1 requires critical control-plane and runtime-transition truth to be explicitly traceable in an append-only audit layer without turning audit into a noisy raw event dump.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328120000_step9_f1_append_only_audit_log_hardening/migration.sql`
- `apps/api/src/modules/workspace-management/application/append-assistant-audit-event.service.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/do-not-remember-assistant-memory.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `docs/ADR/037-append-only-audit-log-hardening-f1.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F1 does not add audit read/query APIs yet.
- F1 does not introduce broad chat-turn/event-stream raw dumping by design.
- There is still no dedicated secret management API in this slice; secret-adjacent coverage is limited to Telegram token fingerprint updates on connect.

### Next recommended step

- Step 9 **F2** admin RBAC and step-up actions, with audit events attached to privileged authorization transitions.

### Ready commit message

- `feat(api): add step 9 f1 append-only audit log hardening for lifecycle admin policy and runtime transitions`

## 2026-03-24 - Step 8 E6 provider and fallback baseline

### What changed

- Added explicit runtime provider/fallback projection service:
  - `ResolveRuntimeProviderRoutingService`
  - schema `persai.runtimeProviderRouting.v1`
- Added runtime routing model type:
  - `runtime-provider-routing.types.ts`
- Materialization now resolves provider routing baseline from:
  - effective capabilities
  - optional `policyEnvelope.runtimeProviderRouting` overrides
- Embedded `runtimeProviderRouting` into:
  - `openclawCapabilityEnvelope`
  - OpenClaw-facing materialization payloads (via existing envelope integration path)
- Added API validation script and test coverage:
  - `test:runtime-provider-routing`
  - updated envelope test fixture wiring for `runtimeProviderRouting`
- Docs updated: ADR-036, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- E6 requires explicit, resilient runtime primary/fallback behavior while keeping user-facing complexity minimal and aligned with existing entitlement/governance truth.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/runtime-provider-routing.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/runtime-provider-routing.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/036-provider-and-fallback-baseline-e6.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:runtime-provider-routing` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed

### Known risks / intentional limits

- E6 remains runtime-managed and provider-agnostic at execution level; it does not introduce vendor-level orchestration.
- No user-facing provider picker is added.
- No provider marketplace/plan-commerce provider packaging logic is added.

### Next recommended step

- Step 9 **F1** append-only audit log hardening.

### Ready commit message

- `feat(api): add step 8 e6 runtime provider fallback baseline routing`

## 2026-03-24 - Step 8 E5 integrations panel messenger presentation

### What changed

- Hardened `/app` user desktop integrations area into a messenger panel with three explicit cards:
  - Telegram
  - MAX
  - WhatsApp
- Telegram card now reflects real integration truth from E4:
  - `connected` state when binding exists
  - connectable state when allowed but not connected
  - not-allowed state when plan capability denies Telegram
- Preserved Telegram connect flow + post-connect configuration panel in the same card.
- MAX and WhatsApp are intentionally non-active in E5:
  - visually muted cards
  - explicit `Coming soon` labels
  - no connect action wired
- Added lightweight premium/warm card styling for uncluttered messenger presentation.
- Updated web app-flow tests to assert coming-soon state rendering.
- Docs updated: ADR-035, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E5 requires an honest user-facing integrations panel that matches messenger strategy and real binding truth without faking unsupported integrations.

### Files touched (high level)

- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `apps/web/app/globals.css`
- `docs/ADR/035-integrations-panel-messenger-presentation-e5.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- MAX and WhatsApp remain presentation-only in E5; connection and delivery are intentionally unsupported.
- Telegram card styling is premium baseline only; deeper polish belongs to later UX polish steps.

### Next recommended step

- Step 8 **E6** provider and fallback baseline over E1-E5 integration truths.

### Ready commit message

- `feat(web): add step 8 e5 messenger integrations panel with truthful states`

## 2026-03-24 - Step 8 E4 Telegram connection and delivery surface

### What changed

- Added canonical assistant-scoped channel binding persistence:
  - `assistant_channel_surface_bindings`
  - stores provider/surface state, policy/config, token fingerprint hint, and Telegram metadata
- Added Telegram integration control-plane endpoints:
  - `GET /assistant/integrations/telegram`
  - `POST /assistant/integrations/telegram/connect`
  - `PATCH /assistant/integrations/telegram/config`
- Implemented Telegram connect flow:
  - short token entry payload (`botToken`)
  - token verification via Telegram `getMe`
  - persisted `telegram` + `telegram_bot` active binding state
  - connected-state response payload (`persai.telegramIntegration.v1`) for UI
- Added web integrations-area UX for Telegram:
  - simple connect instruction flow + token input
  - connected state rendering
  - post-connect Telegram configuration panel
  - web remains primary control-plane surface
- Added best-effort bot profile sync:
  - display name and username from Telegram `getMe`
  - derived avatar URL when username is available
- Hardened E3 binding projection to read active Telegram binding truth from persistence (instead of static unconfigured assumption).
- Docs updated: ADR-034, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E4 requires real Telegram connection UX + persisted binding truth so Telegram can act as interaction/delivery surface without moving assistant control-plane ownership out of web.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260327120000_step8_e4_telegram_connection_surface/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-channel-surface-binding.repository.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/package.json`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/034-telegram-connection-and-delivery-surface-e4.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- E4 does not implement Telegram webhook ingestion or runtime delivery transport wiring; this slice is connect/config + binding truth.
- Raw Telegram bot token is not persisted in domain read model; connect flow uses verification and stores fingerprint/hint metadata for control-plane traceability.
- WhatsApp/MAX connection and delivery remain out of scope.

### Next recommended step

- Step 8 **E5** integrations panel and messenger binding UX expansion over the E4 Telegram connect baseline.

### Ready commit message

- `feat(api-web): add step 8 e4 telegram connect flow and binding surface`

## 2026-03-24 - Step 8 E3 channel and surface binding model hardening

### What changed

- Added explicit channel/surface binding projection resolver:
  - `ResolveOpenClawChannelSurfaceBindingsService`
  - schema `persai.openclawChannelSurfaceBindings.v1`
- Binding projection now models non-flat structure:
  - providers: `web_internal`, `telegram`, `whatsapp`, `max`, `system_notifications`
  - surfaces: `web_chat`, `telegram_bot`, `whatsapp_business`, `max_bot`, `max_mini_app`, `system_notification`
  - assistant-binding status/state at provider level
  - policy/config split at provider and surface levels
- Integrated `openclawChannelSurfaceBindings` into `openclawCapabilityEnvelope` and materialization outputs consumed by OpenClaw.
- Applied corrective hardening for prior channel assumptions:
  - preserved existing `channelsAndSurfaces.max` entitlement gate for compatibility
  - projected that gate into two distinct surfaces (`max_bot`, `max_mini_app`) to avoid flattening
- Added explicit unavailable-surface suppression list (`deniedSurfaceTypes` + `declaredSurfaceTypes`).
- Added API test script `test:openclaw-channel-surface-bindings` and updated envelope test to validate embedded channel/surface binding payload.
- Docs updated: ADR-033, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E3 requires provider+surface binding truth to be explicit and runtime-safe so OpenClaw can distinguish available, unavailable, and non-existent surfaces without Telegram-specific or flat-surface assumptions.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/openclaw-channel-surface-bindings.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/033-channel-surface-binding-model-e3.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed

### Known risks / intentional limits

- E3 is projection hardening only; no Telegram/WhatsApp/MAX delivery execution is implemented.
- Provider config refs are modeled as control-plane references and not connected to runtime channel provisioning in this slice.
- Existing plan entitlement source for MAX remains one coarse gate; split commercial/package controls for `max_bot` vs `max_mini_app` are deferred.

### Next recommended step

- Step 8 **E4** Telegram connection and delivery surface over the E3 binding baseline.

### Ready commit message

- `feat(api): add step 8 e3 channel-surface binding envelope hardening`

## 2026-03-24 - Step 8 E2 OpenClaw capability envelope hardening

### What changed

- Added explicit OpenClaw-facing capability envelope resolver:
  - `ResolveOpenClawCapabilityEnvelopeService`
  - schema `persai.openclawCapabilityEnvelope.v1`
- Materialization now projects `openclawCapabilityEnvelope` into:
  - governance layer snapshot
  - `openclawBootstrap`
  - `openclawWorkspace`
- Envelope now contains explicit runtime truth:
  - per-tool allow/deny + deny reason
  - per-group allow/deny lists
  - canonical declared tool set (`catalog.declaredToolCodes`) for exists/non-exists truth
  - per-surface allowances (`webChat|telegram|whatsapp|max`)
  - quota-related class restrictions for utility/cost-driving classes
  - explicit unavailable-tool suppression list (`deniedToolCodes`)
- Preserved tasks/reminders as non-commercial quota class in envelope restrictions:
  - `tasksAndRemindersExcludedFromCommercialQuotas`
- Added API test script `test:openclaw-capability-envelope`.
- Docs updated: ADR-032, `ARCHITECTURE`, `API-BOUNDARY`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E2 requires one explicit OpenClaw-facing capability envelope so runtime knows what exists, what is denied, and what is unavailable without relying on implied defaults.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/032-openclaw-capability-envelope-e2.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed

### Known risks / intentional limits

- E2 is projection hardening only; no backend runtime routing or tool execution framework is added.
- No per-tool admin UI control surface is added in E2.
- E2 does not introduce endpoint-by-endpoint per-tool enforcement expansion beyond existing control-plane gates.

### Next recommended step

- Step 8 **E3** channel/surface binding model hardening over the E1/E2 governance baseline.

### Ready commit message

- `feat(api): add step 8 e2 openclaw capability envelope with explicit suppression truth`

## 2026-03-24 - Step 8 E1 tool catalog and activation model

### What changed

- Added canonical governed tool catalog persistence:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- Added explicit tool model dimensions for control-plane governance:
  - capability group (`knowledge|automation|communication|workspace_ops`)
  - tool class (`cost_driving|utility`)
  - plan-scoped activation status (`active|inactive`)
- Hardened plan catalog create/update persistence flow:
  - plan tool-activation rows are synchronized from existing tool-class entitlement toggles
- Added centralized per-tool availability resolver:
  - `ResolveEffectiveToolAvailabilityService`
  - projects catalog + plan activation + effective class guardrail into materialization-safe truth
- Upgraded materialized tool-availability schema from class-only to per-tool model:
  - `persai.effectiveToolAvailability.v2`
- Added deterministic seed baseline tool catalog rows and default-plan activation rows.
- Docs updated: ADR-031, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E1 requires tools to be treated as a governed mini-system with explicit catalog and activation truth, while preserving the backend control-plane vs OpenClaw runtime boundary.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260327100000_step8_e1_tool_catalog_activation/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/application/effective-tool-availability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-tool-availability.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/tool-catalog-activation.test.ts`
- `apps/api/package.json`
- `docs/ADR/031-tool-catalog-and-activation-model-e1.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- E1 introduces persistence + materialization truth only; no per-tool admin/web UI controls are added in this slice.
- E1 does not add backend tool execution/routing logic; OpenClaw remains runtime execution owner.
- Class-level enforcement points from P6 remain active; endpoint-by-endpoint per-tool enforcement is not expanded in E1.

### Next recommended step

- Step 8 **E2** tool policy and OpenClaw capability envelope alignment over the E1 catalog/activation baseline.

### Ready commit message

- `feat(api): add step 8 e1 governed tool catalog and plan activation model`

## 2026-03-23 - Step 7 P1-P7 post-deploy live validation + hotfixes

### What changed

- Completed live validation on dev GKE for Step 7 P1-P7 user/admin flows after deploy.
- Verified deployed images aligned to the current release commit for both `api` and `web`.
- Confirmed live route availability and successful auth-gated responses for:
  - `GET /api/v1/admin/plans`
  - `GET /api/v1/admin/plans/visibility`
  - `GET /api/v1/assistant/plan-visibility`
- Confirmed admin plan creation and editing in UI and API:
  - `POST /api/v1/admin/plans` returns success (`201`)
  - `PATCH /api/v1/admin/plans/:code` returns success (`200`)
- Confirmed chat streaming happy path after entitlement correction:
  - stream completes
  - response persists
  - "Do not remember this" action remains available on committed assistant turns.
- Fixed two post-deploy regressions discovered during validation:
  - contracts path regression: `postAdminPlanCreate` was erroneously attached to `/admin/plans/visibility` in OpenAPI and was restored to `/admin/plans`
  - web client response guard: admin create path now accepts `201` and `200` as success for `POST /admin/plans`
- Regenerated contracts and revalidated web typecheck/tests.

### Why changed

- Deployment initially surfaced false 404 and false non-success errors caused by contract/client mismatch, not by backend route availability.
- This live pass was required to confirm P1-P7 product behavior end-to-end under real runtime conditions.

### Files touched (high level)

- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test` — passed
- Live cluster verification (`kubectl` + runtime logs) — passed for the P1-P7 target flows

### Known risks / intentional limits

- `Plan state: unconfigured` remains expected when no explicit workspace subscription lifecycle row is present; effective plan can still resolve via fallback.
- Prisma OpenSSL warning remains visible in API logs; it is not a blocker for current functionality but should be hardened in base image later.

### Next recommended step

- Start Step 8 E1 (tool catalog and activation model) and extend visibility from class-level to per-tool level once catalog primitives are introduced.

### Ready commit message

- `fix(web-contracts): align admin plan create route and 201 handling; document step7 live validation`

## 2026-03-26 - Step 7 P7 plan visibility read models

### What changed

- Added user-facing plan visibility endpoint:
  - `GET /api/v1/assistant/plan-visibility`
  - returns effective plan state plus key commercial limits as percentages only
- Added admin-facing plan visibility endpoint:
  - `GET /api/v1/admin/plans/visibility`
  - returns plan catalog state snapshot, usage pressure percentages/level, and effective entitlement snapshot
- Added centralized read-model service:
  - `ResolvePlanVisibilityService`
  - resolves visibility from existing P1-P6 control-plane truth (plan catalog, subscription resolution, capability resolution, quota state)
- Updated web `/app` to surface:
  - user-facing "Plan and limits visibility" section
  - owner-only "Admin plan visibility" section
- Updated OpenAPI/contracts and web API client for the new endpoints/types.
- Docs updated: ADR-030, `API-BOUNDARY`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P7 requires plans/limits/entitlements to be visible in product-correct, calm UX language while preserving backend governance boundaries and avoiding a noisy billing dashboard.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/plan-visibility.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/030-plan-visibility-read-models-p7.md`
- `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test` — passed

### Known risks / intentional limits

- P7 provides snapshot visibility read models, not historical BI/reporting timelines.
- P7 keeps class-level tool visibility and does not introduce per-tool catalog UI.
- No billing-provider workflow UI (checkout/invoices/payment/tax) is added.

### Next recommended step

- Step 8 **E1** tool catalog and activation model, using P7 visibility as the baseline operator/user read surface.

### Ready commit message

- `feat(api-web): add step 7 p7 user and admin plan visibility read models`

## 2026-03-26 - Step 7 P6 enforcement points baseline

### What changed

- Added centralized enforcement layer service: `EnforceAssistantCapabilityAndQuotaService`.
- Activated P6 enforcement at agreed control-plane boundaries:
  - sync web chat send flow
  - streaming web chat prepare flow
- Enforcement checks now executed in one place:
  - capability checks:
    - web chat channel availability
    - text media class availability
    - utility tool-class availability
  - quota/cap checks:
    - active web chats cap for new-thread creation
    - token budget limit
    - cost/token-driving tool-class limit when quota-governed
- Added read access for workspace quota accounting state in repository boundary for enforcement.
- Materialization now includes explicit `toolAvailability` (`persai.effectiveToolAvailability.v1`) in:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document
- Added API test script: `test:enforcement-points`.
- Docs updated: ADR-029, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P6 turns P1-P5 plan/entitlement/capability/quota state into active product rules at explicit control-plane boundaries while keeping backend out of runtime behavior routing.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforcement-points.test.ts`
- `apps/api/package.json`
- `docs/ADR/029-enforcement-points-p6.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- P6 enforces at current agreed boundaries (web chat send/stream prepare); broader endpoint-by-endpoint enforcement remains future hardening scope.
- `toolAvailability` in P6 is class-level truth only; per-tool catalog activation remains Step 8 scope.
- Backend still does not route runtime tool behavior.

### Next recommended step

- Step 7 **P7** user/admin plan visibility over enforced limits/capabilities and percentage-oriented quota UX read models.

### Ready commit message

- `feat(api): add step 7 p6 centralized capability and quota enforcement points`

## 2026-03-26 - Step 7 P5 quota accounting baseline

### What changed

- Added canonical quota accounting persistence in API Prisma model:
  - `workspace_quota_accounting_state` (workspace latest counters/limits)
  - `workspace_quota_usage_events` (append-only usage/snapshot events)
- Added explicit quota dimensions enum:
  - `token_budget`
  - `cost_or_token_driving_tool_class`
  - `active_web_chats_cap`
- Added centralized `TrackWorkspaceQuotaUsageService` in `workspace-management` application layer to avoid scattered/runtime-hidden quota logic.
- Wired quota tracking into existing control-plane flows:
  - sync web chat turn (token + cost/token-driving usage)
  - stream web chat turn completed/partial outcomes (token + cost/token-driving usage)
  - active web chats snapshot refresh on prepare/archive/hard-delete paths
- Added workspace quota repository boundary + Prisma implementation.
- Added provider-agnostic quota default config values:
  - `QUOTA_TOKEN_BUDGET_DEFAULT`
  - `QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT`
  - with existing `WEB_ACTIVE_CHATS_CAP` for active chat cap limit
- Added `test:quota-accounting` API script.
- Docs updated: ADR-028, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P5 requires explicit quota accounting for commercially meaningful dimensions while keeping tasks/reminders outside commercial quota limits and preserving P1-P4 architecture boundaries.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326220000_step7_p5_quota_accounting/migration.sql`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.entity.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/quota-accounting.test.ts`
- `apps/api/package.json`
- `packages/config/src/api-config.ts`
- `apps/api/.env.local.example`, `apps/api/.env.dev.example`
- `infra/helm/values.yaml`, `infra/helm/values-dev.yaml`
- `docs/ADR/028-quota-accounting-baseline-p5.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- No billing provider integration, invoicing/tax flows, or BI/reporting expansion in P5.
- No new public quota API endpoints in this slice.
- Token budget in P5 uses deterministic estimator (`chars_div_4_ceil_v1`) until runtime token telemetry is formalized.
- Enforcement matrix is not added in P5 (next slice scope).
- Tasks/reminders remain intentionally excluded from commercial quota accounting.

### Next recommended step

- Step 7 **P6** enforcement points using P4 effective capability state + P5 accounting counters.

### Ready commit message

- `feat(api): add step 7 p5 quota accounting baseline for token toolclass and active-web-chat dimensions`

## 2026-03-26 - Step 7 P4 capability resolution engine

### What changed

- Added centralized capability resolution service `ResolveEffectiveCapabilityStateService` with output schema `persai.effectiveCapabilities.v1`.
- Resolution inputs are now unified in one place:
  - P3 effective subscription state
  - P1/P2 plan catalog entitlements
  - assistant governance capability envelope
- Resolution output includes explicit effective allowances for:
  - tool classes
  - channels/surfaces
  - media classes
  - governed features
- Materialization now embeds `effectiveCapabilities` into:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document
- Added API test `test:capability-resolution`.
- Applied minimal corrective hardening required by P4:
  - `findByCode` plan lookup now resolves by `code` regardless of plan status, so existing subscriptions pinned to inactive plans still resolve effective capability baseline.
- Docs updated: ADR-027, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P4 requires one explicit reusable capability truth source for enforcement layers and runtime projection without duplicating logic or turning backend into behavior routing.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/effective-capability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-capability-state.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts` (minimal corrective hardening)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/capability-resolution.test.ts`
- `apps/api/package.json`
- `docs/ADR/027-capability-resolution-engine-p4.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- P4 computes and propagates effective capability truth but does not yet enforce every endpoint/action.
- Media-class allowance baseline is conservative and governance-driven; richer plan-level media entitlements remain future scope.
- No billing-provider or quota-accounting expansion in this slice.

### Next recommended step

- Step 7 **P5** quota accounting baseline, consuming P4 effective capability outputs.

### Ready commit message

- `feat(api): add step 7 p4 centralized capability resolution engine and materialization projection`

## 2026-03-26 - Step 7 P3 subscription state and billing abstraction boundary

### What changed

- Added canonical subscription persistence model:
  - Prisma enum `WorkspaceSubscriptionStatus`
  - table/model `workspace_subscriptions` (workspace-scoped subscription state)
- Added provider-agnostic billing boundary:
  - `BillingProviderPort` + normalized snapshot contract
  - null/no-op adapter baseline (`NullBillingProviderAdapter`) with no vendor integration
- Added effective subscription resolution service:
  - `ResolveEffectiveSubscriptionStateService`
  - precedence: workspace subscription -> assistant `quotaPlanCode` -> catalog default -> none
  - fallback status `unconfigured` for unresolved non-provider states
- Added repository boundary for workspace subscriptions and Prisma implementation.
- Added API test script `test:subscription-state` covering precedence behavior.
- Seed baseline now includes workspace subscription state for seeded workspace (`starter_trial`, `trialing`).
- Docs updated: ADR-026, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P3 establishes provider-agnostic subscription truth and future billing integration hooks without redesigning P1/P2 plan structures.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- migration `20260326200000_step7_p3_subscription_state_and_billing_boundary`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-subscription.*`
- `apps/api/src/modules/workspace-management/application/billing-provider.port.ts`
- `apps/api/src/modules/workspace-management/application/effective-subscription.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-subscription-state.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/billing/null-billing-provider.adapter.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-subscription.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/subscription-state-resolve.test.ts`
- `apps/api/package.json`
- `docs/ADR/026-subscription-state-and-billing-abstraction-p3.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:subscription-state` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- No concrete billing provider integration, webhooks, invoice/tax/payment flows in P3.
- Subscription state is modeled and resolved in backend control plane; no new public subscription API surface in this slice.
- Entitlement/quota enforcement engine remains out of scope.

### Next recommended step

- Step 7 **P4** capability resolution engine using P1/P2 catalog + P3 effective subscription resolution.

### Ready commit message

- `feat(api): add step 7 p3 workspace subscription state and billing abstraction boundary`

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
