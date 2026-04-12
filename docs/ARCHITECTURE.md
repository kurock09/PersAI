# ARCHITECTURE

## Architecture style

Modular monolith for apps/api, with strict module and layer boundaries.

## Repo structure

- apps/web
- apps/api
- apps/provider-gateway
- apps/runtime
- external OpenClaw fork (materialized in CI to `services/openclaw` for image builds)
- packages/\*
- infra
- docs

## Backend modules

- identity-access
- workspace-management
- platform-core

## Backend layers

- domain
- application
- infrastructure
- interface

## OpenClaw boundary

OpenClaw is a neighboring runtime boundary with source-of-truth in the external fork.
For dev image builds, CI materializes the approved fork revision into `services/openclaw`.
It is not part of backend domain logic.
`apps/api` talks to OpenClaw only through the infrastructure adapter boundary:

- OpenClaw calls are allowed only via infrastructure adapter boundary in `apps/api`
- domain/application modules remain OpenClaw-agnostic
- currently implemented interactions:
  - runtime preflight (`/healthz`, `/readyz`)
  - apply/reapply of materialized published specs through adapter
  - sync web chat transport
  - streaming web chat transport
- adapter boundary started in A8 with runtime preflight and apply/reapply, then expanded later for web chat sync/stream transport
- normative PersAI→OpenClaw HTTP request/response contract (design freeze v1): [API-BOUNDARY.md — PersAI to OpenClaw HTTP runtime contract (v1)](API-BOUNDARY.md#persai-to-openclaw-http-runtime-contract-v1)
- planned control-plane evolution for admin-driven runtime profiles (models, fallback refs, credential refs) is tracked in [ADR-049](ADR/049-platform-admin-runtime-control-plane-phasing.md); PersAI owns policy + references, while OpenClaw remains the runtime executor and secret resolver

## ADR-072 transition boundary

- `assistant_materialized_specs` now dual-writes a PersAI-native `runtimeBundle` beside the legacy `openclawBootstrap` / `openclawWorkspace` artifacts.
- the native bundle is the future runtime artifact for the PersAI-native execution plane
- the legacy OpenClaw artifacts remain only as a migration boundary while request-time execution still routes through the existing adapter
- active request-time apply, preview, Telegram, media, and session paths are still legacy; web chat is now the first request-time path validated on the PersAI-native runtime in dev, while the temporary `legacy|shadow|native` route modes remain only as migration/rollback seams until later cleanup

## ADR-072 execution-plane bootstrap boundary

- `apps/provider-gateway` now exists as a dark internal service for the future PersAI-native execution plane.
- Step 4 scope is intentionally bounded:
  - OpenAI and Anthropic provider modules
  - health, readiness, metrics, catalog, and warmup seams
  - no request traffic cutover yet
- temporary bootstrap catalog/config lives only inside `apps/provider-gateway` startup config so the service can exist before control-plane warm/invalidate wiring lands.
- that bootstrap seam is temporary:
  - why: Step 4 needs a real gateway shell before Step 7 can feed it from PersAI control-plane warm/invalidate events
  - where: `packages/config` provider-gateway env loader plus `apps/provider-gateway/src/modules/providers/*`
  - removal: Step 7 replaces bootstrap-only catalog warmup with control-plane bundle/provider warm-invalidate flow

## ADR-072 runtime shell boundary

- `apps/runtime` now exists as a dark internal service for the future PersAI-native conversation runtime.
- Step 5 scope is intentionally bounded:
  - native bundle warm/invalidate shell
  - health, readiness, and metrics seams
  - runtime observability counters
  - no turn execution, session leasing, or distributed runtime state yet
- the Step 5 bundle cache is intentionally local and non-authoritative:
  - why: Step 5 needs the runtime process boundary before Step 6 adds distributed runtime state and Step 7 wires real control-plane warm/invalidate flow
  - where: `apps/runtime/src/modules/bundles/*` and `apps/runtime/src/modules/observability/*`
  - removal/upgrade: Step 7 replaces the shell-only warm path with the real control-plane bundle warm/invalidate flow over persisted runtime bundles

## ADR-072 distributed runtime-state boundary

- Step 6 adds the first shared runtime-state model without changing active request-time execution yet.
- Postgres now owns durable runtime-plane records for:
  - bundle warm/invalidation state (`runtime_bundle_states`)
  - session summaries (`runtime_sessions`)
  - compaction history (`runtime_session_compactions`)
  - turn receipts / idempotency outcomes (`runtime_turn_receipts`)
- Redis remains the ephemeral coordination layer only:
  - session lease keys
  - conversation-to-session pointers
  - turn receipt/idempotency markers
  - bundle warm markers
- `apps/runtime/src/modules/runtime-state/*` now owns the concrete dark-service persistence seam for that state:
  - Postgres persistence via Prisma-backed runtime-state services
  - Redis coordination via runtime-owned keyspace + coordination services
  - explicit runtime config validation for `DATABASE_URL` and `RUNTIME_STATE_REDIS_URL`
- `assistant_materialized_specs.runtime_bundle*` remains the authoritative compiled bundle artifact during this slice.
- `runtime_bundle_states` is intentionally metadata-only runtime-plane state so Step 6 does not introduce a second bundle document authority before Step 7 warms/invalidate caches from the control plane.

## ADR-072 Step 7 bundle and provider warm boundary

- `apps/runtime` bundle warm/invalidate endpoints no longer stop at the Step 5 local cache shell.
- `apps/api` apply/reapply now triggers two control-plane warm actions **after** successful legacy OpenClaw apply:
  - assistant-wide invalidate + current-bundle warm for the native runtime bundle
  - provider-gateway warmup with the materialized control-plane model catalog snapshot
- successful runtime bundle warm now coordinates three runtime-owned effects:
  - bounded local bundle cache warm
  - `runtime_bundle_states.last_warmed_at` / `invalidated_at`
  - Redis bundle warm markers
- provider-gateway catalog/warmup is no longer bootstrap-only:
  - bootstrap-config model lists remain only as dark-service startup seed
  - the first apply-triggered `control_plane_apply` warmup replaces that seed with the materialized `availableModelsByProvider` snapshot
  - `GET /api/v1/providers/catalog` now reflects the current in-memory control-plane snapshot source
- temporary API-side activation seams are currently allowed:
  - why: Step 7 needs real control-plane warm hooks before `apps/runtime` and `apps/provider-gateway` are universally deployed mandatory dependencies, while request-time traffic remains legacy-safe
  - where: `packages/config/src/api-config.ts` (`PERSAI_RUNTIME_BASE_URL`, `PERSAI_PROVIDER_GATEWAY_BASE_URL`, sync/stream flags, and sync/stream timeouts) plus the paired API sync/stream services
  - removal/upgrade: Step 9 first makes runtime configuration mandatory for the flagged sync/stream cutovers, then removes the remaining `unset => skip` behaviors entirely once native web execution is the default path

## ADR-072 Step 8 session-state boundary

- Step 8 has now started with the first runtime-owned session/idempotency service layer over the shared Step 6 state model.
- `apps/runtime/src/modules/sessions/session-store.service.ts` now resolves and ensures active runtime sessions over:
  - durable `runtime_sessions` rows in Postgres
  - Redis conversation-session pointers as best-effort hot-path hints
- `apps/runtime/src/modules/sessions/session-lease.service.ts` now owns explicit Redis lease acquire/release for runtime session ordering.
- `apps/runtime/src/modules/turns/idempotency.service.ts` now owns logical turn claim/replay over:
  - durable `runtime_turn_receipts` rows in Postgres
  - Redis turn-receipt markers as best-effort hot-path hints
- `apps/runtime/src/modules/turns/turn-acceptance.service.ts` now composes the first bounded native-turn acceptance lifecycle inside the runtime boundary:
  - ensure or heal the session from Postgres/Redis
  - check replay before ordering work
  - acquire the Redis session lease
  - create the accepted turn receipt only after the lease is held
- the internal Step 8 acceptance seam now returns explicit `accepted`, `busy`, or `replayed` outcomes without adding any web/Telegram HTTP surface yet.
- `apps/runtime/src/modules/turns/turn-finalization.service.ts` now provides the paired bounded terminal-state seam:
  - mark the accepted turn receipt `completed` / `interrupted` / `failed`
  - update durable session summary fields
  - release the session lease only after terminal receipt persistence
- `apps/runtime/src/modules/turns/turn-lease-heartbeat.service.ts` now provides the paired Step 8 renewal seam for long-running accepted turns:
  - renew the held Redis session lease while the turn is still active
  - surface explicit `renewed` vs `lost` outcomes
  - keep lease maintenance inside one bounded runtime-owned service instead of leaving TTL extension as ad hoc future logic
- `TurnAcceptanceService` now also uses a bounded in-flight accepted-turn claim seam:
  - atomically check or create an in-flight marker together with lease acquisition
  - return explicit `in_flight` for same-idempotency retries during the pre-receipt window instead of collapsing them into generic `busy`
- Step 8 is now complete as an internal runtime-state package:
  - session resolve/ensure
  - lease acquire/release/renew
  - durable replay receipts
  - in-flight accepted-turn claim
  - bounded acceptance/finalization/heartbeat orchestration
- Step 9 has now started with a dark sync text-only `createTurn` path:
  - `apps/runtime/src/modules/turns/interface/http/turns.controller.ts` exposes `POST /api/v1/turns/create`
  - `apps/runtime/src/modules/turns/turn-execution.service.ts` composes acceptance, warmed bundle lookup, provider-gateway text generation, and terminal finalization
  - `apps/provider-gateway` now exposes `POST /api/v1/providers/generate-text` over warmed provider clients
  - runtime readiness/metrics now treat provider gateway as an active dependency through `RUNTIME_PROVIDER_GATEWAY_BASE_URL`
- Step 9 now also has its first API-side native consumer:
  - `apps/api/src/modules/workspace-management/application/send-native-web-chat-turn.service.ts` builds native `RuntimeTurnRequest` payloads and calls `POST /api/v1/turns/create`
  - `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts` now uses the Step 10 route mode seam `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=legacy|shadow|native`
  - `shadow` keeps OpenClaw as the user-visible primary sync path while queueing a native comparison run and logging `web_runtime_shadow_compare`
  - `native` keeps canonical replay/message persistence and quota/media ownership while skipping legacy bootstrap consumption on successful native execution
  - optional quota degrade provider/model overrides are now carried through the native runtime request instead of being dropped at the cutover boundary
- Step 9 now also has the first native streaming chain:
  - `apps/provider-gateway/src/modules/providers/interface/http/provider-text-generation.controller.ts` exposes `POST /api/v1/providers/stream-text`
  - `apps/runtime/src/modules/turns/interface/http/turns.controller.ts` now also exposes `POST /api/v1/turns/stream`
  - `apps/api/src/modules/workspace-management/application/stream-native-web-chat-turn.service.ts` maps native NDJSON stream events back into the existing API-owned `delta` / `done` web stream contract
  - `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` now uses the Step 10 route mode seam `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=legacy|shadow|native`
  - `shadow` keeps OpenClaw as the user-visible primary stream path while queueing a native comparison run and logging `web_runtime_shadow_compare`
  - the API stream boundary still owns canonical replay/message persistence, SSE shaping, media delivery, and honest interruption handling; successful native stream completion skips legacy bootstrap consumption only when native is the primary path
- Step 9 native sync and native stream web paths have now both passed bounded dev-GKE live validation, including stream replay/idempotency and disconnect persistence checks.
- Step 10 is now closed for the ordinary web text path; remaining follow-up work is removal of the temporary route modes plus the remaining Step 7 API activation seams, and later attachment execution.
- Postgres is the durable authority for session summaries and turn receipts; stale or missing Redis pointers/markers may be rebuilt from Postgres instead of introducing filesystem or OpenClaw-era session truth.

## Planned runtime segmentation boundary (Step 15)

- target direction is **one PersAI control plane** plus **tiered PersAI-native execution lanes**, not one permanent shared runtime forever
- runtime assignment is a control-plane decision (plan default + admin override), not a low-level infrastructure choice exposed in the product UI
- initial target runtime classes:
  - `free_shared_restricted`
  - `paid_shared_restricted`
  - `paid_isolated`
- shared pools are valid only in **restricted** mode:
  - explicit deny-by-default tool exposure
  - explicit sandbox/workspace limits
  - explicit network/resource hardening
- GKE topology evolution (tier-specific deployments/services/config/network policy) is part of the same boundary and must not leak into end-user product semantics
- current implementation still routes request-time execution through the legacy boundary until later ADR-072 slices land; new docs and future slices must not deepen that legacy executor as the long-term architecture

## Runtime optimization policy boundary

- `ADR-071` defines the optimization-policy boundary for heartbeat, context economy, OpenAI tuning, admin/runtime controls, compaction UX, and deferred bootstrap budgeting
- PersAI owns:
  - heartbeat/materialization policy
  - generated runtime defaults in Helm/config
  - tier-aware optimization defaults
  - admin/runtime optimization controls
  - user-facing compaction suggestion UX
- OpenClaw owns:
  - runtime execution behavior once configured
  - heartbeat/session/tool execution semantics
  - pruning/compaction/provider transport behavior inside the runtime
- optimization must preserve assistant humanity:
  - do not treat persona/bootstrap tone as the first cost-reduction target
  - remove unnecessary background work and long-context waste before trimming bootstrap/persona content
- native OpenClaw core changes remain the exception:
  - prefer PersAI-only fixes when the change is policy, config generation, admin UI, or product behavior
  - touch native OpenClaw only when existing PersAI-owned seams cannot express the needed runtime behavior or observability
- current audited repo status for `ADR-071` slices 1-5:
  - slices 1-4 are mostly wired through the intended control-plane path (`admin runtime settings -> config generation/materialization -> OpenClaw runtime override`)
  - rendered Helm/runtime-pool defaults are still a transitional infra baseline for optimization policy and must not be treated as the only runtime source-of-truth
  - slice 5 is materially wired through the intended product/control-plane path: web compaction suggestion/manual compact is contract-backed, Telegram hinting is policy-driven, and the touched UX copy paths now have localization parity

## Chat boundary (Step 5 C1)

- backend stores canonical user-facing chat records:
  - chat/thread identity
  - message history
  - ownership and retention-oriented record fields
- legacy OpenClaw stores runtime conversational/session context only
- ADR-072 native web runtime may hydrate recent canonical web chat history during runtime context assembly, but it does not become the owner of chat/message records
- backend chat domain must not include runtime session internals
- surface-aware threading is explicit and record-level (`surface + surfaceThreadKey`)

## Chat transport boundary (Step 5 C2)

- backend web chat transport entrypoint:
  - `POST /api/v1/assistant/chat/web`
- default legacy transport still targets the OpenClaw runtime bridge:
  - `POST /api/v1/runtime/chat/web`
- ADR-072 Step 10 now carries the sync web boundary through explicit route modes:
  - `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=legacy` keeps sync turns on the OpenClaw bridge
  - `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=shadow` keeps OpenClaw primary and queues a native comparison run
  - `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native` routes sync turns to `apps/runtime` `POST /api/v1/turns/create`
  - in `native` mode there is no silent per-request fallback to OpenClaw inside the sync path
- backend persists canonical chat/message records before/after runtime turn
- transport is synchronous in C2 (no streaming)

## Chat streaming boundary (Step 5 C3)

- primary web chat UX path is streaming-first:
  - `POST /api/v1/assistant/chat/web/stream`
- backend streams transport events to web UI and keeps canonical record ownership
- adapter boundary remains explicit for runtime stream:
  - `POST /api/v1/runtime/chat/web/stream`
- ADR-072 Step 10 now carries the stream web boundary through explicit route modes:
  - `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=legacy` keeps web stream turns on the OpenClaw bridge
  - `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=shadow` keeps OpenClaw primary and queues a native comparison run
  - `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native` routes web stream turns to `apps/runtime` `POST /api/v1/turns/stream`
  - `apps/runtime` reaches `apps/provider-gateway` `POST /api/v1/providers/stream-text` for provider text streaming
  - in `native` mode there is no silent per-request fallback to OpenClaw inside the API stream path
- external web SSE events remain API-owned (`started`, `delta`, `thinking`, `runtime_done`, `completed`, `interrupted`, `failed`) even when the underlying runtime execution is native
- interruption/failure is represented honestly and partial output can be persisted with explicit marker records

## Chat list/actions boundary (Step 5 C4)

- GPT-style web chat list/actions are backed by canonical backend records
- supported C4 actions:
  - rename
  - archive
  - hard delete (explicit confirmation)
- archive and delete are intentionally distinct:
  - archive keeps records/history
  - delete permanently removes chat + message records

## Active web chats cap boundary (Step 5 C5)

- cap is enforced in backend web chat transport flow at new-thread creation point
- cap threshold is runtime-configurable via API config (`WEB_ACTIVE_CHATS_CAP`)
- enforcement blocks only new chat creation; existing threads and records remain intact

## Frontend authentication boundary

- Clerk is used for identity/session management, but all user-facing auth UI is custom-built
- sign-in, sign-up, SSO callback, and profile pages use Clerk hooks (`useSignIn`, `useSignUp`, `useUser`, `useClerk`) — no prebuilt Clerk components
- `ClerkProvider` `appearance` prop is wired to CSS variables for visual consistency of any remaining Clerk modal surfaces
- OAuth (Google, GitHub) + email/password supported

## Frontend i18n boundary

- `next-intl` provides server and client localization
- locale detection: `persai-locale` cookie → `Accept-Language` header → fallback to `en`
- message files: `apps/web/messages/{en,ru}.json`, organized by namespace (~12 namespaces, ~300+ strings)
- server components use `getTranslations(namespace)`; client components use `useTranslations(namespace)`
- non-component files (e.g. `assistant-persona.ts`) export translation keys instead of hardcoded strings; consuming components call `t(key)` or `tp(key)`
- `NextIntlClientProvider` wraps the app in root `layout.tsx`; `next.config.ts` uses `createNextIntlPlugin`

## Frontend/backend boundary

- contracts-first
- no scattered raw fetch
- typed client only

## Memory control boundary (Step 6 D1)

- backend owns a **memory control-plane envelope** per assistant (`assistant_governance.memory_control`):
  - policy (read/write surfaces, group-sourced write denial)
  - provenance metadata hooks (for later enforcement)
  - visibility hooks (user-facing source exposure)
  - forget-request markers (control-plane only in D1; not runtime memory contents)
  - audit routing toward governance `audit_hook`
- OpenClaw owns **runtime memory behavior** and consumption during assistant execution
- materialized `openclawWorkspace.memoryControl` carries the resolved envelope so the runtime does not infer policy
- legacy `policyEnvelope.memoryControl` is supported only as a migration/fallback path

## Memory Center registry (Step 6 D2)

- `assistant_memory_registry_items` stores user-facing **summaries** linked to web chat turns (control plane), not OpenClaw runtime memory contents
- items are created on successful web chat completion (sync + stream paths); list/forget/do-not-remember APIs are assistant-scoped
- “Do not remember” updates registry rows and appends to `memory_control.forgetRequestMarkers` for governance continuity

## Tasks control boundary (Step 6 D4)

- backend owns **`tasks_control`** on `assistant_governance` (`persai.tasksControl.v1`): ownership model, source/surface tagging hooks, control-plane lifecycle labels, user enable/disable/cancel flags, audit delegation; tasks are not a billable quota dimension (enforced by convention, no longer via a dedicated `tasksExcludedFromPlanQuotas` flag)
- OpenClaw owns **execution, scheduling, and trigger routing**; PersAI does not implement a backend scheduler in D4
- materialized `openclawWorkspace.tasksControl` carries the resolved envelope for runtime alignment without inferring policy locally

## Tasks Center registry (Step 6 D5)

- `assistant_task_registry_items` stores user-facing **reminder/task lines** for the Tasks Center (control plane), not raw OpenClaw runtime payloads; `externalRef` may be used later for correlation but is **not** exposed in list APIs
- list/disable/enable/cancel endpoints are assistant-scoped and honor `tasks_control` user affordance flags (`userMayDisable`, `userMayEnable`, `userMayCancel`)
- D5 does not add backend scheduling or execution routing; `nextRunAt` is a display hint until integration populates it

## Plan catalog and entitlements boundary (Step 7 P1)

- backend owns canonical plan packaging truth in `plan_catalog_plans` and `plan_catalog_entitlements` (control plane)
- entitlement groups stored on `plan_catalog_entitlements`:
  - tool classes
  - channels/surfaces
  - (legacy `capabilities` and `limits_permissions` arrays remain in DB schema but are no longer surfaced in API contracts or admin UI — effectively deprecated)
- plan-level quota limits and model selection are stored in `plan_catalog_plans.billing_provider_hints` JSON:
  - `quotaAccounting.tokenBudgetLimit`
  - `quotaAccounting.mediaStorageBytesLimit`
  - `quotaAccounting.workspaceStorageBytesLimit`
  - `quotaAccounting.costOrTokenDrivingToolClassUnitsLimit`
  - `primaryModelKey` (per-plan default AI model)
- default first-registration assignment is modeled by plan flag (`isDefaultFirstRegistrationPlan`) and applied to governance `quotaPlanCode` at assistant baseline creation
- trial behavior is modeled by plan flags (`isTrialPlan`, `trialDurationDays`) and remains control-plane metadata in P1
- no billing-vendor workflow coupling and no runtime behavior routing/enforcement engine in P1

## Admin plan management boundary (Step 7 P2)

- admin-side plan create/edit is exposed in one admin control surface and one API boundary (`/api/v1/admin/plans*`)
- controls remain business-facing (name, metadata, default/trial flags, entitlement/limits toggles), not raw DB model editing
- no billing provider console/workflow coupling in P2; provider selection/integration remains future scope

## Subscription state and billing abstraction boundary (Step 7 P3)

- canonical subscription state is workspace-scoped (`workspace_subscriptions`) and remains in backend control plane
- provider integration boundary is application-layer port (`BillingProviderPort`) with provider-agnostic normalized snapshot contract
- effective assistant subscription resolution uses precedence:
  - assistant governance explicit plan override
  - workspace subscription
  - assistant governance `quotaPlanCode` fallback
  - catalog default first-registration fallback
  - none
- this slice adds no concrete billing provider integration and no invoice/tax workflow logic

## Capability resolution boundary (Step 7 P4)

- effective capabilities are computed centrally in backend control plane from:
  - effective subscription state
  - plan catalog entitlements
  - assistant governance capability envelope
- resolution output (`persai.effectiveCapabilities.v1`) is explicit and reusable by enforcement layers
- backend applies governance as a restrictive guardrail over plan-derived baseline and does not become runtime behavior router
- materialization includes `effectiveCapabilities` so OpenClaw receives explicit availability truth (tools/channels/media)

## Quota accounting boundary (Step 7 P5)

- quota accounting is centralized in backend control plane (`TrackWorkspaceQuotaUsageService`) and persisted per workspace
- tracked commercial dimensions:
  - token budget usage
  - cost/token-driving tool class usage units
  - active web chats cap current usage
  - media storage bytes (enforced on upload, ADR-067)
  - workspace storage bytes (enforced in OpenClaw sandbox write/exec tools, ADR-069)
- tracked counters and append-only events are stored separately:
  - latest state (`workspace_quota_accounting_state`)
  - usage/snapshot event log (`workspace_quota_usage_events`)
- quota limits resolve from provider-agnostic plan hints with config fallback defaults; no billing vendor coupling
- tasks/reminders remain explicitly non-commercial-quota dimensions in this slice
- per-tool daily call limits are enforced via `workspace_tool_usage_daily_counters` persistence plus atomic backend consumption through `TrackWorkspaceQuotaUsageService.consumeToolDailyLimit`; OpenClaw only calls back through the existing `before_tool_call` seam for PersAI runtime turns, it does not become the policy owner
- no backend behavior routing and no BI/reporting expansion in P5

## Enforcement points boundary (Step 7 P6)

- enforcement is centralized in one application-layer service (`EnforceAssistantCapabilityAndQuotaService`)
- active enforcement points in P6:
  - web chat sync send path
  - web chat stream prepare path
- enforced rules combine:
  - P4 effective capabilities (channel/media/tool-class availability)
  - P5 quota/accounting state + plan-derived limits
  - active web chats cap for new-thread creation
- backend remains governance/control plane:
  - it enforces policy at entry boundaries
  - it does not route runtime tool behavior
- OpenClaw materialization includes explicit `toolAvailability` truth so runtime does not assume unavailable tool classes exist
- per-plan model selection is resolved from `billing_provider_hints.primaryModelKey` during materialization; it overrides `runtimeProviderProfile.primary.model` (the field OpenClaw reads via `extractPersaiRuntimeModelOverride`) and takes priority over the global admin-managed model in routing resolution

## Unified inbound turn gateway boundary (Step 12 H13)

- PersAI owns one application-layer inbound turn gateway for all product surfaces:
  - web chat
  - Telegram
  - reminder/cron callbacks
  - future messengers such as WhatsApp/MAX
- the shared gateway is responsible for:
  - assistant/live-state resolution
  - capability/quota/tool-limit/abuse enforcement
  - runtime adapter invocation
  - usage accounting
  - stable error-code emission
- concrete H13 gateway seams now are:
  - public web turn APIs (`POST /api/v1/assistant/chat/web`, `POST /api/v1/assistant/chat/web/stream`)
  - internal Telegram ingress (`POST /api/v1/internal/runtime/turns/telegram`)
  - reminder callback ingress (`POST /api/v1/internal/cron-fire`) with the same backend error-code family before delivery fanout
- OpenClaw runtime execution for non-web channel turns stays behind a thin bridge:
  - `POST /api/v1/runtime/chat/channel`
  - current concrete non-web surface: `telegram`
- OpenClaw remains runtime execution/transport, but PersAI becomes the product-policy authority for inbound turns
- user-facing denial and degradation semantics are derived from stable backend codes, then formatted per surface
- user-scoped runtime-affecting changes remain assistant-scoped:
  - one assistant's settings change can invalidate and reconcile that assistant only
  - broad `full apply` behavior is reserved for explicit admin/platform changes
- per-tool daily usage callbacks from runtime execution are now active through a minimal existing OpenClaw `before_tool_call` seam, while PersAI remains the policy owner and counter authority

## Reminder/task ownership boundary (Step 12 H12)

- PersAI now owns reminders/tasks as a product/control-plane feature
- native OpenClaw cron may still be used as a thin timer/webhook bridge during transition, but it is not the long-term product scheduler boundary
- PersAI-owned reminder/task behavior includes:
  - task/reminder registry truth
  - preferred notification channel
  - fallback delivery ordering across active channels
  - retry/failure state
  - reset-time hard delete
- Tasks Center becomes a current-state surface, not a passive mirror:
  - one-time tasks disappear after successful execution
  - recurring tasks remain one row with `nextRunAt` advanced
  - v1 exposes pause/resume/cancel only

## Tool catalog and activation boundary (Step 8 E1)

- backend owns canonical tool catalog and plan activation truth in control plane:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- canonical tool definitions are maintained in a single source-of-truth file (`apps/api/prisma/tool-catalog-data.ts`); both `seed.ts` and `seed-catalog.ts` import from it
- plan management flow remains role-gated (+ step-up on dangerous writes) and continues to be the single control-plane packaging surface in this slice
- materialization now projects explicit per-tool availability from catalog + activation + effective capability class guardrail
- backend still does not execute or route runtime tool behavior; OpenClaw remains execution owner

## OpenClaw capability envelope boundary (Step 8 E2)

- backend materialization produces explicit runtime-facing capability envelope:
  - `openclawCapabilityEnvelope` (`persai.openclawCapabilityEnvelope.v1`)
- envelope includes:
  - per-tool and per-group allow/deny truth
  - per-surface allowances
  - quota-related class restrictions for cost-driving/utility features
  - explicit suppression list for unavailable tools
- envelope is projection-only governance truth; backend still does not become runtime routing layer

## Channel and surface binding model boundary (Step 8 E3)

- backend materialization now includes explicit channel/surface binding projection:
  - `openclawChannelSurfaceBindings` (`persai.openclawChannelSurfaceBindings.v1`)
- projection preserves model separation:
  - integration provider
  - surface type
  - assistant binding
- provider-level status/policy/config and surface-level allow/deny state are represented separately
- MAX is no longer flattened at projection level:
  - projected as distinct surfaces: `max_bot`, `max_mini_app`
- backend remains control-plane only; no channel delivery routing is implemented in E3

## Telegram connection surface boundary (Step 8 E4)

- backend now supports assistant-scoped Telegram connection/control-plane APIs:
  - `GET /assistant/integrations/telegram`
  - `POST /assistant/integrations/telegram/connect`
  - `PATCH /assistant/integrations/telegram/config`
- canonical Telegram binding state is persisted in:
  - `assistant_channel_surface_bindings`
- token handling in E4 persists only control-plane fingerprint/hint metadata (not raw token storage in domain state response)
- web remains primary assistant control surface; Telegram is treated as interaction/delivery surface binding
- E4 does not add WhatsApp/MAX delivery and does not turn backend into runtime routing layer

## Provider and fallback baseline boundary (Step 8 E6)

- backend materialization now projects explicit runtime provider routing baseline:
  - `runtimeProviderRouting` (`persai.runtimeProviderRouting.v1`)
  - embedded inside `openclawCapabilityEnvelope`
- Step 12 H1 adds the first admin-managed runtime profile on top of that seam:
  - raw selection lives in `assistant_governance.policyEnvelope.runtimeProviderProfile`
  - provider credential refs live in `assistant_governance.secret_refs.refs.runtime_provider_credentials`
  - materialization resolves `openclawBootstrap.governance.runtimeProviderProfile`
- routing baseline is runtime-managed and minimal:
  - primary path: `openclaw_managed_default` + model key
  - explicit fallback matrix for timeout/provider-failure, runtime-degraded, and cost-driving restriction cases
- eligibility is aligned with control-plane governance truth:
  - effective capabilities (interactive channels + text media)
  - entitlement-derived cost-driving allowance/quota governance
  - optional policy override via `policyEnvelope.runtimeProviderRouting` (model keys and fallback disable)
- when H1 runtime provider profile is present, `runtimeProviderRouting` becomes a derived projection of the admin-managed primary/fallback provider+model choice rather than a pure Helm/runtime-default hint
- no user-facing provider picker and no provider marketplace logic are added in E6

## Append-only audit boundary (Step 9 F1)

- backend now owns canonical append-only audit persistence for critical control-plane and runtime-transition truth:
  - `assistant_audit_events`
- audit rows are immutable at DB level (no update/delete mutation path)
- F1 audit scope is intentionally high-signal:
  - lifecycle milestones (create/draft/publish/rollback/reset/reapply request)
  - runtime apply transitions (`in_progress|succeeded|failed|degraded`)
  - admin plan create/update actions
  - policy/binding critical changes (memory forget-marker append, Telegram binding/config, token fingerprint update)
- audit remains control-plane telemetry; backend still does not become runtime behavior router

## Admin RBAC and step-up boundary (Step 9 F2)

- backend owns explicit admin authorization model in control plane:
  - `app_user_admin_roles` (`ops_admin|business_admin|security_admin|super_admin`)
- admin read surfaces are role-gated and remain separate from end-user assistant ownership flows
- dangerous admin write actions require step-up token verification:
  - `admin.plan.create`
  - `admin.plan.update`
  - `admin.rollout.apply`
  - `admin.rollout.rollback`
- role/context and step-up verification outcomes are written to append-only audit events
- compatibility fallback is narrow: workspace `owner` maps to legacy `business_admin` access only

## Ops cockpit boundary (Step 9 F3)

- backend now exposes a role-gated ops cockpit read model:
  - `GET /api/v1/admin/ops/cockpit`
  - `GET /api/v1/admin/ops/users?q=&offset=&limit=` — paginated user directory with assistant summary
  - `POST /api/v1/admin/ops/users/:userId/reapply` — trigger reapply for any user's assistant
  - `DELETE /api/v1/admin/ops/users/:userId` — full cascade delete of user and all owned data
- cockpit read model is intentionally bounded and high-signal:
  - assistant/runtime status snapshot
  - publish/apply truth pointer
  - runtime preflight state
  - minimal topology awareness (`OPENCLAW_ADAPTER_ENABLED`, OpenClaw host)
  - concise incident signals derived from control-plane/runtime transition truth
  - user directory with search and pagination (admin can view and act on any user)
- ops controls in F3 are limited to already-supported lifecycle actions:
  - reapply is surfaced when a latest published version exists (self or any user via user directory)
  - restart is explicitly unsupported in this slice
- no BI expansion and no raw event/metrics wall are introduced in F3

## Business cockpit boundary (Step 9 F4)

- backend now exposes a separate role-gated business cockpit read model:
  - `GET /api/v1/admin/business/cockpit`
- business cockpit stays intentionally scanable and bounded to product/commercial signals:
  - active assistants
  - active chats
  - channel split
  - publish/apply success snapshot
  - quota pressure snapshot
  - plan usage snapshot
- business cockpit remains read-only visibility and does not introduce operational lifecycle controls
- separation is explicit:
  - ops cockpit = operational/runtime truth
  - business cockpit = commercial/product visibility

## Admin system-notification boundary (Step 9 F5)

- backend now owns explicit workspace-scoped admin notification channel model and delivery logs:
  - `workspace_admin_notification_channels`
  - `admin_notification_deliveries`
- channel management stays in admin control-plane APIs and web admin workspace; notifications do not replace console workflows
- F5 baseline delivery transport is webhook (system-oriented payload, optional signing secret)
- notification trigger scope is intentionally bounded to selected high-signal admin/runtime events
- delivery is best-effort and non-blocking to primary control-plane actions

## Progressive rollout and rollback boundary (Step 9 F6)

- backend now owns explicit platform-managed rollout operation model:
  - `assistant_platform_rollouts`
  - `assistant_platform_rollout_items`
- rollout scope is strictly platform-managed governance layers (`assistant_governance` fields only)
- user-owned assistant truth is preserved:
  - no draft mutation
  - no published-version row mutation
- rollout applies soft updates by:
  - updating governance snapshot per targeted assistant
  - triggering runtime reapply against latest published version (when present)
- rollback support is explicit and mandatory:
  - pre-rollout governance snapshot is captured per targeted assistant
  - rollback restores that snapshot and triggers reapply
- controls are action-scoped dangerous admin operations with step-up:
  - `admin.rollout.apply`
  - `admin.rollout.rollback`
- F6 is an operator control baseline, not a full staged-orchestration or auto-remediation engine

## Secret lifecycle hardening boundary (Step 10 G1)

- backend keeps canonical assistant SecretRef lifecycle state in control-plane governance (`assistant_governance.secret_refs`, schema `persai.secretRefs.v1`)
- lifecycle metadata is explicit and non-secret:
  - version
  - status (`active|revoked|emergency_revoked`, with computed `expired` at read/evaluation time)
  - rotation/revoke timestamps
  - TTL-derived expiration timestamp
- Telegram integration is the G1 baseline managed SecretRef path:
  - connect/rotate writes managed SecretRef lifecycle metadata
  - revoke and emergency-revoke explicitly disable binding usage
- Step 12 H1 extends the same control-plane container with runtime provider credential refs:
  - `secret_refs.refs.runtime_provider_credentials`
  - provider-scoped metadata + OpenClaw-compatible `SecretRef` objects
  - still no raw provider secrets in PersAI state
- OpenClaw-facing channel/surface readiness stays projection-based and now checks SecretRef lifecycle state, with narrow legacy compatibility fallback for pre-G1 active Telegram bindings
- backend still does not expose secret values in broad domain/UI surfaces and does not reimplement runtime secret behavior in OpenClaw

## Abuse and rate-limit boundary (Step 10 G2)

- abuse/rate-limit protection is centralized in backend control-plane entry boundaries for chat transport paths
- enforcement is explicitly multi-layered:
  - per-user + per-assistant-per-surface window thresholds
  - per-assistant aggregate-per-surface thresholds
  - quota-pressure-aware slowdown and temporary block hooks
- active G2 enforcement surface is `web_chat`; channel-aware model includes future surfaces (`telegram|whatsapp|max`) without changing architecture
- admin recovery capability is explicit and audited:
  - unblock/override endpoint for abuse states
- this is not a moderation/semantic trust-safety system; it is rate/abuse control hardening at control-plane boundaries

## Recovery and ownership transfer boundary (Step 10 G3)

- reset, deletion, and ownership recovery/transfer remain distinct semantics:
  - reset mutates assistant content lifecycle only
  - hard delete removes chat history only where explicit delete APIs are invoked
  - ownership transfer/recovery rebinds assistant owner identity without content reset or chat deletion side effects
- ownership transfer/recovery is admin-governed and audited dangerous action flow with step-up:
  - `admin.assistant.transfer_ownership`
  - `admin.assistant.recover_ownership`
- ownership boundary guardrails:
  - target owner must be in same workspace
  - target owner must not already hold another assistant under MVP one-user-one-assistant rule
  - operation scope is limited to admin workspace boundary
- resource consequences are explicit and controlled:
  - memory/chat/task ownership linkage rebinds with assistant owner relation
  - channel bindings and governance SecretRef metadata remain attached to assistant
  - append-only audit history is preserved; transfer/recovery adds new admin action events only

## Retention/delete/compliance baseline (Step 10 G4)

- MVP compliance baseline is explicit and enforced at product boundary, not implied:
  - Terms of Service acceptance
  - Privacy Policy acceptance
  - retention/delete/audit model visibility
- onboarding completion now requires both:
  - workspace membership
  - acceptance of current MVP ToS/Privacy versions
- retention model is explicit "no silent TTL purge":
  - chats stay until user archive/hard-delete actions
  - memory registry items stay until forget/do-not-remember actions
  - task registry rows stay until user control changes (disable/cancel) or future explicit delete flows
- delete semantics remain action-scoped and explicit:
  - chat hard delete remains irreversible and confirmation-gated
  - reset remains non-delete lifecycle action
  - ownership transfer/recovery remains non-delete ownership action
- audit baseline remains append-only and immutable; G4 does not introduce audit-row mutation/deletion paths

## Provider/surface readiness hardening (Step 10 G5)

- channel/surface model remains provider + surface explicit (no flat channel collapse):
  - `whatsapp` -> `whatsapp_business`
  - `max` -> `max_bot` + `max_mini_app` (distinct surfaces)
- OpenClaw channel/surface binding projection now resolves provider configured state from canonical assistant bindings for:
  - `telegram`
  - `whatsapp`
  - `max`
- Telegram keeps additional managed SecretRef lifecycle gate; WhatsApp/MAX currently use binding readiness only.
- this slice is architecture hardening only:
  - no WhatsApp delivery implementation
  - no MAX bot/mini-app delivery implementation
  - no collapse of bot and mini-app into one MAX surface

## Telegram runtime delivery boundary (Step 12 H8)

- Telegram is an interaction/delivery surface, not a control-plane surface.
- PersAI materializes Telegram config into `openclawBootstrap.channels.telegram` (token, webhook URL, HMAC secret, policy, group reply mode).
- OpenClaw owns Telegram runtime delivery:
  - dynamic Grammy bot lifecycle (start/stop on spec apply)
  - webhook mode (when `TELEGRAM_WEBHOOK_BASE_URL` is configured) or polling fallback (when unset)
  - `message:text` event handling → agent turn with per-assistant `workspaceDir`
  - `my_chat_member` event handling → group status callback to PersAI (uses `secrets.providers.persai-runtime.baseUrl` from config)
- OpenClaw Telegram ingress is also the enforcement point for Telegram-specific runtime safety:
  - dedupe repeated Telegram deliveries by `assistantId + update_id`
  - owner-only DM gate before runtime turn execution
  - terminal `401 Unauthorized` promotion to explicit `invalid_token` state
- PersAI owns Telegram control-plane:
  - connect/disconnect/rotate/revoke via assistant integration APIs
  - encrypted token storage (`PlatformRuntimeProviderSecretStoreService`)
  - `assistant_telegram_groups` persistence from OpenClaw callbacks
  - auto-apply after connect/disconnect to push config changes to OpenClaw immediately
- PersAI Telegram lifecycle is now explicitly staged:
  - `not_connected`
  - `claim_required`
  - `connected`
  - `invalid_token`
- direct-message access is private by default:
  - `owner_only`
  - owner claim completes through a one-time 6-digit code shown in PersAI and sent to the bot chat
  - while claim is pending, the bot answers with a short locale-aware prompt telling the user to send that code
  - successful claim triggers an immediate system-language Telegram welcome message so the owner chat appears without manual search
- Telegram agent turns share the same per-assistant workspace as web chat (same `MEMORY.md`, bootstrap files).
- Backend does not route Telegram messages or manage bot lifecycle directly.

## Telegram lifecycle hardening boundary (Step 12 H8-scale)

- OpenClaw runtime reconcile must be fingerprint-driven and idempotent:
  - transport fingerprint decides whether Telegram bot rotation is required
  - profile fingerprint decides whether Telegram profile APIs should run
- startup/reinit must be bounded with concurrency control, jitter, and retry backoff; non-critical profile work is deferred until after gateway readiness
- the single-assistant freshness seam returns fresh materialized spec data to OpenClaw for local reconcile; it does not route through the normal backend runtime-apply lifecycle
- PersAI assistant create/reset flows must trigger assistant-scoped runtime session cleanup; generic OpenClaw session maintenance remains a safety backstop, not the primary reset semantic

## Memory source policy enforcement (Step 6 D3)

- Global **registry** read and write paths evaluate `memory_control` (plus legacy fallback): read surfaces gated by `globalMemoryReadAllSurfaces`; writes require trusted 1:1 classification and an allowed + trusted transport surface (MVP: web only); group-sourced global registry writes are denied.
- Web chat classifies turns as `trusted_1to1` + `web` at the send/stream services; the record hook does not infer trust in isolation.
- Other channels and group contexts are out of scope; they must not bypass this module when future ingest is added (ADR-021).

## H3: Runtime hydration depth

### Per-user workspace isolation (OpenClaw)

- Runtime uses per-assistant directories under `PERSAI_WORKSPACE_ROOT/<assistantId>/`.
- `workspaceDir` is passed per-request via `commandInput` (not `process.env`), and carried through `persaiRuntimeRequestContext` (AsyncLocalStorage in `persai-runtime-context.ts`) so memory tools and session management resolve the correct workspace even under concurrent requests.
- Session transcript `cwd` is synced with the runtime `workspaceDir` on every turn to prevent drift after workspace moves.
- Helm: GCS FUSE via CSI driver volume mount; workload identity–bound ServiceAccount (`infra/helm/templates/openclaw-serviceaccount.yaml` and related chart values).

### Bootstrap file pipeline

- PersAI `MaterializeAssistantPublishedVersionService` emits seven Markdown bootstrap docs into materialized `openclawWorkspace.bootstrapDocuments` (e.g. SOUL.md, USER.md, IDENTITY.md, TOOLS.md, AGENTS.md, HEARTBEAT.md, BOOTSTRAP.md).
- Admin-editable bootstrap presets (`bootstrap_document_presets`) now include **`tools`** alongside soul/user/identity/agents. The `TOOLS.md` preset is a Markdown wrapper; **`{{tools_catalog_block}}`** is filled at materialize time from the effective plan (active/disabled tool codes, daily limits, live-usage guidance). Omitting the placeholder drops the generated catalog from the final doc.
- Apply path: materialized spec → `POST /api/v1/runtime/spec/apply` → OpenClaw `persai-runtime-workspace.ts` writes files on disk with **write-once / never overwrite** rules for bootstrap artifacts.
- PersAI assistant workspaces treat `BOOTSTRAP.md` as a one-time birth certificate:
  - it is created on first apply into a fresh assistant workspace
  - after the first successful web or Telegram assistant turn, PersAI calls the runtime bootstrap-consume seam and OpenClaw deletes `BOOTSTRAP.md` plus writes a small consumed marker
  - later ordinary applies/re-materializations do **not** recreate `BOOTSTRAP.md` while that workspace still exists
  - full reset/recreate deletes the whole assistant workspace, so the next fresh apply creates `BOOTSTRAP.md` again
- OpenClaw heartbeat/background runs now use a dedicated `:heartbeat` session sibling instead of the main user session, so background polling no longer reuses the main chat transcript or re-injects assistant `BOOTSTRAP.md` as if it were user traffic.

### Setup preview boundary

- final setup/recreate preview is backend-owned and runtime-backed, but it is **not** part of normal publish/apply lifecycle truth
- setup preview uses the persisted draft plus current `/me` profile data as the source of truth
- preview materializes transient OpenClaw artifacts, then executes through a dedicated preview-only runtime seam
- preview does **not** persist to the OpenClaw applied-spec store and does **not** touch the live assistant workspace root
- preview does **not** create `assistant_published_versions` rows
- preview does **not** advance `latestPublishedVersion`
- preview does **not** create ordinary chat history
- assistant-owned identity now includes `assistantGender` alongside name/instructions/traits/avatar and is materialized into the bootstrap document set

### Memory delegation

- **Registry** (D2/D3): PersAI DB + `GET/POST /assistant/memory/items` family — global policy summaries from web chat.
- **Workspace memory** (H3): file-backed store in OpenClaw; PersAI proxies CRUD/search to runtime HTTP (`OpenClawRuntimeAdapter`); UI “Workspace” tab talks to proxy routes, “History” tab to registry list where applicable.

## Media, attachments, and voice boundary (M-series, ADR-059, ADR-060)

- PersAI owns canonical chat message attachment lifecycle in `assistant_chat_message_attachments` (control plane)
- attachment types: `image`, `audio`, `voice`, `video`, `document`, `tool_output`
- physical media binaries for active chat attachments/artifacts live in PersAI-owned object storage; `assistant_chat_message_attachments.storage_path` currently stores the PersAI object key even though the column name still reflects the older media model
- the underlying object storage may reuse the same cloud bucket family as other PersAI storage, but attachment persistence is no longer modeled as an OpenClaw workspace filesystem concern
- tool-generated media (`image_generate`, `tts`) is captured from OpenClaw agent response payloads and persisted as `tool_output` attachments after turn completion; delivery is post-completion with natural model status text during generation
- inbound voice messages (web microphone + Telegram `message:voice`) now use the native STT path `apps/api -> apps/runtime -> apps/provider-gateway -> OpenAI`; transcription text becomes the runtime `userMessage`, and the original audio is preserved as an attachment
- media capabilities (`image`, `audio`, `video`, `file`) are plan-governed via `effectiveCapabilities.mediaClasses` (activated from plan entitlements, no longer hardcoded false)
- media storage is quota-tracked via `media_storage_bytes` dimension in the existing workspace quota accounting system
- cleanup: chat hard-delete / assistant reset / admin delete remove attachment objects from PersAI storage as part of the same bounded PersAI-owned media lifecycle
- native web turns now pass raw user text plus attachment refs into `apps/runtime`, which hydrates attachment summaries from canonical `assistant_chat_message_attachments` rows instead of relying on workspace paths or API-only prompt enrichment for the native path
- OpenClaw workspace media is no longer target-state storage for active chat attachments; any remaining OpenClaw media calls are temporary migration seams outside the final attachment architecture
- native OpenClaw changes in M-series stayed intentionally small, centered on Yandex TTS support and a few runtime fixes/seams; the majority of the implementation remained PersAI-side or in PersAI bridge files in the fork

### Unified media pipeline (ADR-060)

- all media handling goes through three unified services in `apps/api/src/modules/workspace-management/application/media/`:
  - `MediaPreprocessorService` — normalizes inbound media: audio webm/ogg→mp3 (ffmpeg), image heic→jpg + resize (sharp), PDF text extraction, video audio track STT
  - `InboundMediaService` — single `resolve()` entry point for all inbound user attachments (any channel); preprocesses → stores in PersAI object storage → creates attachment records with canonical transcription/content-preview metadata → builds the current legacy-path model context block when needed
  - `MediaDeliveryService` — single `deliver()` entry point for all outbound tool-generated media; downloads source artifacts → persists the PersAI-owned attachment copy → creates attachment records → delegates to channel adapter
- `ChannelMediaAdapter` interface defines per-channel delivery contract (`sendImage`, `sendVoice`, `sendAudio`, `sendDocument`, `sendVideo`)
- current adapters: `WebMediaAdapter` (no-op, proxy-based), `TelegramMediaAdapter` (bridge-delegated via turn response)
- adding a new channel (WhatsApp, VK, Matrix) = one new adapter file implementing `ChannelMediaAdapter`, zero changes to core pipeline
- turn services (`StreamWebChatTurnService`, `SendWebChatTurnService`, `HandleInternalTelegramTurnService`) are consumers of the pipeline, not implementors of media logic
