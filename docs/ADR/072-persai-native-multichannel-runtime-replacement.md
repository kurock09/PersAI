# ADR-072: PersAI-native multi-channel runtime replacement

**Status:** Accepted  
**Date:** 2026-04-10  
**Supersedes:** ADR-048, ADR-063, ADR-071 for the final-state request-time execution architecture  
**Relates to:** ADR-006, ADR-015, ADR-033, ADR-058, ADR-070

## Context

PersAI has outgrown the request-time execution shape built around the neighboring OpenClaw runtime. The current codebase still routes runtime execution for web chat, Telegram delivery, media storage, and session continuity through OpenClaw-centered contracts and artifacts:

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/telegram-webhook-proxy.controller.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-http.ts`

At the same time, PersAI already owns the correct control-plane responsibilities:

- assistant publication and materialization
- governance and policy
- quotas and abuse controls
- canonical chats, messages, and attachment records
- admin-managed provider/runtime settings
- delivery/business control surfaces

The product direction is no longer one-channel or one-runtime. The target operating model is:

- multi-channel first (`web`, `telegram`, then `max_ru`)
- multi-user and multi-tenant from the start
- low-latency and horizontally scalable
- production-ready at `10000+` users without process-local runtime assumptions
- understandable without any OpenClaw mental model in the final architecture

This ADR defines the clean target state. Current code and current architecture docs still describe the legacy OpenClaw-based runtime path until rollout completes; this ADR replaces that target state and rollout direction.

## Problem

The current request-time execution path is structurally wrong for PersAI's production goals.

### 1. The runtime contract is polluted by OpenClaw-specific shapes

PersAI materialization persists `openclawBootstrap` and `openclawWorkspace` as first-class runtime artifacts in `assistant_materialized_specs`. That means PersAI currently compiles runtime data into a foreign execution model instead of a PersAI-native one.

### 2. Hot-path execution carries heavy runtime boot and callback churn

OpenClaw request handling still performs turn-time freshness checks, config layering, secret resolution, session-manager open, context-engine readiness, and embedded-agent preparation before normal chat execution. This adds latency variability and operational opacity.

### 3. Session ownership is not multi-replica-safe

The current runtime still depends on process-local/session-file assumptions for runtime continuity. That is incompatible with clean horizontal scale and durable session ordering under `10000+` active users.

### 4. Delivery and execution are mixed

Telegram ingress currently loops through an OpenClaw-centric webhook path rather than passing through a PersAI-native channel adapter into a neutral runtime. This couples delivery semantics to runtime internals.

### 5. Media and tool execution are mixed into the normal chat path

Attachment storage, transcription, and tool/runtime execution still depend on the same legacy runtime boundary. Ordinary chat turns should not inherit heavy worker or sandbox assumptions.

### 6. Incremental cleanup is insufficient

Local optimizations inside the OpenClaw path do not solve the core mismatch:

- OpenClaw-shaped materialization would remain
- request-time execution would still inherit runtime-specific boot behavior
- session ownership would still be wrong for multi-user production
- the system would still be conceptually split around a legacy runtime executor

The issue is therefore not a bottleneck to optimize. It is the wrong runtime architecture.

## Decision

PersAI will replace OpenClaw completely for request-time execution with a PersAI-native, multi-channel runtime architecture.

The final-state system will consist of:

- `PersAI control plane`
- `PersAI runtime service`
- `provider gateway`
- `session/state subsystem`
- `media subsystem`
- `async job/workers subsystem`
- `sandbox/code execution subsystem`
- `delivery adapters`

OpenClaw compatibility is allowed only as temporary migration scaffolding at the cutover boundary. It is explicitly forbidden in the final architecture.

The final target state is:

- no OpenClaw request-time execution for `web`
- no OpenClaw request-time execution for `telegram`
- no OpenClaw-owned webhook loop for PersAI channels
- no OpenClaw-shaped runtime artifacts
- no filesystem-owned session state in the hot path
- no request-time provider/plugin discovery
- no request-time runtime callbacks back into PersAI for freshness or secrets

## Architecture principles

1. **PersAI owns the runtime model**
   The runtime contract, bundle schema, and channel envelope are PersAI-native and not derived from OpenClaw terminology.

2. **Control plane and execution plane are separate systems**
   Policy compilation, governance, admin runtime settings, and canonical business records stay in the control plane. Turn execution stays in the runtime plane.

3. **Multi-channel is a first-class assumption**
   `web`, `telegram`, and later `max_ru` are adapters over one conversation runtime. Channels do not get separate runtime kernels.

4. **Distributed state is mandatory**
   Session ordering, idempotency, active windows, and delivery claims must live in shared distributed systems, not local files.

5. **Hot-path execution is minimal**
   Only bounded work is allowed before the first token or final response. No general-purpose agent boot, plugin scan, or sandbox startup in ordinary chat.

6. **Providers are prewarmed**
   Provider clients, secrets, model catalogs, and routing state are warmed before user turns. Request-time discovery is forbidden.

7. **Media is object-storage based**
   Attachments and generated artifacts live in object storage with Postgres metadata. Local scratch space is never authoritative.

8. **Sandbox is isolated from chat latency**
   Code execution and long-running tools are async and isolated. They may be invoked by chat but may not define the latency profile of chat.

9. **Interfaces are explicit and bounded**
   The runtime exposes clean, typed contracts for turns, sessions, attachments, media, tools, jobs, bundle warmup, and health.

10. **Deletion is preferred over adaptation**
    If a concept exists only to support the OpenClaw request path, it must not survive the final architecture.

## Target architecture

#### 1. PersAI control plane

**Responsibilities**

- assistant publication and apply lifecycle
- governance, plan, quota, and abuse policy
- canonical chats/messages/attachments metadata
- runtime bundle compilation and registry
- admin provider/runtime settings
- rollout flags and runtime routing policy
- audit and operator control surfaces

**Non-responsibilities**

- provider SDK calls
- token streaming
- session leases
- Telegram delivery retries
- media binary transforms
- sandbox execution

**Sync/async role**

- sync for public/admin APIs and canonical writes
- async for bundle warm/invalidate events, analytics, and operator workflows

**Scaling model**

- stateless API replicas over shared Postgres and Redis

**Data ownership**

- canonical relational truth
- runtime bundle metadata
- secret references and runtime policy
- audit logs

#### 2. PersAI runtime service

**Responsibilities**

- `createTurn`
- `streamTurn`
- `resolveSession`
- `compactSession`
- context assembly from bundle + canonical state
- bounded inline tool execution
- runtime response persistence hooks
- runtime traces and stream lifecycle

**Non-responsibilities**

- policy authoring
- bundle compilation
- channel-specific delivery transports
- direct secret storage
- heavy media generation
- sandbox execution

**Sync/async role**

- sync for turn handling and streaming
- async handoff for compaction, heavy tools, and workers

**Scaling model**

- stateless horizontal runtime pods
- one active lease per session
- Redis-backed coordination

**Data ownership**

- ephemeral execution state only

#### 3. Provider gateway

**Responsibilities**

- provider abstraction
- model routing and fallback
- retries and timeout policy
- streaming normalization
- normalized usage accounting
- warm provider clients and model catalogs
- circuit breaking and provider health

**Non-responsibilities**

- canonical chat state
- session ordering
- delivery logic
- policy authoring

**Sync/async role**

- sync inference path
- async catalog refresh and secret rotation

**Scaling model**

- horizontally scaled network-bound service

**Data ownership**

- in-memory provider clients
- short-lived health and circuit state

#### 4. Session/state subsystem

**Responsibilities**

- turn ordering
- idempotency keys
- session leases
- active session windows
- token estimates
- compaction hints
- stream state
- Telegram update claiming
- bundle warm markers

**Non-responsibilities**

- canonical transcript storage
- attachments metadata authority
- provider secrets

**Sync/async role**

- sync on every turn
- async expiration and recovery cleanup

**Scaling model**

- Redis cluster with TTLs, leases, and optimistic versioning

**Data ownership**

- ephemeral runtime state only

#### 5. Media subsystem

**Responsibilities**

- attachment staging
- object-storage write/read/delete
- MIME validation and normalization
- STT
- later TTS, image generation, and video generation orchestration
- artifact lifecycle and GC

**Non-responsibilities**

- turn policy
- session ordering
- assistant governance

**Sync/async role**

- sync for bounded attachment stage and short STT
- async for heavy media jobs

**Scaling model**

- stateless media ingress plus queue-backed workers

**Data ownership**

- object storage for binaries
- Postgres metadata for attachments and generated artifacts

#### 6. Async job/workers subsystem

**Responsibilities**

- media generation jobs
- deferred compaction
- indexing and RAG refresh
- long-running external integrations
- post-turn enrichments
- delivery retries where needed

**Non-responsibilities**

- normal chat reply generation
- canonical session ownership

**Sync/async role**

- async only

**Scaling model**

- queue-driven workers with per-job concurrency control

**Data ownership**

- job status, receipts, artifact references

#### 7. Sandbox/code execution subsystem

**Responsibilities**

- isolated shell/code tasks
- resource-limited execution
- artifact production
- strict egress and workspace policy

**Non-responsibilities**

- ordinary chat turns
- provider streaming
- channel delivery
- session state authority

**Sync/async role**

- async only

**Scaling model**

- isolated worker pool or job runner with hard CPU/RAM/time limits

**Data ownership**

- job metadata and produced artifacts only

#### 8. Delivery adapters

**Responsibilities**

- normalize inbound channel events
- map external thread identity to runtime session identity
- signature/token verification
- outbound delivery and retries
- delivery receipts

**Non-responsibilities**

- provider calls
- runtime context assembly
- compaction logic
- quota policy compilation

**Sync/async role**

- sync ingress handoff
- async outbound retry/reconciliation

**Scaling model**

- per-channel stateless adapters

**Data ownership**

- minimal delivery metadata and receipts

## Rejected alternatives

### 1. Keep OpenClaw as the long-term request-time executor and optimize it

Rejected because it preserves the wrong execution shape:

- OpenClaw-shaped artifacts
- callback-heavy hot path
- session continuity assumptions incompatible with true multi-user scale
- delivery/runtime mixing

### 2. Build a thin wrapper around OpenClaw and call it a new runtime

Rejected because that is architectural camouflage, not replacement. The operational and mental model contamination would remain.

### 3. Keep OpenClaw for Telegram and only replace web

Rejected because channel-specific runtime kernels create long-term duplication. `web`, `telegram`, and later `max_ru` must share one conversation runtime.

### 4. Keep one monolithic `apps/api` process and call providers directly from existing controllers/services

Rejected because the control plane would remain mixed with execution responsibilities, and scaling/latency isolation would be poor.

### 5. Preserve OpenClaw bundle shape for compatibility

Rejected because it would lock PersAI into OpenClaw terminology and maintain materialization debt in the new system.

### 6. Put sandbox and heavy tools directly in the default chat path

Rejected because it would reintroduce latency instability into ordinary chat turns.

## Consequences

### Positive

- PersAI gets one clean multi-channel runtime model.
- Request-time execution becomes horizontally scalable and easier to reason about.
- The final system is understandable without OpenClaw internals.
- Provider routing, bundles, sessions, and media get explicit ownership boundaries.
- `web`, `telegram`, and later `max_ru` can share one runtime kernel.
- Latency tuning becomes possible with explicit subsystem metrics instead of gateway folklore.

### Negative

- This is a large architectural replacement, not a small refactor.
- Existing runtime seams, docs, and persistence shapes will need migration.
- Multiple current ADR assumptions become legacy during rollout.
- Temporary boundary-level migration scaffolding is required during cutover.
- The implementation program touches API, runtime, data model, infra, and delivery simultaneously.

## Risks

1. **Bundle under-specification risk**
   If `AssistantRuntimeBundle` omits policy or routing fields that are currently hidden inside `openclawBootstrap`, migration will miss business behavior.

2. **Session rebuild risk**
   If Redis state is too thin, crash recovery may require too much Postgres replay and hurt latency.

3. **Provider gateway scope creep**
   If provider logic is not bounded tightly, the gateway can become a second monolith.

4. **Telegram semantic parity risk**
   Group behavior, duplicate update handling, and delivery receipts must be preserved while removing the OpenClaw loop.

5. **Media subsystem regression risk**
   Attachment context and STT are already product-visible and must remain stable during cutover.

6. **Migration contamination risk**
   Transitional feature flags or facades can leak into the final design if cleanup is not explicit.

7. **Capacity planning unknowns**
   Exact production concurrency mix, stream fanout pressure, and provider behavior under `10000+` users still need measurement.

8. **Channel expansion uncertainty**
   `max_ru` is part of the target channel envelope, but its exact delivery contract still needs separate adapter specification.

## Success metrics

The replacement is considered successful only when all of the following are true in production:

### Product and latency

- `web` streaming pre-stream latency `p95 <= 1200ms`
- `web` first-token latency `p95 <= 2500ms`
- base text turns `p95 <= 3s`
- mid-complexity turns `p95 <= 5s`
- heavy but non-sandbox turns `p95 <= 9s`
- Telegram inbound-to-delivered assistant reply `p95 <= 5s` for base text turns

### Scale and correctness

- no single-replica assumption in runtime readiness or session safety
- one logical user turn results in at most one persisted assistant reply
- duplicate Telegram updates are suppressed idempotently
- session lease contention rate remains below `1%` at steady-state
- runtime handles `10000+` active users without local filesystem session ownership

### Architecture cleanliness

- no request-time OpenClaw calls for `web`
- no request-time OpenClaw calls for `telegram`
- no `openclawBootstrap` or `openclawWorkspace` reads in active request paths
- no runtime freshness or provider-secret callbacks from execution path back into the control plane
- no local filesystem authority for sessions, transcripts, attachments, or stream state

### Operational efficiency

- bundle warm cache hit ratio `>= 95%`
- provider fallback rate stays within expected policy envelope and is observable
- attachment stage failures remain below `0.5%`
- STT success rate for supported audio inputs remains above `99%`

## Non-goals for v1

- shipping `max_ru` as a production adapter in the first runtime cut
- preserving OpenClaw request-time compatibility in the final architecture
- generic plugin framework parity
- synchronous sandbox/code execution inside normal chat turns
- long-running autonomous agent workflows
- video generation in the first production contour
- full rearchitecture of every memory/task registry surface before web and Telegram cutover
- retrofitting every historical OpenClaw optimization into the new runtime before first clean production use

## Execution slices

### Slice 1 — Native bundle and execution boundary foundation

**Goal**

Introduce PersAI-native runtime contracts and bundle persistence without changing end-user behavior yet.

**Scope**

- new `AssistantRuntimeBundle`
- runtime contract package
- bundle persistence tables
- boundary-level runtime facade in `apps/api`

**What is included**

- `packages/runtime-contract`
- `packages/runtime-bundle`
- bundle compiler extraction from `materialize-assistant-published-version.service.ts`
- dual-write of native bundle beside legacy materialized fields
- runtime routing feature flag at the API boundary

**What is excluded**

- no user traffic cutover
- no new runtime service execution
- no Telegram adapter changes

**Risks**

- missing fields in bundle schema
- accidental OpenClaw terminology leaking into native bundle

**Validation**

- deterministic bundle hash snapshots
- publish/apply regression tests
- shadow bundle diff against current materialization intent

### Slice 2 — Provider gateway and runtime shell

**Goal**

Stand up the new execution-plane services before they own traffic.

**Scope**

- `apps/provider-gateway`
- `apps/runtime`
- health, readiness, metrics, and warmup endpoints

**What is included**

- provider abstraction for OpenAI and Anthropic
- secret refresh and warm client pools
- runtime service skeleton with bundle warm/invalidate hooks

**What is excluded**

- no production turn execution
- no media cutover
- no Telegram cutover

**Risks**

- gateway abstraction becoming too generic
- incorrect secret rotation assumptions

**Validation**

- provider smoke calls
- warmup/readiness checks
- observability pipeline proving bundle and provider cache state

### Slice 3 — Distributed session/state core and web runtime

**Goal**

Replace web request-time execution first on top of Redis/Postgres state.

**Scope**

- session leases
- idempotency
- stream state
- `createTurn` and `streamTurn`
- web stream ticket or equivalent handoff

**What is included**

- Redis session subsystem
- runtime message persistence contract
- web sync/stream native execution
- web shadow mode, then cutover

**What is excluded**

- Telegram delivery cutover
- sandbox execution
- heavy media generation

**Risks**

- stream replay edge cases
- session lease contention
- partial-output persistence regressions

**Validation**

- shadow compare on content and latency
- duplicate-turn suppression tests
- crash/retry recovery drills

### Slice 4 — Attachment context and STT cutover

**Goal**

Remove media storage and STT dependency on OpenClaw for active channels.

**Scope**

- object-storage stage/fetch/delete
- attachment metadata normalization
- short-audio STT
- attachment context injection

**What is included**

- native attachment stage service
- attachment-bearing web turns
- STT for supported short audio paths
- media quota integration

**What is excluded**

- TTS
- image generation
- video generation

**Risks**

- attachment context mismatch
- object cleanup bugs
- STT latency spikes

**Validation**

- upload/download regression tests
- STT parity checks
- quota and cleanup verification

### Slice 5 — Telegram native adapter and group semantics

**Goal**

Replace the Telegram webhook proxy loop with a PersAI-native adapter over the same runtime core.

**Scope**

- Telegram inbound webhook
- duplicate update claiming
- direct runtime invocation
- outbound delivery
- group chat semantics

**What is included**

- native Telegram adapter
- Telegram text turns on native runtime
- Telegram attachment ingestion over native media subsystem where available
- Telegram group and duplicate-update behavior

**What is excluded**

- `max_ru` adapter
- Telegram voice output/TTS

**Risks**

- group-thread identity mismatches
- delivery retry semantics
- migration of existing bot traffic

**Validation**

- webhook replay tests
- group smoke flows
- live delivery latency and duplicate suppression metrics

### Slice 6 — Async tools, workers, and sandbox separation

**Goal**

Move heavy execution off the ordinary chat path while preserving product capability growth.

**Scope**

- bounded inline tool rules
- async worker queue
- sandbox service
- job polling and artifact return path

**What is included**

- inline bounded tools
- queued heavy tools
- isolated sandbox service contract
- runtime job enqueue/poll interfaces

**What is excluded**

- generic plugin framework parity
- arbitrary synchronous code execution

**Risks**

- operator confusion between inline and async execution
- result-delivery UX gaps

**Validation**

- queue latency measurements
- no regression in ordinary chat latency
- sandbox isolation tests

### Slice 7 — OpenClaw removal and schema cleanup

**Goal**

Remove the old runtime path completely once native execution is primary for active channels.

**Scope**

- delete adapters and controllers
- remove callbacks and legacy env/config
- drop OpenClaw-shaped fields from PersAI schemas

**What is included**

- remove `OpenClawRuntimeAdapter`
- remove Telegram proxy controller
- remove legacy runtime apply/spec callback dependencies
- drop `openclaw*` materialization fields

**What is excluded**

- no preservation shims in final architecture

**Risks**

- dormant references left in admin or lifecycle paths
- forgotten data migration consumers

**Validation**

- repository-wide search returns no active request-path OpenClaw runtime integration
- migrations and cleanup tests pass
- runtime traffic fully served by PersAI-native services

## Step-by-step implementation plan

### Step 1 — Add the ADR and native runtime contract package

**Purpose**

Establish the new system boundary before touching runtime code.

**Files/modules likely affected**

- `docs/ADR/072-persai-native-multichannel-runtime-replacement.md`
- new `packages/runtime-contract/*`

**Dependencies**

- none

**Migration notes**

- no traffic impact
- contract is introduced alongside existing OpenClaw-facing types

**Rollback notes**

- revert the package and ADR; no runtime behavior change

### Step 2 — Introduce `AssistantRuntimeBundle` and bundle persistence

**Purpose**

Replace `openclawBootstrap/openclawWorkspace` as the future runtime artifact.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-materialized-spec.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-materialized-spec.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-materialized-spec.repository.ts`
- `apps/api/prisma/schema.prisma`
- new `packages/runtime-bundle/*`

**Dependencies**

- Step 1

**Migration notes**

- dual-write native bundle beside legacy fields
- do not remove old columns yet
- `runtimeBundle.userContext` plus compiled `promptDocuments` are the future runtime truth for bootstrap/user/persona prompt material; legacy `USER.md` / `BOOTSTRAP.md` files may still be materialized only as temporary OpenClaw tails until Step 17 removes them

**Rollback notes**

- disable native bundle usage and keep legacy materialization only

### Step 3 — Split the fat runtime adapter into a neutral runtime facade

**Purpose**

Stop growing the current OpenClaw-shaped application interface.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- new runtime facade files under `apps/api/src/modules/workspace-management/application/`

**Dependencies**

- Steps 1-2

**Migration notes**

- the facade may route to OpenClaw temporarily at the boundary
- new internal interfaces must remain PersAI-native

**Rollback notes**

- switch facade implementation back to legacy-only routing

### Step 4 — Create `apps/provider-gateway`

**Purpose**

Extract provider behavior from the future runtime hot path into a clean prewarmed service.

**Files/modules likely affected**

- new `apps/provider-gateway/src/main.ts`
- new `apps/provider-gateway/src/modules/providers/*`
- new `apps/provider-gateway/src/modules/catalogs/*`
- possibly shared config modules under `packages/config`

**Dependencies**

- Step 1

**Migration notes**

- start with OpenAI and Anthropic only
- no request traffic cutover yet
- temporary bootstrap catalog/config seam is allowed only inside `apps/provider-gateway` startup config so Step 4 can stand up a real service before PersAI control-plane warm/invalidate wiring exists
- Step 7 must remove that bootstrap-only seam by feeding provider warm/cached state from PersAI control-plane bundle/apply invalidation instead of leaving a second long-term authority

**Rollback notes**

- disable provider gateway deploy; no user-facing path depends on it yet

### Step 5 — Create `apps/runtime` shell with health/readiness/metrics

**Purpose**

Stand up the new runtime service boundary before execution logic lands.

**Files/modules likely affected**

- new `apps/runtime/src/main.ts`
- new `apps/runtime/src/app.module.ts`
- new `apps/runtime/src/modules/platform-core/*`
- new `apps/runtime/src/modules/bundles/*`
- new `apps/runtime/src/modules/observability/*`
- possible shared config modules under `packages/config`

**Dependencies**

- Steps 1 and 4

**Migration notes**

- runtime starts as a dark service
- supports bundle warm and readiness only
- temporary local bundle cache is allowed only inside `apps/runtime`
  - why: Step 5 needs the runtime process boundary before Step 6 distributed state and Step 7 control-plane warm/invalidate wiring exist
  - where: `apps/runtime/src/modules/bundles/*` and `apps/runtime/src/modules/observability/*`
  - removal/upgrade: Step 7 replaces the shell-only cache-warm path with the real control-plane bundle warm/invalidate flow

**Rollback notes**

- disable runtime deployment; no cutover impact yet

### Step 6 — Add Postgres runtime tables and Redis session keys

**Purpose**

Lay down the distributed state model needed for clean multi-user execution.

**Files/modules likely affected**

- `apps/api/prisma/schema.prisma`
- new Prisma migrations
- new runtime persistence modules in `apps/runtime`
- possible shared persistence helpers in `packages/*`

**Dependencies**

- Step 5

**Migration notes**

- add tables for bundles, runtime sessions, compactions, and turn receipts
- `runtime_bundle_states` stores runtime-plane warm/invalidation metadata only; authoritative bundle documents remain in `assistant_materialized_specs.runtime_bundle*`
- `apps/runtime` must own concrete Postgres persistence plus Redis coordination services for this state before Step 6 is considered complete
- Redis key model is additive and does not affect current traffic yet

**Rollback notes**

- keep new tables unused and disable runtime state writes

### Step 7 — Implement bundle warm/invalidate flow

**Purpose**

Move request-time policy assembly out of the hot path.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- new bundle warm services in `apps/runtime`
- provider gateway warmup modules

**Dependencies**

- Steps 2, 4, 5, 6

**Migration notes**

- publishing/apply should warm the native bundle and provider route caches
- temporary explicit activation seams are allowed only while `apps/runtime` and `apps/provider-gateway` remain dark optional services:
  - `PERSAI_RUNTIME_BASE_URL`
  - `PERSAI_PROVIDER_GATEWAY_BASE_URL`
  - both `unset => skip` behaviors must be removed in Step 9
- provider-gateway bootstrap model lists may exist only as startup seed until the first control-plane apply warmup replaces them
- do not yet cut request traffic

**Rollback notes**

- disable warm hooks; existing OpenClaw flow continues

### Step 8 — Implement runtime session resolve, lease, and idempotency

**Purpose**

Make session ordering and replay safety explicit before chat cutover.

**Files/modules likely affected**

- new `apps/runtime/src/modules/sessions/session-store.service.ts`
- new `apps/runtime/src/modules/sessions/session-lease.service.ts`
- new `apps/runtime/src/modules/turns/idempotency.service.ts`

**Dependencies**

- Step 6

**Migration notes**

- no need to map OpenClaw session files into the new system
- rebuild hot state from canonical PersAI records and compaction summaries only

**Rollback notes**

- disable native runtime usage; Redis state can be left unused

### Step 9 — Implement native web `createTurn` and `streamTurn`

**Purpose**

Move web request-time execution to the new runtime core.

**Files/modules likely affected**

- `apps/provider-gateway/src/modules/providers/*`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-inbound-runtime-context.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/*web chat*` services/controllers
- `packages/config/src/runtime-config.ts`
- new `apps/runtime/src/modules/turns/turn-execution.service.ts`
- new `apps/runtime/src/modules/turns/turns.controller.ts`

**Dependencies**

- Steps 4, 5, 6, 7, 8

**Migration notes**

- start with a dark sync text-only `createTurn` sub-step before `streamTurn` and before any live web cutover
- use boundary-level feature flag for shadow mode then primary mode
- the first API sync cutover sub-step may use an explicit boundary flag (initially `PERSAI_NATIVE_RUNTIME_WEB_SYNC_ENABLED`, later replaced in Step 10 by `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE`) to switch authenticated `POST /api/v1/assistant/chat/web` traffic onto native runtime createTurn without silently falling back per request when the native path is selected
- the first API sync cutover sub-step may keep canonical message persistence and replay ownership in `apps/api` while runtime execution itself moves to `apps/runtime`
- the first API stream cutover sub-step may use an explicit boundary flag (initially `PERSAI_NATIVE_RUNTIME_WEB_STREAM_ENABLED`, later replaced in Step 10 by `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE`) to switch authenticated `POST /api/v1/assistant/chat/web/stream` traffic onto native runtime `streamTurn` without silently falling back per request when the native path is selected
- the first API stream cutover sub-step may keep canonical replay/message persistence ownership, SSE event shaping, and partial-output handling in `apps/api` while runtime execution itself moves to `apps/runtime`
- if API-side quota degrade routing already exists, native `createTurn` / `streamTurn` must preserve it explicitly instead of dropping provider/model override semantics at the cutover boundary
- temporary Step 7 API activation seams are still allowed only during the first dark Step 9 sub-step:
  - why: runtime-side native execution can land before the authenticated web API path switches off the still-legacy request path
  - where: `packages/config/src/api-config.ts` (`PERSAI_RUNTIME_BASE_URL`, `PERSAI_PROVIDER_GATEWAY_BASE_URL`) plus the existing Step 7 sync services in `apps/api/src/modules/workspace-management/application/*sync*`
  - removal/upgrade: the later Step 9 API cutover sub-step makes both services mandatory for web and deletes the `unset => skip` behavior
- persist canonical user/assistant messages through existing PersAI ownership

**Rollback notes**

- route web back to OpenClaw at the API boundary only

### Step 10 — Add web shadow comparison and cut over web

**Purpose**

Validate the new runtime with real traffic before making it primary.

**Files/modules likely affected**

- runtime routing config
- web chat orchestration services
- observability and admin dashboards

**Dependencies**

- Step 9

**Migration notes**

- compare quality, latency, stream completeness, quota accounting, and error classes
- the first Step 10 sub-step replaces the Step 9 booleans with explicit API boundary modes:
  - `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=legacy|shadow|native`
  - `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=legacy|shadow|native`
- `shadow` is allowed only as temporary boundary scaffolding:
  - why: validate native web behavior on real traffic before making it the ordinary user-visible path
  - where: `packages/config/src/api-config.ts`, `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`, `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`, and `apps/api/src/modules/workspace-management/application/web-runtime-shadow-comparison.service.ts`
  - removal: later Step 10 cutover sets native as the ordinary web mode and Step 17 deletes the remaining OpenClaw web path entirely
- `shadow` comparison evidence may begin as logs only, but the current bounded operator surface also allows a pod-local Admin Overview read model (`webRuntimeShadowComparisons`) as long as it stays diagnostic-only and does not become a durable telemetry authority
- native web parity also depends on runtime context depth:
  - `apps/runtime` must assemble provider `messages[]` from bundle + canonical state, not only from the newest inbound text
  - for current web turns, the smallest acceptable native hydration is recent canonical web chat history (`assistant_chats` / `assistant_chat_messages`) plus the API-enriched current inbound message
  - this does not transfer ownership of chat records into runtime; runtime reads canonical records for context assembly while API remains the writer/owner of chat history
- `native` must keep the Step 9 no-fallback rule: once a web route is in native mode, missing native runtime config or runtime/provider failure must surface honestly instead of silently falling back to OpenClaw
- Step 10 closeout requires both bounded shadow evidence and one bounded live validation pass after the ordinary web route flips to `native`; that evidence is now recorded for dev, so the next migration step moves to attachment staging rather than more web-text cutover work

**Rollback notes**

- flip the sync/stream web runtime modes back to `legacy`

### Step 11 — Implement native attachment staging

**Purpose**

Remove runtime-owned blob storage from active channels.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/application/media/inbound-media.service.ts`
- `apps/api/src/modules/workspace-management/application/media/media-preprocessor.service.ts`
- new media ingress/storage modules

**Dependencies**

- Steps 4, 5, 6

**Migration notes**

- active web/inbound attachment binaries persist directly in PersAI-owned object storage, and `assistant_chat_message_attachments.storage_path` now stores the PersAI object key
- native web turns now pass raw user text plus object-key attachment refs, and `apps/runtime` hydrates current/historical attachment context from canonical attachment rows instead of relying on workspace paths or API-only prompt glue
- current inbound image attachments on the native web path now download from PersAI object storage inside `apps/runtime` and reach OpenAI/Anthropic as real image input blocks rather than filename/mime-only metadata
- current inbound PDF attachments on the native web path now download from PersAI object storage inside `apps/runtime` and reach OpenAI/Anthropic as real document/file input blocks rather than extraction-only summaries
- canonical attachment preprocessing now extracts usable text from `application/json`, `text/*`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` so document-like files can contribute real content on the native path
- non-PDF document/table formats remain extraction-first by design, not per-turn binary replay, so native attachment handling does not re-expand request payload on every later message
- direct image/PDF provider input is bounded to the current inbound turn and an explicit request-size budget; historical attachments stay summary/extract-only instead of replaying binary payloads into long chat history
- temporary API-side attachment text enrichment now remains only for legacy/shadow primary execution while the Step 10 route seam still exists
- failed staged uploads must roll back their transient empty staging rows so canonical web history never keeps attachment-less placeholder messages that poison later native hydration
- temporary migration seams are allowed only at bounded source boundaries:
  - pre-Step-12 STT scratch/transcription in `manage-chat-media.service.ts` and `media-preprocessor.service.ts`
  - download of legacy runtime-owned tool artifacts in `media-delivery.service.ts` until later native tool slices replace those producers

**Rollback notes**

- revert the PersAI object-storage cutover in code if absolutely necessary; do not introduce a second permanent request-time media authority

### Step 12 — Implement native STT

**Purpose**

Remove transcription dependence on the OpenClaw runtime.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/application/media/media-preprocessor.service.ts`
- new media STT modules in `apps/runtime` or `apps/runtime-workers`
- provider gateway STT interfaces if shared

**Dependencies**

- Steps 4 and 11

**Migration notes**

- short audio may remain synchronous
- long audio should be queued immediately

**Rollback notes**

- revert STT backend routing to the old path temporarily

### Step 13 — Replace Telegram proxy with a native Telegram adapter

**Purpose**

Remove the OpenClaw-owned Telegram runtime loop.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/interface/http/telegram-webhook-proxy.controller.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-inbound-runtime-context.service.ts`
- new `apps/runtime/src/modules/delivery/telegram/*`

**Dependencies**

- Steps 8, 9, 11, 12

**Migration notes**

- claim updates in Redis before runtime work
- normalize Telegram group semantics into the shared channel envelope

**Rollback notes**

- temporarily reroute webhook traffic back to legacy ingress while cutover is active

### Step 14 — Cut over Telegram text and groups

**Purpose**

Make Telegram the second production channel on the new runtime core.

**Files/modules likely affected**

- Telegram adapter modules
- admin/runtime observability modules
- delivery receipt and duplicate update handling modules

**Dependencies**

- Step 13

**Migration notes**

- validate owner, DM, and group flows separately

**Rollback notes**

- webhook routing rollback only; no hidden dual runtime in final architecture

### Step 15 — Introduce bounded inline tools and async worker jobs

**Purpose**

Restore necessary capability without polluting ordinary chat latency.

**Files/modules likely affected**

- new tool runtime modules in `apps/runtime`
- new worker processors in `apps/runtime-workers`
- quota integration services in `apps/api`

**Dependencies**

- Steps 9 and 10

**Migration notes**

- only bounded inline tools enter ordinary chat path
- all heavy tools queue jobs

**Rollback notes**

- disable individual tool classes or queue-backed features without touching chat core

### Step 16 — Build isolated sandbox service

**Purpose**

Move code execution into a separate system with no request-path contamination.

**Files/modules likely affected**

- new `apps/sandbox/*`
- new queue/job contracts
- runtime enqueue/poll endpoints

**Dependencies**

- Step 15

**Migration notes**

- sandbox is opt-in and async only
- ordinary web and Telegram turns must not wait on it by default

**Rollback notes**

- disable sandbox feature gates independently of the runtime core

### Step 17 — Remove OpenClaw runtime integration from PersAI active paths

**Purpose**

Delete the legacy request-time executor once native runtime is primary.

**Files/modules likely affected**

- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/telegram-webhook-proxy.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**Dependencies**

- Steps 10, 12, 14, 15, 16

**Migration notes**

- remove boundary feature flags once rollback window closes

**Rollback notes**

- none after this point beyond repo revert and redeploy

### Step 18 — Remove OpenClaw-shaped schema and document cleanup

**Purpose**

Finish the architectural reset by removing legacy concepts from the repo.

**Files/modules likely affected**

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/workspace-management/domain/assistant-materialized-spec.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-materialized-spec.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-materialized-spec.repository.ts`
- `apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts`
- `apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts`
- runtime-related docs that still describe OpenClaw as final-state executor

**Dependencies**

- Step 17

**Migration notes**

- migrate reads to native bundle fields before dropping legacy columns
- ensure repository-wide search returns no live `openclawBootstrap/openclawWorkspace` request-path use

**Rollback notes**

- only full migration rollback before column drop; after cleanup the new runtime is authoritative

## Cursor session continuity protocol

This section defines how Cursor agents must continue this program across many separate sessions without losing context or drifting away from the target architecture.

Persistent Cursor rule for this program:

- `.cursor/rules/adr072-runtime-continuity.mdc`

### Source-of-truth order for every session

Before any implementation work, the agent must read in this order:

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ADR/072-persai-native-multichannel-runtime-replacement.md`
5. `docs/ARCHITECTURE.md`
6. `docs/API-BOUNDARY.md`
7. `docs/DATA-MODEL.md`
8. `docs/TEST-PLAN.md`
9. any ADRs explicitly referenced by the chosen step
10. only then the relevant code

### Authority rule

- This ADR is the source of truth for the **target architecture** and the **implementation order**.
- `docs/SESSION-HANDOFF.md` is the source of truth for the **last completed checkpoint**, **active slice**, **active step**, and **next recommended step**.
- `docs/CHANGELOG.md` is the source of truth for **what has actually landed in the repo**.
- If these three sources disagree, the agent must stop, surface the conflict, and reconcile docs before continuing implementation.

### Session scope rule

- One Cursor session must take exactly one smallest executable step or one tightly coupled sub-step from the plan.
- The agent must not silently combine unrelated steps.
- The agent must not jump ahead to later slices while earlier dependencies remain unfinished.
- The agent must not add new channels, new runtime concepts, or OpenClaw compatibility layers outside the current step.

### Session start procedure

At the beginning of every session, the agent must:

1. Read the source-of-truth docs in the required order.
2. Inspect the execution ledger in this ADR and the latest entry in `docs/SESSION-HANDOFF.md`.
3. Identify the highest-priority unfinished step whose dependencies are already satisfied.
4. Restate explicitly:
   - current slice
   - current step
   - purpose of the step
   - files/modules likely affected
   - what is out of scope for this session
5. Check the repo for partial work already landed in the same area before editing anything.
6. If the current code suggests a different architectural direction than this ADR, stop and update docs first instead of improvising in code.

### Session execution rule

During implementation, the agent must:

- stay inside the selected step
- keep the final target PersAI-native
- avoid introducing permanent OpenClaw compatibility in new code
- prefer deleting or replacing OpenClaw-shaped concepts instead of wrapping them
- touch native OpenClaw only if the current step explicitly requires it and a PersAI-side change is insufficient
- update docs first if the chosen step changes architecture, API, data model, workflow, or rollout semantics

### Session end procedure

Before ending the session, the agent must:

1. Update `docs/SESSION-HANDOFF.md` with:
   - current active slice
   - current active step
   - what changed
   - why changed
   - files touched
   - tests run
   - risks
   - next recommended step
   - ready commit message
2. Update `docs/CHANGELOG.md` if architectural or shipped repo truth changed.
3. Update this ADR if the implementation plan, scope boundaries, or target architecture changed.
4. Update the execution tracking ledger below.
5. Explicitly mark the next step so the following Cursor session can continue without re-planning.

### Anti-drift rules

The agent must refuse to do the following unless the ADR is deliberately amended first:

- invent a second target architecture
- preserve OpenClaw request-time execution in the final state
- keep `openclawBootstrap` / `openclawWorkspace` as long-term runtime truth
- reintroduce filesystem session ownership
- put sandbox or generic heavy agent boot into ordinary chat hot path
- treat `web` and `telegram` as separate runtime kernels instead of channel adapters

## Execution tracking ledger

### Status vocabulary

Use only these statuses:

- `planned`
- `in_progress`
- `blocked`
- `completed`

### Current program baseline

| Item | Status | Notes |
|---|---|---|
| ADR-072 document | completed | Target architecture, slices, and step order are documented |
| Runtime replacement implementation | in_progress | Steps 1-11 are complete. Step 11 now closes with PersAI-owned attachment lifecycle, rollback-safe staging, current-turn image/PDF provider input under an explicit request-size budget, and extraction-first canonical text for non-PDF document formats without binary history replay. Step 12 STT cutover, Telegram native cutover, native tool producers, and later temporary-route cleanup remain follow-up work |
| Current active slice | in_progress | `Slice 4 — Attachment context and STT cutover` remains active because Step 12 STT cutover is still pending after Step 11 attachment staging closed |
| Current active step | planned | `Step 12 — Implement native STT` is the next active step now that Step 11 attachment staging is closed |

### Slice ledger

| Slice | Status | Exit criteria |
|---|---|---|
| Slice 1 — Native bundle and execution boundary foundation | completed | Native runtime contracts, `AssistantRuntimeBundle` persistence, and the neutral runtime facade now land beside legacy materialization |
| Slice 2 — Provider gateway and runtime shell | completed | `apps/provider-gateway` and `apps/runtime` now exist with warmup/bundle shells plus health, readiness, and metrics |
| Slice 3 — Distributed session/state core and web runtime | completed | Web request-time text execution now runs through native runtime on Redis/Postgres session state, with Step 10 closed after bounded shadow evidence plus live native cutover validation in dev |
| Slice 4 — Attachment context and STT cutover | in_progress | Attachment staging is now complete: persistence lives in PersAI-owned object storage, current-turn images/PDFs can reach providers as real model input under a bounded request-size budget, and document-like files persist richer canonical extracts. STT cutover still remains |
| Slice 5 — Telegram native adapter and group semantics | planned | Telegram ingress and delivery run through a native adapter over the shared runtime core |
| Slice 6 — Async tools, workers, and sandbox separation | planned | Heavy tools and sandbox are isolated from ordinary chat latency |
| Slice 7 — OpenClaw removal and schema cleanup | planned | OpenClaw request-time path and `openclaw*` runtime artifacts are removed from PersAI |

### Step ledger

| Step | Status | Dependencies | Completion note |
|---|---|---|---|
| Step 1 — Add the ADR and native runtime contract package | completed | none | `packages/runtime-contract` now exports the first PersAI-native runtime tier, conversation, bundle-ref, media, session, turn, and health contracts |
| Step 2 — Introduce `AssistantRuntimeBundle` and bundle persistence | completed | Step 1 | `packages/runtime-bundle` now compiles a deterministic native bundle and `assistant_materialized_specs` dual-writes `runtime_bundle*` beside legacy OpenClaw materialization |
| Step 3 — Split the fat runtime adapter into a neutral runtime facade | completed | Steps 1-2 | `apps/api` now depends on `AssistantRuntimeFacade` while `OpenClawRuntimeBridge` traps legacy payload translation at the migration boundary |
| Step 4 — Create `apps/provider-gateway` | completed | Step 1 | `apps/provider-gateway` now exists as a dark internal service with OpenAI/Anthropic provider modules plus health, readiness, metrics, catalog, and warmup seams |
| Step 5 — Create `apps/runtime` shell with health/readiness/metrics | completed | Steps 1, 4 | `apps/runtime` now exists as a dark internal service with health, readiness, metrics, observability counters, and bounded native bundle warm/invalidate seams while execution remains disabled |
| Step 6 — Add Postgres runtime tables and Redis session keys | completed | Step 5 | Postgres runtime bundle/session/compaction/turn-receipt tables now exist, and `apps/runtime` owns concrete Prisma-backed persistence services plus Redis coordination services for conversation/session/receipt/bundle markers without changing active request-time execution yet |
| Step 7 — Implement bundle warm/invalidate flow | completed | Steps 2, 4, 5, 6 | `apps/runtime` warm/invalidate endpoints now persist bundle-state metadata and Redis bundle markers with shared-state-first ordering and compensation around later local-cache mutation; `apps/api` apply/reapply invokes assistant-wide invalidate + current-bundle warm through a temporary explicit runtime-base-url boundary and also pushes provider-gateway warmup/catalog replacement through a temporary explicit provider-gateway-base-url boundary, so apply/materialization is now the real Step 7 control-plane warm trigger while both activation seams remain explicitly queued for Step 9 removal |
| Step 8 — Implement runtime session resolve, lease, and idempotency | completed | Step 6 | `apps/runtime` now has `SessionStoreService`, `SessionLeaseService`, `IdempotencyService`, `TurnAcceptanceService`, `TurnFinalizationService`, and `TurnLeaseHeartbeatService` over `runtime_sessions`, Redis conversation-session pointers/lease keys, in-flight accepted-turn claims, and `runtime_turn_receipts`, so session ordering and replay safety are explicit before web cutover |
| Step 9 — Implement native web `createTurn` and `streamTurn` | completed | Steps 4, 5, 6, 7, 8 | `apps/provider-gateway` now exposes both `generate-text` and `stream-text`, `apps/runtime` now exposes native `createTurn` and `streamTurn`, and `apps/api` delivered the first honest native web execution surfaces before Step 10 replaced the boolean cutover flags with route modes. Both native web paths already passed bounded dev-GKE live validation, including replay/idempotency checks and stream disconnect persistence |
| Step 10 — Add web shadow comparison and cut over web | completed | Step 9 | `apps/api` now uses temporary `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE` / `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE` values (`legacy|shadow|native`) so shadow mode can collect bounded comparison evidence, Admin Overview exposes bounded recent shadow samples per API pod, `apps/runtime` hydrates recent canonical web chat history into provider `messages[]`, and the OpenAI provider path now accepts assistant history correctly. The ordinary dev web route has been switched to `native` and validated on live chat traffic, so Step 10 is complete for the current web text path while temporary route-mode cleanup remains later follow-up work |
| Step 11 — Implement native attachment staging | completed | Steps 4, 5, 6 | Active web/inbound attachment persistence now writes to PersAI-owned object storage, cleanup paths delete PersAI media objects, failed staged uploads roll back their transient empty rows, direct uploads also persist canonical preview/transcription metadata plus Office/text-style extracts, and native web turns now hydrate current/historical attachment context from canonical attachment rows plus object-key refs while sending current inbound images/PDFs as real provider input only for the current turn under a bounded request-size budget. Historical attachments intentionally stay summary/extract-only so binary payload does not replay through long chat history |
| Step 12 — Implement native STT | planned | Steps 4, 11 | STT no longer depends on OpenClaw |
| Step 13 — Replace Telegram proxy with a native Telegram adapter | planned | Steps 8, 9, 11, 12 | Telegram ingress no longer loops through OpenClaw |
| Step 14 — Cut over Telegram text and groups | planned | Step 13 | Telegram request-time execution is native |
| Step 15 — Introduce bounded inline tools and async worker jobs | planned | Steps 9-10 | Tool execution is cleanly separated by latency class |
| Step 16 — Build isolated sandbox service | planned | Step 15 | Sandbox exists outside ordinary chat path |
| Step 17 — Remove OpenClaw runtime integration from PersAI active paths | planned | Steps 10, 12, 14, 15, 16 | Legacy active request-time runtime path is deleted |
| Step 18 — Remove OpenClaw-shaped schema and document cleanup | planned | Step 17 | Final architectural cleanup is complete |

## Universal Cursor master prompt

Use the following prompt at the start of every new Cursor session for this program.

```text
You are continuing the PersAI-native runtime replacement program in this repository.

Your source of truth is:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/072-persai-native-multichannel-runtime-replacement.md
5. docs/ARCHITECTURE.md
6. docs/API-BOUNDARY.md
7. docs/DATA-MODEL.md
8. docs/TEST-PLAN.md
9. any ADRs referenced by the chosen step

Mission:
- Continue the implementation of ADR-072 to completion.
- Final architecture must be fully PersAI-native.
- Do not preserve OpenClaw compatibility in the final state.
- Migration scaffolding is allowed only at the temporary cutover boundary.

Strict operating rules:
- One session = one smallest executable step or tightly coupled sub-step from ADR-072.
- Do not expand scope.
- Do not skip dependencies.
- Do not invent a new architecture.
- Do not keep OpenClaw-shaped concepts in new target-state code.
- Do not touch native OpenClaw unless the current step explicitly requires it and a PersAI-side change is insufficient.
- If docs, ADR, and code disagree, stop and reconcile docs first.

Required workflow:
1. Read the source-of-truth docs in order.
2. Inspect the execution ledger in ADR-072 and the latest checkpoint in docs/SESSION-HANDOFF.md.
3. Choose the highest-priority unfinished step whose dependencies are satisfied.
4. Before editing, state explicitly:
   - current slice
   - current step
   - purpose
   - files/modules likely affected
   - what is out of scope
5. Implement only that step.
6. Run the relevant verification for the touched files/modules.
7. Before finishing:
   - update docs/SESSION-HANDOFF.md
   - update docs/CHANGELOG.md if repo truth changed
   - update ADR-072 if architecture or plan changed
   - update the execution ledger in ADR-072
8. End with:
   - what changed
   - why changed
   - files touched
   - tests run
   - risks
   - next recommended step
   - ready commit message

Current execution target:
- If no step is marked in progress, start from the highest-priority planned step in ADR-072 whose dependencies are met.
- Stay aligned with the final target: PersAI-native multi-channel runtime, Redis/Postgres/object-storage state, provider gateway, isolated workers, isolated sandbox, and channel adapters for web/telegram/max_ru.
```
