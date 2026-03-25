# API-BOUNDARY

## API style

REST only.
Path versioning: /api/v1/...

## Step 1 endpoints

- GET /health
- GET /ready
- GET /metrics

## Step 2 endpoints

- GET /api/v1/auth/verify
- GET /api/v1/me
- POST /api/v1/me/onboarding

## Step 3 A2 assistant lifecycle skeleton endpoints

- POST /api/v1/assistant
- GET /api/v1/assistant
- PATCH /api/v1/assistant/draft
- POST /api/v1/assistant/publish
- POST /api/v1/assistant/rollback
- POST /api/v1/assistant/reset
- POST /api/v1/assistant/reapply
- GET /api/v1/assistant/runtime/preflight
- POST /api/v1/assistant/chat/web
- POST /api/v1/assistant/chat/web/stream
- GET /api/v1/assistant/chats/web
- PATCH /api/v1/assistant/chats/web/{chatId}
- POST /api/v1/assistant/chats/web/{chatId}/archive
- DELETE /api/v1/assistant/chats/web/{chatId}

## Step 5 C1 backend boundary note

- C1 introduces backend chat/message persistence model only.
- No new public API endpoints are added in C1.
- Streaming transport remains out of scope until C3.

## Step 5 C2 web chat transport baseline

### POST /api/v1/assistant/chat/web

Request body fields:

- `surfaceThreadKey` (string, required)
- `message` (string, required)
- `title` (string | null, optional; used when chat record is first created)

Behavior baseline:

- authenticated caller only
- web surface only in C2
- requires existing assistant and latest published version successfully applied
- resolves/creates canonical backend chat record by `(assistantId, surface=web, surfaceThreadKey)`
- persists user message record in backend chat history
- sends transport turn through adapter boundary to OpenClaw runtime (`POST /api/v1/runtime/chat/web`)
- persists assistant message record in backend chat history
- returns transport result with chat + user message + assistant message records
- no streaming in C2

## Step 5 C3 streaming web chat baseline

### POST /api/v1/assistant/chat/web/stream

Request body fields:

- `surfaceThreadKey` (string, required)
- `message` (string, required)
- `title` (string | null, optional)

Behavior baseline:

- authenticated caller only
- web surface only in C3
- streaming-first path for web chat UX
- preserves lifecycle/apply gate from C2 before stream starts
- persists canonical user message before runtime stream begins
- emits stream events to client:
  - `started`
  - `delta`
  - `runtime_done`
  - `completed`
  - `interrupted`
  - `failed`
- on completed stream, persists full assistant message record
- on interruption/failure with partial output, persists partial assistant output + explicit system marker record
- no Telegram transport in C3

## Step 5 C4 web chat list and actions baseline

### GET /api/v1/assistant/chats/web

Behavior baseline:

- authenticated caller only
- returns web chat list backed by canonical C1 records
- includes basic metadata per chat:
  - title
  - archived state
  - created/updated/last-message timestamps
  - message count
  - last message preview

### PATCH /api/v1/assistant/chats/web/{chatId}

Request body fields:

- `title` (string | null)

Behavior baseline:

- authenticated caller only
- renames chat record title (or clears title when `null`)
- updates canonical backend record directly

### POST /api/v1/assistant/chats/web/{chatId}/archive

Behavior baseline:

- authenticated caller only
- marks chat as archived (`archivedAt` set)
- keeps chat/messages in canonical history

### DELETE /api/v1/assistant/chats/web/{chatId}

Request body fields:

- `confirmText` (must equal `DELETE`)

Behavior baseline:

- authenticated caller only
- performs **hard delete** only (no soft-delete aliasing)
- removes chat record and all related message records permanently
- requires explicit delete confirmation payload

## Step 5 C5 active web chats cap baseline

- active web chats cap is enforced when attempting to create a **new** web chat thread.
- threshold is admin-configurable via API env/config:
  - `WEB_ACTIVE_CHATS_CAP`
- cap check applies to active chats only (`archivedAt = null`).
- behavior at limit:
  - backend blocks new chat creation with explicit conflict error
  - existing threads remain usable for continued chat turns
  - no automatic deletion/archive side effects are performed

## Step 5 C6 chat degradation/error UX baseline

- web chat UX maps transport/runtime failures into user-facing classes with non-technical guidance.
- user-facing classes include:
  - session/auth issue
  - input validation issue
  - assistant not live yet
  - active chat cap reached
  - runtime unreachable
  - runtime timeout
  - runtime degraded
  - runtime auth failure
  - provider-style failure
  - tool-style failure
  - channel-style failure
  - stream incomplete / partial outcome
- normal user path does not expose raw runtime internals, stack traces, or low-level transport details.
- support/admin depth remains outside this user-facing C6 slice.

### POST /api/v1/assistant

Behavior baseline:

- authenticated caller only
- creates assistant for current user if absent
- rejects create when assistant already exists for current user (`1 user = 1 assistant`)
- requires caller workspace membership (assistant is workspace-scoped)
- no OpenClaw/runtime calls

### GET /api/v1/assistant

Behavior baseline:

- authenticated caller only
- returns assistant lifecycle skeleton state:
  - `id`, `userId`, `workspaceId`
  - `draft.displayName`, `draft.instructions`, `draft.updatedAt`
  - `latestPublishedVersion` (nullable)
  - `runtimeApply`:
    - `status`: `not_requested | pending | in_progress | succeeded | failed | degraded`
    - `targetPublishedVersionId`
    - `appliedPublishedVersionId`
    - `requestedAt`, `startedAt`, `finishedAt`
    - `error` (`code`, `message`) nullable
  - `governance`:
    - `capabilityEnvelope`
    - `secretRefs`
    - `policyEnvelope`
    - `memoryControl` (Step 6 D1: control-plane memory governance envelope; not raw runtime memory)
    - `tasksControl` (Step 6 D4: control-plane tasks/reminders/triggers envelope; not execution/scheduling)
    - `quotaPlanCode`
    - `quotaHook`
    - `auditHook`
    - `platformManagedUpdatedAt`
  - `materialization`:
    - `latestSpecId`
    - `publishedVersionId`
    - `sourceAction`
    - `algorithmVersion`
    - `contentHash`
    - `generatedAt`
    - `openclawBootstrapDocument`
    - `openclawWorkspaceDocument`
  - `createdAt`, `updatedAt`
- returns not found if assistant has not been created yet

### PATCH /api/v1/assistant/draft

Request body fields (at least one required):

- `displayName` (string | null)
- `instructions` (string | null)

Behavior baseline:

- authenticated caller only
- updates mutable draft fields only
- does not create published versions
- does not perform runtime apply/openclaw actions
- returns not found when assistant does not exist

### POST /api/v1/assistant/publish (Step 3 A3 baseline)

Behavior baseline:

- authenticated caller only
- requires existing assistant for caller
- creates new immutable published snapshot version from current draft
- version number is per-assistant incremental (`1,2,3,...`)
- returns assistant lifecycle state with `latestPublishedVersion` set to newly published version
- sets `runtimeApply` target to the newly published version and executes runtime apply through adapter
- final apply state is explicit in response (`succeeded|failed|degraded`, or `in_progress` if runtime is still ongoing)
- does not mutate historical published versions

### POST /api/v1/assistant/rollback (Step 3 A4 baseline)

Request body fields:

- `targetVersion` (integer, >= 1)

Behavior baseline:

- authenticated caller only
- requires existing assistant and existing published target version
- **does not mutate** old published rows
- creates a new latest published version snapshot copied from `targetVersion`
- updates current draft to the same rolled-back snapshot values
- sets `runtimeApply` target to rollback-created published version and executes runtime apply through adapter
- final apply state is explicit in response (`succeeded|failed|degraded`, or `in_progress` if runtime is still ongoing)

### POST /api/v1/assistant/reset (Step 3 A4 baseline)

Behavior baseline:

- authenticated caller only
- requires existing assistant
- creates new assistant state without deleting platform attachment layer
- creates new latest published version with blank snapshot (`displayName=null`, `instructions=null`)
- resets draft to blank values (`displayName=null`, `instructions=null`)
- sets `runtimeApply` target to reset-created published version and executes runtime apply through adapter
- preserves:
  - ownership/user binding
  - workspace scope
  - billing scope (not modified in this slice)
  - secret bindings/integration attachment layer (not modified in this slice)
- final apply state is explicit in response (`succeeded|failed|degraded`, or `in_progress` if runtime is still ongoing)

### POST /api/v1/assistant/reapply (Step 3 A8 baseline)

Behavior baseline:

- authenticated caller only
- requires existing assistant and existing latest published version
- does not create a new published version
- executes runtime apply against latest materialized published spec with `reapply=true`
- updates `runtimeApply` state with explicit lifecycle outcome

### GET /api/v1/assistant/runtime/preflight (Step 3 A8 baseline)

Behavior baseline:

- authenticated caller only
- executes adapter preflight probes:
  - `GET /healthz`
  - `GET /readyz`
- returns minimal preflight state:
  - `live`
  - `ready`
  - `checkedAt`

## Step 3 A5 apply-state separation rule

- Publish truth and apply truth are distinct:
  - publish/rollback/reset produce published version truth in `latestPublishedVersion`
  - runtime apply progress/outcome is tracked separately in `runtimeApply`
- In A8, runtime adapter now drives apply-state transitions:
  - `pending -> in_progress -> succeeded|failed|degraded`
- runtime failures are persisted with coarse stable error code/message in `runtimeApply.error`.

## Step 3 A6 governance separation rule

- Governance is modeled as platform-managed control-plane layer, separate from user-owned draft/version truth.
- Governance baseline is storage + response shape only:
  - no behavior routing engine
  - no runtime/OpenClaw calls
  - no full quotas/tools engines
- User-owned lifecycle truth remains:
  - draft state in `assistants`
  - immutable published versions in `assistant_published_versions`
- Platform-managed governance truth is separate:
  - envelopes/hooks in `assistant_governance`

## Step 6 D1 memory control envelope rule

- Canonical memory control JSON lives in `assistant_governance.memory_control` and is exposed as `governance.memoryControl` on assistant lifecycle reads.
- Materialization resolves `openclawWorkspace.memoryControl` from that column, with legacy fallback to `policyEnvelope.memoryControl`, then MVP defaults.
- D1 does not add memory edit APIs or Memory Center UI; **D3** enforces global memory read/write rules on Memory Center + web-chat registry ingest (see below).

## Step 6 D2 Memory Center API baseline

### GET /api/v1/assistant/memory/items

- authenticated caller only
- returns active memory registry items for the user’s assistant (`forgottenAt` null), newest first
- each item: `id`, `summary`, `sourceType` (`web_chat`), `sourceLabel`, `createdAt`, `chatId` (nullable)

### POST /api/v1/assistant/memory/items/{itemId}/forget

- authenticated caller only
- sets `forgottenAt` on the item when owned by the caller’s assistant
- idempotent from user perspective: missing/already forgotten → 404

### POST /api/v1/assistant/memory/do-not-remember

- request body: `assistantMessageId` (UUID, required), `userMessageId` (UUID, optional)
- validates messages belong to the assistant; assistant message must be `author=assistant`
- marks matching registry rows forgotten (by related message ids) and appends a marker to `governance.memoryControl.forgetRequestMarkers`
- does not expose raw OpenClaw internals in responses

## Step 6 D3 global memory source policy (registry + Memory Center)

- Effective policy is resolved from `assistant_governance.memory_control` with legacy `policyEnvelope.memoryControl` fallback, then defaults (`resolveEffectiveMemoryControlFromGovernance`).
- **Read** (`policy.globalMemoryReadAllSurfaces`): when `false`, `GET /api/v1/assistant/memory/items`, `POST .../forget`, and `POST .../do-not-remember` return **409 Conflict** (global memory surfaced/actioned via these endpoints is disabled).
- **Write** (registry row after successful web chat turn): requires `trusted_1to1` source classification, `group` is denied for global registry writes; transport must be in `policy.allowedGlobalWriteSurfaces` and `policy.trustedOneToOneGlobalWriteSurfaces` (defaults: `web` only). Denied writes **do not fail** the chat turn; the record hook **skips** registry insert (no error response on the chat endpoint).
- Trust/surface vocabulary is also stored under `governance.memoryControl.sourceClassification` for explicit control-model documentation; evaluation uses the typed policy module in `apps/api` (ADR-021).

## Step 6 D4 tasks control envelope rule

- Canonical tasks control JSON lives in `assistant_governance.tasks_control` and is exposed as `governance.tasksControl` on assistant lifecycle reads.
- Materialization resolves `openclawWorkspace.tasksControl` from that column, with legacy fallback to `policyEnvelope.tasksControl`, then MVP defaults (`resolveEffectiveTasksControlFromGovernance`).
- The envelope defines ownership, source/surface hooks, control lifecycle **labels**, user enable/disable/cancel affordances, **explicit exclusion of tasks from commercial plan quotas**, and audit delegation — not runtime schedules or execution routing (OpenClaw-owned). See ADR-022.

## Step 6 D5 Tasks Center API baseline

### GET /api/v1/assistant/tasks/items

- authenticated caller only
- returns task registry rows for the user’s assistant (active items first by `nextRunAt`, then inactive by recency)
- each item: `id`, `title`, `sourceSurface` (`web`), `sourceLabel`, `controlStatus` (`active|disabled|cancelled`), `nextRunAt` (nullable), `createdAt`, `updatedAt` — no `externalRef` or raw runtime payloads

### POST /api/v1/assistant/tasks/items/{itemId}/disable

- `active` → `disabled`; **409** if not active or `userMayDisable` is false in resolved `tasks_control`

### POST /api/v1/assistant/tasks/items/{itemId}/enable

- `disabled` → `active`; **409** if not disabled or `userMayEnable` is false

### POST /api/v1/assistant/tasks/items/{itemId}/cancel

- `active` or `disabled` → `cancelled`; idempotent if already `cancelled`; **409** if `userMayCancel` is false

## Step 7 P1 plan catalog + entitlement control-plane baseline

- P1 introduces canonical plan/entitlement persistence in backend data model (no public API endpoints added in this slice).
- `governance.quotaPlanCode` remains the assistant-facing pointer and is now resolved from the active catalog plan flagged as default first registration during governance baseline creation.
- Trial semantics are modeled in catalog metadata (`isTrialPlan`, `trialDurationDays`) and are not yet coupled to billing-provider workflow.

## Step 7 P2 admin plan management API baseline

### GET /api/v1/admin/plans

- authenticated caller only
- requires admin read role (`ops_admin|business_admin|security_admin|super_admin`) or legacy owner fallback
- returns admin-facing plan list with:
  - naming and high-level metadata
  - default-on-registration and trial controls
  - entitlement controls (capabilities, tool classes, channels/surfaces, limits permissions)

### POST /api/v1/admin/plans

- authenticated caller only
- requires dangerous-action role (`business_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` for action `admin.plan.create`
- creates one plan entry by `code`
- supports:
  - display name / description / status
  - default-on-registration flag
  - trial flag and trial duration
  - entitlement and limits controls
  - provider-agnostic metadata hints

### PATCH /api/v1/admin/plans/{code}

- authenticated caller only
- requires dangerous-action role (`business_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` for action `admin.plan.update`
- updates existing plan by code with the same control set as create
- keeps single default-on-registration truth by clearing previous default when a new default is set

## Step 7 P3 subscription + billing boundary baseline

- P3 introduces backend subscription modeling (`workspace_subscriptions`) and billing abstraction port/hooks only.
- No new public API endpoints are added in P3.
- Effective subscription resolution for assistant context is defined in backend service logic with precedence:
  - workspace subscription
  - assistant `quotaPlanCode` fallback
  - catalog default fallback
  - none (`unconfigured`)

## Step 7 P4 capability resolution baseline

- P4 introduces centralized capability resolution service logic only (no new public API endpoints in this slice).
- Effective capability output is derived from:
  - effective subscription state
  - resolved plan entitlements
  - assistant governance capability envelope
- Materialization now carries `effectiveCapabilities` into OpenClaw-facing documents for explicit runtime availability truth.

## Step 7 P5 quota accounting baseline

- P5 introduces backend quota accounting model/service and persistence only; no new public API endpoints are added in this slice.
- Tracked dimensions:
  - `token_budget`
  - `cost_or_token_driving_tool_class`
  - `active_web_chats_cap`
- Usage tracking hooks are control-plane and explicit:
  - web chat turn sync/stream outcomes update token + tool-class usage
  - web chat prepare/archive/hard-delete refresh active web chats usage
- Limit sources are provider-agnostic plan hints + entitlement limit keys with config fallback defaults.
- Tasks/reminders are intentionally excluded from commercial quota accounting.

## Step 7 P6 enforcement points baseline

- P6 introduces centralized control-plane enforcement checks and does not add new public endpoints.
- Enforcement is active at:
  - `POST /api/v1/assistant/chat/web`
  - `POST /api/v1/assistant/chat/web/stream` (prepare/new-thread gate)
- Enforced rules at these boundaries:
  - capability gates: web chat channel + text media class + utility tool class
  - active web chats cap on new-thread creation
  - token budget quota limit
  - cost/token-driving tool-class quota limit when class is quota-governed
- Materialization now carries explicit `toolAvailability` (`persai.effectiveToolAvailability.v1`) for OpenClaw alongside `effectiveCapabilities`.

## Step 7 P7 plan visibility read models

### GET /api/v1/assistant/plan-visibility

- authenticated caller only
- returns user-facing plan visibility snapshot:
  - effective plan identity/state
  - key limit usage percentages only:
    - token budget
    - cost-driving tool-class usage
    - active web chats usage
  - tasks/reminders commercial-quota exclusion flag
- no raw quota counters, billing-provider internals, or technical storage details are exposed

### GET /api/v1/admin/plans/visibility

- authenticated caller only
- requires admin read role (`ops_admin|business_admin|security_admin|super_admin`) or legacy owner fallback
- returns admin-facing visibility snapshot:
  - effective plan state + catalog state (`active/inactive` counts, default registration plan)
  - usage pressure percentages for core dimensions
  - derived pressure level (`low|elevated|high`)
  - effective entitlement snapshot (tool classes, channels/surfaces, governed features)
- this is a control-plane visibility model, not a billing console

## Step 8 E1 tool catalog and activation model

- E1 adds control-plane persistence and projection only; no new public REST endpoints are introduced in this slice.
- Canonical tool catalog + plan activation truth is persisted in backend:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- Existing role-gated + step-up protected admin plan management API remains the single plan packaging surface.
- Materialization tool availability projection is upgraded to `persai.effectiveToolAvailability.v2`:
  - class-level activation summary (`utility`, `cost_driving`)
  - per-tool activation list derived from catalog status + plan activation + effective class guardrail
- Backend still does not execute tool behavior or route plugin/runtime internals.

## Step 8 E2 OpenClaw capability envelope hardening

- E2 adds no new public REST endpoints; this is materialization boundary hardening.
- Materialization now includes explicit OpenClaw-facing capability envelope:
  - `openclawCapabilityEnvelope` (`persai.openclawCapabilityEnvelope.v1`)
- Envelope provides non-ambiguous runtime truth:
  - per-tool and per-group allow/deny
  - canonical declared tool set (`catalog.declaredToolCodes`) for "exists vs does not exist" truth
  - per-surface allowances (`webChat`, `telegram`, `whatsapp`, `max`)
  - quota-related class restrictions for cost-driving and utility features
  - explicit suppression list for denied/unavailable tools
- Tasks/reminders remain explicitly non-commercial-quota class in the envelope (`tasksAndRemindersExcludedFromCommercialQuotas`).
- Backend still does not route runtime execution behavior.

## Step 8 E3 channel and surface binding model hardening

- E3 adds no new public REST endpoints; this is control-plane materialization hardening.
- Materialization now includes explicit channel/surface binding projection:
  - `openclawChannelSurfaceBindings` (`persai.openclawChannelSurfaceBindings.v1`)
- Projection shape is explicit and non-flat:
  - provider-level binding (`web_internal`, `telegram`, `whatsapp`, `max`, `system_notifications`)
  - surface-level binding (`web_chat`, `telegram_bot`, `whatsapp_business`, `max_bot`, `max_mini_app`, `system_notification`)
  - assistant binding state
  - policy/config split at provider and surface levels
  - explicit suppression list for unavailable surfaces
- E3 preserves existing entitlement compatibility:
  - existing `channelsAndSurfaces.max` capability input remains one gate
  - projection hardening maps it to two distinct surfaces (`max_bot`, `max_mini_app`)
- Backend still does not implement Telegram/WhatsApp/MAX delivery execution in this slice.

## Step 8 E4 Telegram connection and delivery surface

- E4 adds authenticated assistant-scoped control-plane endpoints:
  - `GET /assistant/integrations/telegram` (read connection/config state)
  - `POST /assistant/integrations/telegram/connect` (verify token + persist binding)
  - `PATCH /assistant/integrations/telegram/config` (update post-connect panel settings)
- Connection semantics:
  - token format validation + Telegram `getMe` verification
  - persists provider/surface binding (`telegram` + `telegram_bot`) in canonical binding table
  - returns explicit integration state (`persai.telegramIntegration.v1`) for UI
- Post-connect configuration surface supports:
  - parse mode
  - inbound/outbound message toggles
  - notes
- Bot profile sync:
  - username/display name synced from Telegram `getMe`
  - avatar URL is best-effort and derived from Telegram username when available
- E4 keeps web as primary control-plane surface and does not move deep assistant config into Telegram.
- E4 does not add WhatsApp/MAX delivery implementation.

## Step 10 G1 secret lifecycle hardening

### POST /api/v1/assistant/integrations/telegram/connect

- request now supports optional `ttlDays` (`1..365`) for managed SecretRef lifecycle.
- successful connect rotates/creates managed Telegram SecretRef metadata in governance (`secret_refs`) and keeps secret values out of response payloads.

### POST /api/v1/assistant/integrations/telegram/rotate

- authenticated caller only.
- request body:
  - `botToken` (required)
  - `ttlDays` (optional, `1..365`)
- verifies token and rotates managed Telegram SecretRef version/lifecycle metadata.

### POST /api/v1/assistant/integrations/telegram/revoke

- authenticated caller only.
- optional request body:
  - `reason` (string|null)
- revokes managed Telegram SecretRef and disables Telegram binding usage.

### POST /api/v1/assistant/integrations/telegram/emergency-revoke

- authenticated caller only.
- optional request body:
  - `reason` (string|null)
- emergency-revokes managed Telegram SecretRef and disables Telegram binding usage immediately.

### GET /api/v1/assistant/integrations/telegram

- response now includes non-sensitive `secretLifecycle` metadata:
  - lifecycle status (`active|revoked|emergency_revoked|expired|legacy_unmanaged`)
  - ref key / manager / version
  - rotate/revoke/expiration timestamps
  - legacy compatibility fallback flag
- secret values are not returned.

## Step 10 G2 abuse and rate-limit enforcement

### POST /api/v1/assistant/chat/web

- retains existing lifecycle/apply/capability/quota gating.
- now also enforces multi-layer abuse/rate-limit guard:
  - per-user-per-assistant-per-surface request window
  - per-assistant-per-surface aggregate request window
  - quota-pressure-aware slowdown/temporary block hook
- when abuse slowdown/block is active, endpoint returns **429**.

### POST /api/v1/assistant/chat/web/stream

- same G2 abuse/rate-limit enforcement is applied in prepare path before runtime stream starts.
- active slowdown/block returns **429** before opening stream.

### POST /api/v1/admin/abuse-controls/unblock

- authenticated caller only.
- requires abuse-control admin role:
  - `ops_admin|security_admin|super_admin`
  - or narrow legacy owner fallback.
- request body:
  - `assistantId` (required)
  - `userId` (optional; when set must match assistant owner)
  - `surface` (optional; default `web_chat`)
  - `overrideMinutes` (optional; `1..1440`)
- behavior:
  - clears active abuse slowdown/block for matching scope
  - applies temporary admin override window
  - writes audit event `admin.abuse_unblock_applied`

## Step 10 G3 recovery and ownership transfer flows

### POST /api/v1/admin/assistants/ownership/transfer

- authenticated caller only.
- requires dangerous-action role (`ops_admin|super_admin`) or legacy owner fallback.
- requires `x-persai-step-up-token` header issued for action `admin.assistant.transfer_ownership`.
- request body:
  - `assistantId` (required)
  - `currentOwnerUserId` (required; must match current assistant owner)
  - `targetOwnerUserId` (required; must be workspace member and must not already own another assistant)
  - `reason` (optional)
- behavior:
  - rebinds assistant owner from current owner to target owner
  - keeps lifecycle versions and governance/bindings/SecretRef metadata attached to assistant
  - does not trigger reset or delete semantics
  - writes audit event `assistant.ownership_transferred`

### POST /api/v1/admin/assistants/ownership/recover

- authenticated caller only.
- requires dangerous-action role (`ops_admin|super_admin`) or legacy owner fallback.
- requires `x-persai-step-up-token` header issued for action `admin.assistant.recover_ownership`.
- request body:
  - `assistantId` (required)
  - `recoveredOwnerUserId` (required; must be workspace member and must not already own another assistant)
  - `supportTicketRef` (optional)
  - `reason` (optional)
- behavior:
  - applies governed recovery rebind when direct owner-driven transfer is not available
  - preserves assistant-attached resources (memory/chat/task bindings, integration bindings, SecretRef metadata)
  - preserves existing audit history and appends new admin recovery event
  - writes audit event `assistant.ownership_recovered`

## Step 8 E6 provider and fallback baseline

- E6 adds no new public REST endpoints; this is control-plane materialization hardening.
- Materialization now includes explicit runtime provider routing baseline:
  - `runtimeProviderRouting` (`persai.runtimeProviderRouting.v1`)
  - embedded into `openclawCapabilityEnvelope`.
- Routing projection includes:
  - primary provider/model path
  - fallback matrix by runtime trigger (`provider_failure_or_timeout`, `runtime_degraded`, `cost_driving_restricted`)
  - explicit governance-alignment fields from effective capabilities and entitlement-derived quota governance
- Optional policy override is control-plane only:
  - `policyEnvelope.runtimeProviderRouting` can override model keys and disable fallback path.
- E6 does not introduce a user-facing provider picker, provider marketplace logic, or backend runtime routing execution.

## Step 9 F1 append-only audit hardening

- F1 adds no new public REST endpoints.
- Backend writes high-signal append-only audit events for critical control-plane and runtime transition actions.
- Audit storage is immutable at DB level (`assistant_audit_events` update/delete rejected).

## Step 9 F2 admin RBAC and dangerous-action step-up

### POST /api/v1/admin/step-up/challenge

- authenticated caller only
- requires action-scoped dangerous-write role or legacy owner fallback:
  - `admin.plan.create|admin.plan.update` -> `business_admin|super_admin`
  - `admin.runtime_provider_settings.update` -> `ops_admin|super_admin`
  - `admin.rollout.apply|admin.rollout.rollback` -> `ops_admin|super_admin`
  - `admin.assistant.transfer_ownership|admin.assistant.recover_ownership` -> `ops_admin|super_admin`
- request body:
  - `action`:
    - `admin.plan.create`
    - `admin.plan.update`
  - `admin.runtime_provider_settings.update`
    - `admin.rollout.apply`
    - `admin.rollout.rollback`
    - `admin.assistant.transfer_ownership`
    - `admin.assistant.recover_ownership`
- returns short-lived signed step-up token scoped to:
  - actor user
  - workspace
  - action code
  - expiration

### POST /api/v1/admin/plans

- authenticated caller only
- requires dangerous-action role (`business_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` header issued for action `admin.plan.create`
- existing create behavior remains unchanged after authorization/step-up validation

### PATCH /api/v1/admin/plans/{code}

- authenticated caller only
- requires dangerous-action role (`business_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` header issued for action `admin.plan.update`
- existing update behavior remains unchanged after authorization/step-up validation

### GET /api/v1/admin/plans and GET /api/v1/admin/plans/visibility

- authenticated caller only
- requires admin read role:
  - `ops_admin|business_admin|security_admin|super_admin`
  - or legacy owner fallback

## Step 9 F3 ops cockpit baseline

### GET /api/v1/admin/ops/cockpit

- authenticated caller only
- requires admin read role:
  - `ops_admin|business_admin|security_admin|super_admin`
  - or legacy owner fallback
- returns bounded ops cockpit snapshot:
  - assistant presence + latest published version pointer
  - runtime apply status/error truth
  - runtime preflight health/readiness
  - topology awareness (`adapterEnabled`, OpenClaw host)
  - high-signal incident list (no raw logs/trace dump)
  - control availability flags (`reapplySupported`, `restartSupported`)
- this endpoint is operational visibility baseline, not BI/analytics surface

## Step 9 F4 business cockpit baseline

### GET /api/v1/admin/business/cockpit

- authenticated caller only
- requires admin read role:
  - `ops_admin|business_admin|security_admin|super_admin`
  - or legacy owner fallback
- returns bounded business snapshot views:
  - active assistants
  - active chats
  - channel split
  - publish/apply success (last 7 days snapshot)
  - quota pressure
  - plan usage snapshot
- this endpoint is a baseline business cockpit, not a heavy BI/reporting platform

## Step 9 F5 admin system notifications

### GET /api/v1/admin/notifications/channels

- authenticated caller only
- requires admin read role:
  - `ops_admin|business_admin|security_admin|super_admin`
  - or legacy owner fallback
- returns configured admin notification channels and latest delivery summary

### PATCH /api/v1/admin/notifications/channels/webhook

- authenticated caller only
- requires admin notification-management role:
  - `ops_admin|security_admin|super_admin`
  - or legacy owner fallback
- upserts workspace webhook notification channel with:
  - `enabled`
  - `endpointUrl`
  - optional `signingSecret`
- payload validates URL shape and ensures endpoint is present when enabling

## Step 12 H1b global runtime provider settings

### GET /api/v1/admin/runtime/provider-settings

- authenticated caller only
- requires admin read role:
  - `ops_admin|business_admin|security_admin|super_admin`
  - or legacy owner fallback
- returns bounded global runtime-provider settings read model:
  - `primary` provider + model
  - optional `fallback` provider + model
  - `availableModelsByProvider.openai[]`
  - `availableModelsByProvider.anthropic[]`
  - masked provider-key status for `openai` / `anthropic`:
    - `configured`
    - optional last-four hint
    - `updatedAt`
- returned state is platform-global and is not limited to the caller's current workspace selection

### PUT /api/v1/admin/runtime/provider-settings

- authenticated caller only
- requires dangerous-action role (`ops_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` header issued for action `admin.runtime_provider_settings.update`
- request body:
  - `primary.provider`
  - `primary.model`
  - optional `fallback.provider`
  - optional `fallback.model`
  - `availableModelsByProvider.openai[]`
  - `availableModelsByProvider.anthropic[]`
  - optional write-only `providerKeys.openai`
  - optional write-only `providerKeys.anthropic`
- behavior:
  - persists global runtime-provider settings as platform-level control-plane truth
  - stores raw provider keys only in dedicated encrypted PersAI secret storage
  - never returns stored raw keys in the response body
  - generates the provider credential refs required for OpenClaw consumption
  - attempts best-effort reapply for assistants that already have a latest published version so live runtime converges toward the new global settings
  - writes an admin audit event for the update
  - this path replaces normal admin dependence on assistant-scoped rollout editing for provider keys/models

## Step 9 F6 progressive rollout and rollback controls

### GET /api/v1/admin/platform-rollouts

- authenticated caller only
- requires admin read role:
  - `ops_admin|business_admin|security_admin|super_admin`
  - or legacy owner fallback
- returns bounded recent rollout operation summaries:
  - rollout status
  - rollout percent
  - targeted vs total assistants
  - apply outcome counters
  - target patch summary

### POST /api/v1/admin/platform-rollouts

- authenticated caller only
- requires dangerous-action role (`ops_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` header issued for action `admin.rollout.apply`
- request body:
  - `rolloutPercent` (1..100)
  - `targetPatch` (subset of platform-managed governance fields)
- behavior:
  - selects target assistant subset by rollout percent
  - stores per-assistant pre-update governance snapshot
  - updates platform-managed governance fields only
  - H1 runtime-provider-profile baseline uses this mutation surface for:
    - `targetPatch.policyEnvelope.runtimeProviderProfile`
    - `targetPatch.secretRefs.refs.runtime_provider_credentials`
  - validates typed H1 provider-profile and provider-credential-ref shape before mutating governance
  - triggers soft runtime reapply against latest published version when present
  - stores per-assistant apply outcomes (`succeeded|degraded|failed|skipped`)
  - writes rollout summary audit event (`admin.platform_rollout_applied`)

### POST /api/v1/admin/platform-rollouts/{rolloutId}/rollback

- authenticated caller only
- requires dangerous-action role (`ops_admin|super_admin`) or legacy owner fallback
- requires `x-persai-step-up-token` header issued for action `admin.rollout.rollback`
- behavior:
  - restores per-assistant governance snapshots captured by the referenced rollout
  - triggers soft runtime reapply against latest published version when present
  - stores rollback outcomes per rollout item
  - marks rollout as rolled back and writes audit event (`admin.platform_rollout_rolled_back`)

## Step 3 A7 materialization rule

- Backend materializes assistant deterministically from layered inputs:
  - user-owned published version layer
  - platform governance layer
  - ownership/apply context layer
- Materialization is projected into OpenClaw-native outputs:
  - `openclaw_bootstrap`
  - `openclaw_workspace`
- H1 runtime provider profile baseline is materialized into:
  - `openclawBootstrap.governance.runtimeProviderProfile`
  - derived `runtimeProviderRouting` continues to surface routing truth for runtime/tool-policy alignment
- When global runtime provider settings are configured, materialization precedence is:
  - platform-global runtime provider settings
  - fallback to legacy assistant governance H1 runtime-provider profile + provider credential refs
  - fallback to legacy OpenClaw runtime default
- The materialized runtime-provider profile may now include:
  - platform-generated `SecretRef` values with source `persai`
  - `availableModelsByProvider` metadata for later entitlement filtering
- Materialization artifacts are versionable/auditable:
  - stored per published version (`published_version_id` unique)
  - deterministic diff documents (`layers_document`, `openclaw_*_document`)
  - integrity hash (`content_hash`)
- A8 consumes these materialized artifacts for runtime apply/reapply.

### GET /api/v1/me (slice 2 baseline response)

- Returns current internal app user (`app_users`) for authenticated caller.
- Includes onboarding status:
  - `completed` when workspace membership exists **and** required MVP legal acceptance is present
  - `pending` when workspace membership is missing or legal acceptance is incomplete
- Includes compliance baseline snapshot:
  - Terms of Service acceptance (`requiredVersion`, `acceptedVersion`, `acceptedAt`, `accepted`)
  - Privacy Policy acceptance (`requiredVersion`, `acceptedVersion`, `acceptedAt`, `accepted`)
  - retention/delete/audit baseline summary model
- Includes current workspace summary if one exists:
  - `id`, `name`, `locale`, `timezone`, `status`, `role`

### POST /api/v1/me/onboarding (slice 3 baseline request/behavior)

Request body fields:

- `displayName`
- `workspaceName`
- `locale`
- `timezone`
- `acceptTermsOfService` (must be `true`)
- `acceptPrivacyPolicy` (must be `true`)
- `termsOfServiceVersion` (optional)
- `privacyPolicyVersion` (optional)

Behavior baseline:

- authenticated caller only
- idempotent upsert-style flow
- updates `app_users.display_name`
- records legal acceptance baseline fields on `app_users`:
  - `terms_of_service_version`, `terms_of_service_accepted_at`
  - `privacy_policy_version`, `privacy_policy_accepted_at`
- creates workspace if user has no membership yet
- creates/updates workspace membership for caller
- updates current workspace summary fields (`name`, `locale`, `timezone`) consistently

## Step 10 G4 retention/delete/compliance baseline

- retention model: user-controlled; no hidden TTL auto-purge behavior in MVP.
- delete model is explicit action-only:
  - chat hard delete is confirmation-gated + irreversible
  - memory forget / do-not-remember are explicit user actions
- reset remains non-delete lifecycle action.
- ownership transfer/recovery remains non-delete ownership action.
- audit model remains append-only immutable rows.

## Step 10 G5 WhatsApp/MAX readiness hardening

- G5 adds no new public REST endpoints.
- readiness hardening is in control-plane projection logic:
  - provider configured state for `whatsapp` and `max` now resolves from canonical assistant provider bindings (same pattern as Telegram provider binding readiness)
  - Telegram keeps additional managed SecretRef lifecycle gate
- projection remains non-flat:
  - WhatsApp surface remains `whatsapp_business`
  - MAX remains split into `max_bot` and `max_mini_app`
- G5 does not add transport/runtime delivery implementation for WhatsApp or MAX.

## Auth model

- web protects routes
- web sends Bearer token
- api validates Clerk JWT itself
- api resolves/auto-creates internal `app_users` record on first authenticated access
- web uses a typed client module for `/api/v1/me` and `/api/v1/me/onboarding` calls (no scattered raw fetch in UI)

## Error envelope

```json
{
  "error": {
    "code": "SOME_CODE",
    "category": "validation|auth|forbidden|conflict|infra|unknown",
    "message": "Human-readable message",
    "details": {}
  },
  "requestId": "..."
}
```

## Contract source of truth (Step 2 + Step 3 A2-A8)

- OpenAPI spec: `packages/contracts/openapi.yaml`
- Generated typed client (Orval): `packages/contracts/src/generated/*`
- Frontend consumption baseline remains typed-client only via `@persai/contracts`

## OpenClaw integration contract baseline (Step 3 O6 + A8)

This section defines backend-to-OpenClaw adapter rules.
Runtime calls are implemented only through dedicated infrastructure adapter.

Transport choice for first adapter step:

- **HTTP** (not WebSocket) for first integration boundary.
- Why:
  - control-plane request/response shape is easier to bound
  - timeout/retry/failure mapping is deterministic
  - aligns with already verified dev endpoints (`/healthz`, `/readyz`)

First supported adapter interactions:

- runtime preflight:
  - `GET /healthz`
  - `GET /readyz`
- minimal adapter output to backend:
  - `live: boolean`
  - `ready: boolean`
  - `checkedAt: string` (timestamp)
- runtime apply/reapply:
  - `POST /api/v1/runtime/spec/apply`
  - payload source is A7 materialized documents (`openclawBootstrap`, `openclawWorkspace`, `contentHash`)
  - `reapply` flag is explicit in request body
- when `openclawBootstrap.governance.runtimeProviderProfile` is present, OpenClaw validates provider allowlist, selected models, and provider credential ref resolvability against its own runtime secret-resolution configuration before accepting the apply
- runtime web chat transport (C2):
  - `POST /api/v1/runtime/chat/web`
  - payload source is backend canonical turn context (`assistantId`, published version ID, chat/thread identity, persisted user message data)
- runtime web chat streaming transport (C3):
  - `POST /api/v1/runtime/chat/web/stream`
  - payload source remains backend canonical turn context and persisted user message data

Allowed backend knowledge:

- OpenClaw base URL and token config references
- timeout/retry settings
- coarse runtime status (`live`, `ready`, degraded)

Forbidden leakage into backend/domain language:

- provider/channel/tool execution internals
- memory/reasoning/runtime-behavior internals
- OpenClaw-specific internal endpoint or state semantics outside approved boundary

Expected boundary error classes:

- `runtime_unreachable`
- `auth_failure`
- `timeout`
- `invalid_response`
- `runtime_degraded`

## PersAI to OpenClaw HTTP runtime contract (v1)

This subsection is the **design-freeze** contract between PersAI `apps/api` and the OpenClaw gateway HTTP surface. It is the single doc anchor for implementers of a compatible runtime (including the external fork after native parity). The public PersAI REST API (`/api/v1/assistant/...`) is unchanged; this is **internal** PersAI→OpenClaw only.

### Version scope (v1)

**In scope for v1**

- Liveness/readiness probes used before apply and chat.
- Materialized spec apply/reapply.
- Web chat synchronous turn.
- Web chat streaming turn (NDJSON).

**Out of scope for v1 (not defined on this HTTP surface)**

- Telegram, WhatsApp, MAX, or other channel transports toward OpenClaw. Those remain separate product/adapter slices.

### Fork build (native runtime)

- Source-of-truth and deploy boundary: [ADR-012](ADR/012-openclaw-fork-source-and-deploy-boundary.md).
- Native runtime fulfillment (persona, memory, tools, full agent pipeline from apply + chat) is implemented incrementally on the fork; planning, phased delivery, and scaling rules: [ADR-048](ADR/048-native-openclaw-runtime-from-persai-apply-chat.md).
- The dev image builds the fork at the pinned SHA in [infra/dev/gitops/openclaw-approved-sha.txt](../infra/dev/gitops/openclaw-approved-sha.txt) **without** applying a compat patch; runtime routes live in fork source under `src/gateway/persai-runtime/`.
- Shared apply-store backend is selected inside the fork via `PERSAI_RUNTIME_SPEC_STORE=memory|redis`; Redis mode also uses `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`, optional `PERSAI_RUNTIME_SPEC_STORE_KEY_PREFIX`, and optional `PERSAI_RUNTIME_SPEC_STORE_TTL_SECONDS`. This is an **operational/runtime** concern only; it does **not** change the HTTP contract in this section.
- **Normative contract** = what PersAI’s adapter sends and validates (this section). **Reference behavior** for drift checks: see fork handlers and status codes below; with a prior apply for the same `(assistantId, publishedVersionId)`, sync/stream route through the embedded agent path (`agentCommandFromIngress`) and return real model output. Without apply for that assistant version, the fork returns an explicit `503` JSON error instead of compat-style echo text.

### Configuration (operational, no secret values)

Loaded via `loadApiConfig` / [packages/config/src/api-config.ts](../packages/config/src/api-config.ts):

| Variable                       | Role                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENCLAW_ADAPTER_ENABLED`     | When false, adapter throws `runtime_unreachable` immediately for all calls.                                                                                        |
| `OPENCLAW_BASE_URL`            | Origin for relative paths below (no trailing path in contract; adapter concatenates `baseUrl + path`).                                                             |
| `OPENCLAW_GATEWAY_TOKEN`       | Required when adapter is enabled; sent as Bearer.                                                                                                                  |
| `OPENCLAW_ADAPTER_TIMEOUT_MS`  | Per-request `fetch` timeout (abort → `timeout`). Code default `3000`; `infra/helm/values-dev.yaml` currently overrides dev to `15000` for web streaming stability. |
| `OPENCLAW_ADAPTER_MAX_RETRIES` | Non-negative; used only for **non-stream** `fetch` calls that use the adapter retry helper. Default `1`.                                                           |

**Retry policy (adapter):** only `runtime_unreachable` and `timeout` are retried, up to `maxRetries` additional attempts after the first try. **`POST /api/v1/runtime/chat/web/stream` is not retried** (single `fetch`).

### Authentication

- For every request, if `OPENCLAW_GATEWAY_TOKEN` is non-empty, the adapter sets `Authorization: Bearer <token>`.
- The fork gateway validates that Bearer via `authorizeHttpGatewayConnect` (same token/password bridge shape as the rest of the gateway). Exact auth matrix is owned by OpenClaw; PersAI treats `401`/`403` as `auth_failure`.

### `GET /healthz` and `GET /readyz`

- **Method:** `GET`, no body.
- **Success:** `2xx` with JSON object.
- **Health → `live` (adapter):** boolean `ok === true`, **or** string `status === "live"` if `ok` is absent.
- **Ready → `ready` (adapter):** boolean `ready === true`.
- If the JSON shape does not yield both booleans, the adapter throws `invalid_response`.

### `POST /api/v1/runtime/spec/apply`

**Request**

- `Content-Type: application/json`
- Body (JSON object), aligned with [assistant-runtime-adapter.types.ts](../apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts) `AssistantRuntimeApplyInput`:

| Field                | Type       | Required                                                     |
| -------------------- | ---------- | ------------------------------------------------------------ |
| `assistantId`        | string     | yes (non-empty after trim)                                   |
| `publishedVersionId` | string     | yes                                                          |
| `contentHash`        | string     | yes                                                          |
| `reapply`            | boolean    | yes (`true` or `false`)                                      |
| `spec`               | object     | yes                                                          |
| `spec.bootstrap`     | JSON value | yes (key must exist; value is opaque materialized bootstrap) |
| `spec.workspace`     | JSON value | yes (key must exist; value is opaque materialized workspace) |

**Success**

- Adapter requires HTTP **2xx**; response body is parsed as JSON but **not** semantically validated (void return in application layer).

**Fork implementation reference**

- Rejects missing/invalid fields with **400** and JSON `{ ok: false, error: "<message>" }`.
- When H1 admin-managed runtime provider profile is present in `spec.bootstrap.governance.runtimeProviderProfile`, the fork validates:
  - provider allowlist (`openai` / `anthropic` in H1)
  - non-empty selected model ids
  - provider credential refs against current OpenClaw secret-resolution configuration, including PersAI-managed refs when that source is enabled
- Request body limit **1_000_000** bytes; **413** / **408** / **400** for read errors.
- **405** for non-POST.
- **200** with `{ ok: true, accepted: true, assistantId, publishedVersionId, contentHash, reapply, appliedAt }` on success (informative; adapter does not assert this shape); apply payload is persisted server-side for subsequent chat (see ADR-048).

### `POST /api/v1/runtime/chat/web`

**Request**

- `Content-Type: application/json`
- Body:

| Field                | Type   | Required                   |
| -------------------- | ------ | -------------------------- |
| `assistantId`        | string | yes (non-empty after trim) |
| `publishedVersionId` | string | yes                        |
| `chatId`             | string | yes                        |
| `surfaceThreadKey`   | string | yes                        |
| `userMessageId`      | string | yes                        |
| `userMessage`        | string | yes                        |

**Success response (adapter-validated)**

- HTTP **2xx**, JSON object with:
  - `assistantMessage`: string, non-empty after trim
  - `respondedAt`: string, non-empty after trim

**Fork implementation reference**

- Same body limit and **400**/**408**/**413**/**405** as spec apply.
- Response header `X-Persai-Runtime-Session-Key` set to the derived web session key (P1).
- **200** with `ok: true` and `assistantMessage` / `respondedAt`: after a successful apply for the same `(assistantId, publishedVersionId)`, the fork runs a full embedded agent turn via `agentCommandFromIngress` (session key = P1 mapping); `assistantMessage` is model/tool output (persona `instructions` from stored workspace are passed as `extraSystemPrompt` when present).
- **503** with `{ ok: false, error }`: the requested `(assistantId, publishedVersionId)` has no applied runtime spec in the OpenClaw store; PersAI should treat this as degraded runtime state rather than a successful assistant reply.
- **500** with `{ ok: false, error }` may occur when the agent run throws (e.g. missing provider credentials); the adapter maps non-2xx to `invalid_response`.

### `POST /api/v1/runtime/chat/web/stream`

**Request**

- Same JSON body as `POST /api/v1/runtime/chat/web`.
- Adapter sets `Accept: application/x-ndjson`.

**Success response**

- HTTP **2xx**
- `Content-Type` should be NDJSON-friendly (e.g. `application/x-ndjson`); adapter reads the body as **newline-delimited JSON** (UTF-8), one object per line, optional final line without trailing newline.

**Stream records (adapter-validated)**

- Zero or more lines with `{ "type": "delta", "delta": "<string>" }`.
- Exactly one terminal line with `{ "type": "done", "respondedAt": "<iso string>" }` before the adapter completes successfully.
- Any other `type` → `invalid_response`. Missing `done` after EOF → `invalid_response`. Invalid JSON line → `invalid_response`.

**Fork implementation reference**

- After apply, streams real assistant deltas from the embedded agent (`onAgentEvent` / same path as OpenAI-compat streaming), then one `done` line; **405**/**400**/**408**/**413** same family as above; same `X-Persai-Runtime-Session-Key` header as sync.
- Without apply, the endpoint returns **503** JSON error before the NDJSON stream starts.

### HTTP status and adapter error mapping

| Condition                                                        | Adapter error code    |
| ---------------------------------------------------------------- | --------------------- |
| `401` / `403`                                                    | `auth_failure`        |
| `502` / `503` / `504` on HTTP                                    | `runtime_degraded`    |
| Other non-2xx on HTTP                                            | `invalid_response`    |
| Abort due to timeout                                             | `timeout`             |
| Network / non-abort fetch failure                                | `runtime_unreachable` |
| JSON parse failure, missing required fields (per rules above)    | `invalid_response`    |
| Adapter disabled                                                 | `runtime_unreachable` |
| Preflight reports not live or not ready **before** apply or chat | `runtime_degraded`    |

Implementation reference: [openclaw-runtime.adapter.ts](../apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts).
