# ARCHITECTURE

## Architecture style

Modular monolith for apps/api, with strict module and layer boundaries.

## Repo structure

- apps/web
- apps/api
- services/openclaw
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

OpenClaw is a neighboring service in services/openclaw.
It is not part of the foundation runtime and not part of backend domain logic.
`apps/api` must not call OpenClaw in Step 1/Step 2 and O1.
O6 defines a future adapter-only contract:

- OpenClaw calls are allowed only via infrastructure adapter boundary in `apps/api`
- domain/application modules remain OpenClaw-agnostic
- first implemented interactions (A8):
  - runtime preflight (`/healthz`, `/readyz`)
  - apply/reapply of A7 materialized published specs through adapter

## Chat boundary (Step 5 C1)

- backend stores canonical user-facing chat records:
  - chat/thread identity
  - message history
  - ownership and retention-oriented record fields
- OpenClaw stores runtime conversational/session context only
- backend chat domain must not include runtime session internals
- surface-aware threading is explicit and record-level (`surface + surfaceThreadKey`)

## Chat transport boundary (Step 5 C2)

- backend web chat transport entrypoint:
  - `POST /api/v1/assistant/chat/web`
- transport is adapter-only to OpenClaw runtime:
  - `POST /api/v1/runtime/chat/web`
- backend persists canonical chat/message records before/after runtime turn
- transport is synchronous in C2 (no streaming)

## Chat streaming boundary (Step 5 C3)

- primary web chat UX path is streaming-first:
  - `POST /api/v1/assistant/chat/web/stream`
- backend streams transport events to web UI and keeps canonical record ownership
- adapter boundary remains explicit for runtime stream:
  - `POST /api/v1/runtime/chat/web/stream`
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

- backend owns **`tasks_control`** on `assistant_governance` (`persai.tasksControl.v1`): ownership model, source/surface tagging hooks, control-plane lifecycle labels, user enable/disable/cancel flags, **explicit `commercialQuota.tasksExcludedFromPlanQuotas`** (tasks are not a billable quota dimension), audit delegation
- OpenClaw owns **execution, scheduling, and trigger routing**; PersAI does not implement a backend scheduler in D4
- materialized `openclawWorkspace.tasksControl` carries the resolved envelope for runtime alignment without inferring policy locally

## Tasks Center registry (Step 6 D5)

- `assistant_task_registry_items` stores user-facing **reminder/task lines** for the Tasks Center (control plane), not raw OpenClaw runtime payloads; `externalRef` may be used later for correlation but is **not** exposed in list APIs
- list/disable/enable/cancel endpoints are assistant-scoped and honor `tasks_control` user affordance flags (`userMayDisable`, `userMayEnable`, `userMayCancel`)
- D5 does not add backend scheduling or execution routing; `nextRunAt` is a display hint until integration populates it

## Plan catalog and entitlements boundary (Step 7 P1)

- backend owns canonical plan packaging truth in `plan_catalog_plans` and `plan_catalog_entitlements` (control plane)
- entitlement groups are explicit and provider-agnostic:
  - capabilities
  - tool classes
  - channels/surfaces
  - limits-related permissions
- default first-registration assignment is modeled by plan flag (`isDefaultFirstRegistrationPlan`) and applied to governance `quotaPlanCode` at assistant baseline creation
- trial behavior is modeled by plan flags (`isTrialPlan`, `trialDurationDays`) and remains control-plane metadata in P1
- no billing-vendor workflow coupling and no runtime behavior routing/enforcement engine in P1

## Admin plan management boundary (Step 7 P2)

- admin-side plan create/edit is exposed in one owner-gated control surface and one API boundary (`/api/v1/admin/plans*`)
- controls remain business-facing (name, metadata, default/trial flags, entitlement/limits toggles), not raw DB model editing
- no billing provider console/workflow coupling in P2; provider selection/integration remains future scope

## Subscription state and billing abstraction boundary (Step 7 P3)

- canonical subscription state is workspace-scoped (`workspace_subscriptions`) and remains in backend control plane
- provider integration boundary is application-layer port (`BillingProviderPort`) with provider-agnostic normalized snapshot contract
- effective assistant subscription resolution uses precedence:
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
- materialization includes `effectiveCapabilities` so OpenClaw receives explicit availability truth (tools/channels/media/governed features)

## Quota accounting boundary (Step 7 P5)

- quota accounting is centralized in backend control plane (`TrackWorkspaceQuotaUsageService`) and persisted per workspace
- tracked commercial dimensions in P5:
  - token budget usage
  - cost/token-driving tool class usage units
  - active web chats cap current usage
- tracked counters and append-only events are stored separately:
  - latest state (`workspace_quota_accounting_state`)
  - usage/snapshot event log (`workspace_quota_usage_events`)
- quota limits resolve from provider-agnostic plan hints with config fallback defaults; no billing vendor coupling
- tasks/reminders remain explicitly non-commercial-quota dimensions in this slice
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

## Tool catalog and activation boundary (Step 8 E1)

- backend owns canonical tool catalog and plan activation truth in control plane:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- plan management flow remains owner-gated and continues to be the single control-plane packaging surface in this slice
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
- routing baseline is runtime-managed and minimal:
  - primary path: `openclaw_managed_default` + model key
  - explicit fallback matrix for timeout/provider-failure, runtime-degraded, and cost-driving restriction cases
- eligibility is aligned with control-plane governance truth:
  - effective capabilities (interactive channels + text media)
  - entitlement-derived cost-driving allowance/quota governance
  - optional policy override via `policyEnvelope.runtimeProviderRouting` (model keys and fallback disable)
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

## Memory source policy enforcement (Step 6 D3)

- Global **registry** read and write paths evaluate `memory_control` (plus legacy fallback): read surfaces gated by `globalMemoryReadAllSurfaces`; writes require trusted 1:1 classification and an allowed + trusted transport surface (MVP: web only); group-sourced global registry writes are denied.
- Web chat classifies turns as `trusted_1to1` + `web` at the send/stream services; the record hook does not infer trust in isolation.
- Other channels and group contexts are out of scope; they must not bypass this module when future ingest is added (ADR-021).
