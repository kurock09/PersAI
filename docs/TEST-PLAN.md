# TEST-PLAN

## Quality gate

Required in CI:

- lint
- typecheck
- unit tests
- contract tests
- e2e smoke
- prisma migrate check
- build

## Step 1 focus

- app boot
- health/ready/metrics
- config validation
- requestId propagation
- Prisma setup
- seed works

## Step 2 focus

- Clerk token validation
- app user auto-create
- GET /api/v1/me
- POST /api/v1/me/onboarding
- onboarding idempotency
- protected /app
- onboarding gate

## Step 2 smoke/e2e baseline (slice 6)

- API flow smoke/e2e script:
  - `apps/api/test/step2-auth-foundation.e2e.test.ts`
  - validates:
    - auth access guard (missing bearer token -> unauthorized)
    - app user auto-create on first authenticated request
    - `GET /api/v1/me` state before onboarding
    - `POST /api/v1/me/onboarding`
    - onboarding idempotency (no duplicate user/workspace/membership records)
- Web smoke tests:
  - `apps/web/app/app/page.test.tsx` (protected `/app` calls `auth.protect`)
  - `apps/web/app/app/app-flow.client.test.tsx` (onboarding gate pending/completed branches)
- CI includes explicit Step 2 smoke/e2e step via `pnpm run test:step2`.

## Step 7 P1 focus

- Prisma migration validates canonical plan catalog + entitlement schema.
- Governance baseline creation resolves `quotaPlanCode` from default first-registration active plan when catalog row exists.
- Trial metadata constraints hold at DB level (`is_trial_plan` vs `trial_duration_days` check).

## Step 7 P2 focus

- Owner-gated admin endpoints validate create/update/list flows for plan management.
- Web `/app` renders a dedicated admin plan management section and supports create/edit controls for authorized admins.
- Baseline regression suite (`test:step2`) remains green after admin plan UI/API additions.

## Step 7 P3 focus

- Prisma schema/migration validates workspace subscription state model.
- Effective subscription resolution precedence is tested in API test script (`test:subscription-state`).
- Workspace-wide typecheck/lint and Step 2 regression baseline remain green.

## Step 7 P4 focus

- Capability resolution precedence and governance guardrails are validated in API test script (`test:capability-resolution`).
- Materialization integration compiles/typechecks with effective capability payload included.
- Baseline Step 2 regressions remain green.

## Step 7 P5 focus

- Prisma schema/migration validates quota accounting persistence model (`workspace_quota_accounting_state`, `workspace_quota_usage_events`).
- Quota accounting service behavior is validated in API test script (`test:quota-accounting`), including:
  - token budget usage increments
  - cost/token-driving tool-class usage increments
  - active web chats usage refresh
- Web chat/send/stream and chat list archive/delete compile with centralized quota tracking hooks and preserve prior regressions.

## Step 7 P6 focus

- Centralized enforcement behavior is validated in API test script (`test:enforcement-points`) for:
  - capability gate checks
  - active web chats cap gate
  - quota limit gate behavior
- Web chat send/stream boundaries compile and run through the enforcement layer (no ad hoc duplicate checks).
- Materialization compiles with explicit `toolAvailability` snapshot included for OpenClaw-facing documents.

## Step 7 P7 focus

- Contracts/OpenAPI generation includes new visibility read-model endpoints:
  - `GET /assistant/plan-visibility`
  - `GET /admin/plans/visibility`
- API lint/typecheck validate visibility services and role-gated admin visibility path.
- Web `/app` renders:
  - user-facing plan state + percentage-only limits section
  - owner/admin visibility section for plan state, usage pressure, and effective entitlements
- Existing app flow regressions remain green with the new visibility surfaces.

## Step 8 E1 focus

- Prisma schema/migration validates governed tool catalog + plan activation persistence:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- Plan create/update flows synchronize activation rows from tool-class entitlement controls (no scattered ad hoc writes).
- Materialization compiles with `persai.effectiveToolAvailability.v2` projection including per-tool activation truth for OpenClaw-facing documents.
- API lint/typecheck and Step 2 regression baseline remain green.

## Step 8 E2 focus

- OpenClaw-facing capability envelope projection is validated in API test script (`test:openclaw-capability-envelope`) for:
  - per-tool/per-group allow-deny truth
  - explicit denied tool suppression list
  - per-surface allowance propagation
  - quota-related restriction flags and tasks/reminders non-commercial-quota rule
- Materialization compiles with envelope included in governance layer snapshot + OpenClaw bootstrap/workspace documents.
- Existing E1 and Step 2 baselines remain green.

## Step 8 E3 focus

- Channel/surface binding projection is validated in API test script (`test:openclaw-channel-surface-bindings`) for:
  - explicit provider + surface + assistant-binding structure
  - MAX split into `max_bot` and `max_mini_app` surfaces (no flattening)
  - explicit unavailable-surface suppression list behavior
  - system notifications modeled as a distinct non-chat surface
- OpenClaw capability envelope test (`test:openclaw-capability-envelope`) validates embedding of `openclawChannelSurfaceBindings`.
- Existing E1/E2 and baseline capability tests remain green.

## Step 8 E4 focus

- Telegram integration flow is validated in API test script (`test:telegram-integration`) for:
  - connect flow token verification path and persisted connected state
  - post-connect configuration update persistence and response shape
- API lint/typecheck validate Telegram endpoints/services and binding persistence wiring.
- Web app flow tests validate integrations-area Telegram connect interaction path.
- Existing E1-E3 envelope/capability tests remain green.

## Step 8 E6 focus

- Runtime provider routing baseline is validated in API test script (`test:runtime-provider-routing`) for:
  - primary path resolution
  - fallback matrix trigger mapping
  - policy override handling for model keys
  - entitlement/governance alignment fields (cost-driving restrictions)
- OpenClaw capability envelope test (`test:openclaw-capability-envelope`) validates embedding of `runtimeProviderRouting`.
- API lint/typecheck validate service wiring through materialization and module registration.

## Step 9 F1 focus

- Prisma schema/migration validates append-only audit persistence model (`assistant_audit_events`).
- DB-level immutability for audit rows is enforced via trigger (update/delete rejected).
- Critical audit coverage is verified by service wiring for:
  - lifecycle milestones (`create|draft update|publish|rollback|reset|reapply request`)
  - runtime apply transitions (`in_progress|succeeded|failed|degraded`)
  - admin plan create/update actions
  - policy marker append (`do-not-remember` -> memory forget marker)
  - Telegram binding/config and token-fingerprint update events
- API lint/typecheck and existing Step 8 baseline tests remain green.

## Step 9 F2 focus

- Prisma schema/migration validates admin RBAC persistence model (`app_user_admin_roles`).
- Admin read authorization is validated for role-based access (`ops|business|security|super-admin`) with legacy owner fallback.
- Dangerous admin writes are validated for step-up token requirement on:
  - `POST /admin/plans`
  - `PATCH /admin/plans/{code}`
- Step-up challenge issuance path validates action scoping and short-lived token generation (`POST /admin/step-up/challenge`).
- Admin audit events include actor role context and step-up verification metadata for dangerous writes.

## Step 9 F3 focus

- Contracts/OpenAPI generation includes ops cockpit endpoint:
  - `GET /admin/ops/cockpit`
- API lint/typecheck validate ops cockpit resolver/controller wiring and role-gated read path.
- Web app-flow tests validate ops cockpit section rendering and reapply control wiring from cockpit.
- Existing Step 9 F1/F2 and Step 2 baseline regressions remain green.

## Step 9 F4 focus

- Contracts/OpenAPI generation includes business cockpit endpoint:
  - `GET /admin/business/cockpit`
- API lint/typecheck validate business cockpit resolver/controller wiring and role-gated read path.
- Web app-flow tests validate business cockpit section rendering alongside existing admin surfaces.
- Existing F3 ops cockpit behavior and Step 2 baseline regressions remain green.

## Step 9 F5 focus

- Prisma schema/migration validates admin notification channel and delivery models:
  - `workspace_admin_notification_channels`
  - `admin_notification_deliveries`
- Contracts/OpenAPI generation includes admin notifications endpoints:
  - `GET /admin/notifications/channels`
  - `PATCH /admin/notifications/channels/webhook`
- API lint/typecheck validate:
  - admin notification channel RBAC enforcement
  - non-blocking delivery wiring from selected high-signal audit events
- Web app-flow tests validate admin notification channel section rendering and webhook update action.

## Step 9 F6 focus

- Prisma schema/migration validates rollout control persistence:
  - `assistant_platform_rollouts`
  - `assistant_platform_rollout_items`
- Contracts/OpenAPI generation includes rollout control endpoints:
  - `GET /admin/platform-rollouts`
  - `POST /admin/platform-rollouts`
  - `POST /admin/platform-rollouts/{rolloutId}/rollback`
- API lint/typecheck validate:
  - action-scoped dangerous step-up extension (`admin.rollout.apply|admin.rollout.rollback`)
  - rollout/rollback service wiring and governance-only mutation scope
  - audit emission for rollout apply/rollback actions
- Web app-flow tests validate platform rollout controls section rendering and apply/rollback action wiring.
- Full regression baseline remains green:
  - `pnpm run test:step2`

## Step 10 G1 focus

- Contracts/OpenAPI generation includes Telegram secret lifecycle endpoints:
  - `POST /assistant/integrations/telegram/rotate`
  - `POST /assistant/integrations/telegram/revoke`
  - `POST /assistant/integrations/telegram/emergency-revoke`
- API lint/typecheck validate:
  - managed SecretRef lifecycle envelope resolution from governance `secret_refs`
  - TTL-driven lifecycle status evaluation (`active` vs computed `expired`)
  - revoke and emergency-revoke behavior with binding disable
  - audit events for rotate/revoke/emergency-revoke actions
- Targeted API tests validate lifecycle behavior:
  - `test/telegram-integration.test.ts`
  - `test/openclaw-channel-surface-bindings.test.ts`
  - `test/assistant-secret-refs-lifecycle.test.ts`
