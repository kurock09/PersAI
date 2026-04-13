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

11. **Admin and setup surfaces follow native runtime truth**
    Operator and user-facing editors, previews, and lifecycle actions must read/write PersAI-native bundle source fields. OpenClaw-style file labels such as `SOUL.md`, `USER.md`, `IDENTITY.md`, and `TOOLS.md` may survive only as temporary migration labels inside control-plane compilation, not as the final product contract.

## Target architecture

#### 1. PersAI control plane

**Responsibilities**

- assistant publication and apply lifecycle
- governance, plan, quota, and abuse policy
- canonical chats/messages/attachments metadata
- runtime bundle compilation and registry
- admin provider/runtime settings
- admin prompt template editor and assistant lifecycle control surfaces
- rollout flags and runtime routing policy
- audit and operator control surfaces

**Non-responsibilities**

- provider SDK calls
- token streaming
- session leases
- Telegram delivery retries
- media binary transforms
- sandbox execution
- workspace-owned bootstrap markdown files as long-term admin/runtime source of truth

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

#### 9. Tool model and usage policy

The PersAI-native runtime uses three explicit tool classes:

- **System tools**
  Always-available platform capabilities that are part of the runtime contract rather than plan upsell. Examples: shared context summarization/compaction, runtime quota/status inspection, attachment/context helpers, and other bounded platform-owned execution helpers.
- **Plan tools**
  Product capabilities enabled or disabled by plan/admin policy. Examples: `web_search`, `web_fetch`, future knowledge-layer tools such as `knowledge_search` / `knowledge_fetch`, external API tools, `tts`, `image_generate`, `image_edit`, and `video_generate`.
- **Sandbox tools**
  High-risk workspace/code/file/system operations such as `read_file`, `write_file`, `edit_file`, `exec`, `shell`, and similar filesystem/process tools. These are not ordinary runtime tools and land only behind the isolated sandbox boundary in Step 16.

Bounded durable-memory write helpers are separate from read-side knowledge access. If the model is later allowed to persist cross-session human memory, it must do so through an explicit PersAI-owned tool/validator path rather than by treating an ordinary assistant reply, session summary, or compaction artifact as an implicit write.

Current OpenClaw tool behavior may be studied as a reference for useful product semantics, but it must not define the target architecture, naming, or runtime ownership model.

Every tool exposed to the model must carry explicit PersAI-owned usage policy in the bundle/runtime contract:

- invocation mode: `inline` | `worker` | `sandbox`
- usage rule: `required` | `allowed` | `forbidden`
- trigger policy: when the model must use the tool, may use it, or must not use it
- sync vs async behavior
- timeout budget
- quota/audit policy
- confirmation rules for risky actions
- provider support, when relevant
- failure behavior and fallback behavior

The model must not infer tool policy heuristically. Tool usage policy must be explicit in the runtime bundle/system policy, and runtime enforcement must validate it on every call.

Tool planning must keep four different concerns separate:

- **Current inventory baseline**
  Preserve the real current catalog/UI/runtime surface so migration does not silently delete existing product capabilities.
- **Canonical runtime contract**
  Define the long-term PersAI-native executor families and names the runtime is built around.
- **Migration aliases**
  Preserve only truly transitional names when a future family is remapped. In the current ADR-072 plan, `web_search` and `web_fetch` are first-class product-facing tool names, not aliases. Future read-side knowledge names such as `memory_search` and `memory_get` may become aliases only when a real PersAI-native human-memory/knowledge layer exists. Durable memory writes must stay explicit helpers rather than hidden aliases or answer-side effects.
- **Implementation order**
  Decide what lands next. Implementation order must not redefine the target contract.

These layers must not be conflated. A preserved catalog name is not permission to create a separate executor family, and a canonical target contract is not permission to expose a tool before a real native executor exists.

Every steady-state model-visible tool must be backed by a real PersAI-native executor, runtime policy gate, quota/audit behavior, and honest result contract on the native path. Dark transport validation is allowed, but prompt-only, placeholder, or OpenClaw-backed tool exposure is not acceptable steady-state behavior.

Derived prompt artifacts such as `TOOLS.md` are operator/model guidance only. They are never the source of truth; the source of truth lives in PersAI control-plane data compiled into `AssistantRuntimeBundle`.

Step 15 must treat OpenClaw as a read-only semantic reference only. If a capability is not executable inside PersAI-native runtime or worker ownership, it is not ready.

Shared context summarization/compaction is a first-class system capability, not a channel-only special case:

- the user may explicitly ask the model to compress/summarize context
- Telegram keeps an owner-facing `auto summarize` setting
- web keeps a compaction/summarization banner when rolling turn latency exceeds `7s` or the runtime context pressure threshold is crossed

Web retrieval is a first-class separate plan-tool family in the ADR-072 program:

- `web_search` remains an explicit product-facing tool
- `web_fetch` remains an explicit product-facing tool
- both must be implemented through PersAI-native executors with separate provider/API seams rather than hidden behind a placeholder knowledge layer
- `web_search` keeps the current provider seam family such as `Brave`, `Tavily`, `Perplexity`, and `Google (Gemini)`
- `web_fetch` keeps the current fetch/crawl seam such as `Firecrawl`
- `browser` remains a different tool family from both `web_search` and `web_fetch`
- bounded low-latency retrieval may stay inline; slower or heavier fetch paths may move to workers

Future human memory and knowledge access remain part of the ADR-072 target architecture, but they are not activated on the native runtime path until real PersAI-native memory/knowledge sources exist:

- `knowledge_search` and `knowledge_fetch` remain planned future unified read-contract names inside ADR-072
- `RAG` is a future retrieval/use pattern over that later knowledge layer
- future read namespaces may include cross-session human memory, assistant-user-private transcript knowledge indexed from canonical chats across sessions, assistant/preset/subscription knowledge, assistant-user workspace knowledge, PersAI-global product knowledge, relational databases, vector indexes, document stores, or other internal knowledge systems
- durable human-memory writes belong to that future layer only through an explicit bounded write helper plus validator/audit path; they must not happen as hidden side effects of normal assistant text
- `memory_search` / `memory_get` belong to that future read layer only when a real PersAI-native backend exists and may later become compatibility aliases instead of separate executor families
- the shared memory/knowledge layer must stay reference-first and token-budgeted: `knowledge_search` returns lightweight hits/references, `knowledge_fetch` returns bounded excerpts/windows, and ordinary turns must not auto-inject full corpora or full prior chats by default
- workspace/sandbox files may feed later ingestion/index jobs, but live sandbox filesystem/process access remains Step 16 and must not be smuggled into `knowledge_*`
- do not expose or depend on a native `knowledge_*` family during current Step 15 execution until the program first lands a real PersAI-native memory/knowledge backend

Media generation/editing tools must be provider-agnostic:

- `image_generate`, `image_edit`, `video_generate`, and related tools are exposed through the provider gateway/tool runtime, not hardcoded to one provider
- the first target providers may include `OpenAI` and `Google Gemini`, with later providers added through the same PersAI-owned contract

Current tool inventory baseline must not be skipped before Step 15 implementation. The current PersAI control-plane truth already contains the following tool surface:

- **Plan-managed, cost-driving**
  - `web_search`
  - `web_fetch`
  - `image_generate`
  - `tts`
  - `browser`
- **Plan-managed, utility**
  - `memory_search`
  - `memory_get`
  - `scheduled_action`
- **Platform-managed**
  - `persai_workspace_attach`
  - `persai_tool_quota_status`
- **Hidden internal**
  - `cron`

This baseline is already reflected in current PersAI control-plane/UI/runtime truth:

- tool catalog seed and policy class source:
  - `apps/api/prisma/tool-catalog-data.ts`
- catalog persistence and plan-activation read model:
  - `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-tool-catalog.repository.ts`
  - `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- tool credential/admin source:
  - `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`
  - `apps/api/src/modules/workspace-management/application/manage-admin-tool-credentials.service.ts`
- reminder/control-plane bridge:
  - `apps/api/src/modules/workspace-management/application/control-internal-scheduled-action.service.ts`
  - `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- runtime materialization and prompt projection:
  - `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- admin plan UI grouping:
  - `apps/web/app/admin/plans/page.tsx`
- runtime security matrix:
  - `apps/api/src/modules/workspace-management/application/runtime-tier-security-policy.ts`

Current provider/credential seams that must be preserved in the new tool runtime:

- `web_search`
  - current provider options: `Tavily`, `Brave`, `Perplexity`, `Google (Gemini)`
- `web_fetch`
  - current credential seam: `Firecrawl`
- `browser`
  - current credential seam: `tool_browser` (`Browserless`)
- `image_generate`
  - current image-generation credential seam already exists in PersAI control plane
- `tts`
  - current provider options: `OpenAI`, `ElevenLabs`, `Yandex SpeechKit`
- `memory_search`
  - current embeddings credential seam already exists in PersAI control plane

Current catalog/UI/runtime parity map for `T15-0`:

- This map preserves the current product/control-plane surface, not the legacy executor ownership. Step 15 may re-implement these capabilities natively, but it may not silently delete or rename them without an explicit product/control-plane decision.

| Current tool               | Current catalog/UI/runtime truth                                                                                                                                             | Required Step 15 parity landing                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`               | `plan_managed`, cost-driving, visible in the plan editor; credential seam `tool_web_search` with current provider options `Tavily`, `Brave`, `Perplexity`, `Google (Gemini)` | Preserve inside `T15-3b` as a separate web-retrieval plan tool with its own PersAI-native executor and provider routing; it must not be hidden behind `knowledge_search` during ADR-072                                                                                                                                                                                                                                   |
| `web_fetch`                | `plan_managed`, cost-driving, visible in the plan editor; credential seam `tool_web_fetch` (`Firecrawl`)                                                                     | Preserve inside `T15-3b` as a separate web-fetch/crawl plan tool with its own PersAI-native executor and provider routing; it must not be hidden behind `knowledge_fetch` during ADR-072                                                                                                                                                                                                                                  |
| `browser`                  | `plan_managed`, cost-driving, visible in the plan editor; credential seam `tool_browser` (`Browserless`)                                                                     | Preserve as a separate plan-managed web-interaction capability in `T15-4`; the control plane, native bundle, and later worker executor must keep `browser` explicit instead of folding it into retrieval/search or exposing `Browserless` as the user/model-facing contract. Use the existing plan tool activation + `dailyCallLimit` surface for enable/disable and quotas; do not invent browser-specific plan controls |
| `image_generate`           | `plan_managed`, cost-driving, visible in the plan editor; credential seam `tool_image_generate`                                                                              | Preserve as the Step 15 media-generation plan tool in `T15-6`; later `image_edit` / `video_generate` additions are additive, not replacements for today's image-generation capability                                                                                                                                                                                                                                     |
| `tts`                      | `plan_managed`, cost-driving, visible in the plan editor; credential seam `tool_tts` with current provider options `OpenAI`, `ElevenLabs`, `Yandex SpeechKit`                | Preserve as the explicit Step 15 `tts` plan tool in `T15-6`; `Step 15a` channel voice output does not replace tool-driven TTS semantics                                                                                                                                                                                                                                                                                   |
| `memory_search`            | `plan_managed`, utility, visible in the plan editor; credential seam `tool_memory_search`                                                                                    | Preserve in `T15-0` inventory truth and later remap its read semantics into `T15-6b` as part of the unified PersAI-native knowledge layer; until then, do not expose it on the active native runtime path                                                                                                                                                                                                                 |
| `memory_get`               | `plan_managed`, utility, visible in the plan editor; no separate credential seam today                                                                                       | Preserve in `T15-0` inventory truth and later remap its read semantics into `T15-6b` as part of the unified PersAI-native knowledge layer; until then, do not expose it on the active native runtime path                                                                                                                                                                                                                 |
| `scheduled_action`         | `plan_managed`, utility, visible in the plan editor; current product-facing reminder/task tool with explicit `audience=user                                                  | assistant` semantics over the PersAI-owned control plane                                                                                                                                                                                                                                                                                                                                                                  | Preserve in `T15-5`; keep `audience="user"` as the user-visible reminder surface, add hidden `audience="assistant"` background actions, and keep raw scheduler triggers such as `cron` out of the product/model surface |
| `persai_workspace_attach`  | `platform_managed`, utility, read-only in plan surfaces; projected into the native runtime bundle `toolPolicies` / `TOOLS.md` as a platform-owned helper                     | Preserve as an always-on Step 15 system tool in `T15-3a/T15-7`; it is not a plan toggle and it is not part of the generic Step 16 sandbox file/process matrix                                                                                                                                                                                                                                                             |
| `persai_tool_quota_status` | `platform_managed`, utility, read-only in plan surfaces; projected into the native runtime bundle `toolPolicies` / `TOOLS.md` as the live quota-status helper                | Preserve as an always-on Step 15 system tool in `T15-3a/T15-7`; the model/runtime must continue to treat live quota inspection as platform-owned rather than a plan-managed upsell tool                                                                                                                                                                                                                                   |
| `cron`                     | `hidden_internal`, utility, not visible in the plan editor and intentionally suppressed from user-visible `TOOLS.md`; currently backs reminder/internal callback flows only  | Keep hidden-internal only in the current inventory baseline; `T15-5` must remap the legacy cron callback behavior onto PersAI-native hidden scheduler/worker triggers and must not re-expose raw `cron` as a user/model-facing plan tool                                                                                                                                                                                  |

Step 15 must begin by preserving and remapping this existing product/control-plane tool surface into the PersAI-native tool runtime. It must not silently drop existing tools already present in the catalog, plan editor, or user-facing runtime behavior.

#### 10. Admin prompt and lifecycle surfaces

**Responsibilities**

- PersAI-native prompt template editor for runtime system-prompt material
- operator visibility into which prompt sections compile into runtime `promptDocuments`
- separate ownership of first-turn/bootstrap greeting material if that behavior remains product-visible
- setup preview, create, publish, reapply, reset, and recreate flows over the same bundle compiler and preview/apply path
- admin visibility into plan/tool exposure text that reaches the model

**Non-responsibilities**

- editing raw OpenClaw workspace files or bootstrap documents as the long-term product contract
- hidden prompt logic that affects runtime behavior without a control-plane API/UI owner
- direct runtime session mutation from admin UI

**Sync/async role**

- sync for template CRUD, setup preview, and lifecycle confirmations
- async for bulk reapply, warmup, and operator-triggered regeneration jobs

**Scaling model**

- stateless admin/setup surfaces backed by control-plane APIs

**Data ownership**

- prompt template sources
- lifecycle intents and confirmations
- preview artifacts and audit history

**Current migration baseline that must not be skipped**

- current admin preset editor:
  - `apps/web/app/admin/presets/page.tsx`
- current preset CRUD service:
  - `apps/api/src/modules/workspace-management/application/manage-bootstrap-presets.service.ts`
- current preset defaults:
  - `apps/api/prisma/bootstrap-preset-data.ts`
- current materialization loader:
  - `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- current editable preset ids:
  - `soul`, `user`, `identity`, `agents`, `tools`
- current non-admin-owned prompt sections:
  - `heartbeat` and `bootstrap` are still generated in code today
- current setup/create flow:
  - `postOnboarding -> POST /assistant -> PATCH /assistant/draft -> POST /assistant/setup/preview -> POST /assistant/publish`
- current recreate/reset/reapply surfaces:
  - `apps/web/app/app/_components/assistant-settings.tsx`
  - `apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.ts`
  - `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts`
  - `apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts`
  - `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`

**Target-state rules**

- final admin/setup UX must stop exposing OpenClaw bootstrap-document mental models as the product contract
- every prompt section that actually reaches runtime turn execution must have explicit control-plane ownership and previewability
- create/publish/reapply/reset/recreate must compile from the same PersAI-native bundle and prompt-template pipeline
- destructive recreate/reset UX must explicitly describe what state is deleted and must not rely on OpenClaw workspace-file semantics

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

9. **Admin/runtime UX drift risk**
   If admin/setup surfaces continue to expose legacy bootstrap-document concepts while runtime execution moves to native bundle/prompt truth, operators will not understand what create, preview, publish, reapply, reset, and recreate actually do.

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
- no admin or setup surface requires OpenClaw bootstrap-document terminology as final-state runtime contract
- setup preview, publish, reapply, reset, and recreate all use the same native bundle compilation path

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

### Slice 6 — Tools, control-plane UX, and sandbox separation

**Goal**

Move heavy execution off the ordinary chat path while aligning operator/user surfaces to native runtime truth.

**Scope**

- bounded inline tool rules
- async worker queue
- sandbox service
- job polling and artifact return path
- system tools, plan tools, and sandbox tools split
- admin prompt/lifecycle surface cleanup

**What is included**

- inline bounded system tools
- queued heavy plan tools
- shared summarization/compaction capability
- search/RAG and future knowledge-access tools
- media generation/editing tool runtime
- native prompt-template/system-prompt editor
- setup preview, publish, reapply, and reset/recreate lifecycle cleanup
- isolated sandbox service contract
- runtime job enqueue/poll interfaces

**What is excluded**

- generic plugin framework parity
- arbitrary synchronous code execution
- keeping Telegram-only or OpenClaw-shaped tool behavior as final architecture

**Risks**

- operator confusion between inline and async execution
- result-delivery UX gaps
- prompt/admin surfaces lagging behind runtime truth

**Validation**

- queue latency measurements
- no regression in ordinary chat latency
- sandbox isolation tests
- prompt preview vs publish/reapply parity checks

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
- the current `Bootstrap Document Presets` page is migration scaffolding only; final admin ownership must move to PersAI-native prompt/lifecycle surfaces before OpenClaw removal

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

**Completion notes (2026-04-12)**

- `apps/api` now streams STT audio directly to `apps/runtime` `POST /api/v1/media/transcribe` through `NativeMediaTranscriptionService`; `ManageChatMediaService` and `MediaPreprocessorService` no longer depend on OpenClaw request-time transcription or workspace-media staging
- `apps/runtime` now exposes a bounded native media-transcription module and forwards multipart audio to `apps/provider-gateway`
- `apps/provider-gateway` now exposes `POST /api/v1/providers/transcribe-audio` and executes OpenAI `gpt-4o-mini-transcribe` directly
- the legacy `AssistantRuntimeFacade` no longer carries dead OpenClaw STT/upload/delete media tails; only the bounded legacy download seam for older runtime-owned tool artifacts remains
- web TTS streaming is not part of Step 12; this step closes STT cutover only

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

- `apps/api` now owns assistant-scoped Telegram webhook verification, owner-only gate decisions, group membership sync, inbound Bot API file download, canonical transcript persistence, and outbound Bot API delivery
- legacy PersAI internal Telegram ingress/callback endpoints were removed once the public API-side adapter took ownership
- claim updates in Redis before runtime work
- normalize Telegram group semantics into the shared channel envelope
- Step 14 now removes the remaining legacy execution seam inside `HandleInternalTelegramTurnService`

**Rollback notes**

- temporarily reroute webhook traffic back to legacy ingress while cutover is active

### Step 14 — Cut over Telegram text and groups

**Purpose**

Make Telegram the second production text channel on the new runtime core.

**Files/modules likely affected**

- Telegram adapter modules
- admin/runtime observability modules
- delivery receipt and duplicate update handling modules

**Dependencies**

- Step 13

**Migration notes**

- validate owner, DM, and group flows separately
- keep Telegram as a thin adapter over shared runtime turn execution and canonical history hydration
- do not preserve a Telegram-only `/compact` or hint path; shared compaction UX/tooling is deferred to Step 15

**Completion notes (2026-04-12)**

- Telegram direct/group request-time execution now runs through native `apps/runtime` turns with shared `RuntimeConversationAddress` identity and canonical-history hydration.
- Live dev Telegram validation confirmed the native text/group path works through the public API-side webhook adapter.
- The temporary Telegram-only `/compact` command and compaction-hint seam were removed instead of being carried into the target architecture.
- Dev live testing exposed overly aggressive peer slowdown defaults for one Telegram chat/thread, so dev values now raise the peer slowdown/block thresholds and shorten slowdown duration while keeping abuse protection enabled.

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

- Step 15 defines the PersAI-native tool runtime for **system tools** and **plan tools**
- Step 15 starts with the existing current-tool inventory baseline from PersAI control-plane/UI truth; do not invent a new tool list before preserving and remapping the current one
- only bounded inline tools enter ordinary chat path
- all heavy tools queue jobs
- sandbox tools are explicitly excluded from Step 15 and land only in Step 16
- models must receive explicit tool usage policy; do not rely on heuristic tool discovery or prompt folklore
- shared compaction capability belongs here as a runtime/tool surface for user-invoked and automatic flows; do not reintroduce channel-specific slash-command compaction before this step
- existing useful OpenClaw tool behavior may be referenced only to preserve product semantics; do not copy OpenClaw ownership or shape into the new runtime
- Step 15 order is strict: `T15-0 -> T15-1 -> T15-2 -> T15-3a -> T15-3b -> T15-4 -> T15-5 -> T15-6 -> T15-6b -> T15-7`
- `web_search` and `web_fetch` are explicit first-class Step 15 plan tools with separate PersAI-native executors and provider/API seams
- `knowledge_search` / `knowledge_fetch` plus bounded durable human-memory writes land in `T15-6b` only once real PersAI-native memory/knowledge backends exist; until then they must stay disconnected from the active native runtime path
- `memory_search` / `memory_get` remain tracked in `T15-0` inventory truth, but they later map into the `T15-6b` read layer and do not justify exposing a fake native knowledge executor family early
- `browser` remains a separate plan-managed family and must not be folded into search/fetch
- workspace/sandbox files may feed ingestion or snapshot jobs for `T15-6b`, but live filesystem/process access remains Step 16 and must not be smuggled into `knowledge_*`
- `T15-6b` is not retrieval-only; it must also land the minimal PersAI-owned storage, upload/list/delete/status/reindex, and quota/accounting surface required to make user knowledge sources real inside ADR-072, while richer file-manager polish may follow later
- `T15-6b` must treat prior-chat search as a first-class assistant-user-private source through the same `knowledge_search` / `knowledge_fetch` layer rather than through ad hoc prompt scanning of raw transcripts
- the current fixed hydrated-history cap in `turn-context-hydration` is temporary implementation debt/guardrail, not the target ordinary prod context policy once `T15-6b` lands
- ordinary prod turns should prefer validated shared compaction reuse, human memory, namespaced knowledge, and policy-aware hydration before any blunt fixed-count trimming
- shared memory/knowledge must stay token-budgeted: only bounded hot memory/open loops may auto-hydrate into ordinary turns, while transcript/document recall stays reference-first and on-demand through bounded `knowledge_fetch`
- any future forced lightweight prompt mode must stay an explicit admin/operator override that is off by default, audit-visible, and never the silent normal prod path; exposure/admin treatment belongs to `T15-7` and `Step 15b`
- `T15-3a` owns shared tool transport, executor gating, stream honesty, lease safety, and remaining always-on system helpers for all future Step 15 tools; do not bury these concerns inside one tool family
- if current code/doc truth ever exposes a tool before its PersAI-native executor exists, treat that as temporary implementation debt to fix before continuing with later slices

**Rollback notes**

- disable individual tool classes or queue-backed features without touching chat core

#### Step 15 tool slices

##### Tool slice T15-0 — Current tool inventory baseline

- **Goal**
  Freeze the actual current PersAI tool surface before redesigning Step 15 execution, so the new runtime does not silently lose tools that already exist in the catalog, admin plan UI, or product behavior.
- **Included**
  - current catalog inventory from `apps/api/prisma/tool-catalog-data.ts`
  - current policy classes: `plan_managed`, `platform_managed`, `hidden_internal`
  - current admin plan UI grouping and visibility model
  - current provider/credential seams for provider-backed tools
  - explicit parity map from current tool names into the future PersAI-native tool runtime
- **Excluded**
  - sandbox/file/process tools beyond recording their current separation expectations
  - final implementation of the new runtime tool executor
- **Validation**
  - catalog/UI/runtime inventory parity document exists in ADR-072
  - no Step 15 implementation starts until the current-tool baseline is explicit
  - future tool slices reference the preserved baseline instead of inventing a new surface

##### Tool slice T15-1 — Tool taxonomy and usage policy baseline

- **Goal**
  Define the PersAI-owned tool model so the runtime and the model both know exactly how tools are meant to be used.
- **Included**
  - `system tools` vs `plan tools` taxonomy
  - `sandbox tools` explicitly excluded to Step 16
  - tool policy contract in bundle/runtime metadata
  - `required | allowed | forbidden` invocation rules
  - `inline | worker | sandbox` execution modes
- **Excluded**
  - sandbox/file/process tools
  - UI cleanup
- **Validation**
  - bundle/runtime contract tests
  - prompt/runtime policy parity tests
  - no tool call proceeds without explicit policy metadata

##### Tool slice T15-2 — Shared summarization and compaction tools

- **Goal**
  Replace channel-specific compaction behavior with one shared PersAI-native capability.
- **Included**
  - shared `summarize_context` / `compact_context` system capability
  - user-requested compaction path, starting with the stable web manual compact API surface
  - Telegram owner setting for `auto summarize`
  - native runtime session-state reads for web compaction/banner state without reviving the old OpenClaw web session-state seam
  - web banner that suggests context compression when rolling turn latency exceeds `7s` or context pressure crosses threshold
  - durable summary/compaction state updates in runtime/session metadata
  - explicit shared-compaction trigger semantics for user-invoked vs automatic runtime calls
  - reusable durable-state validation and poisoned-row read guards instead of trusting arbitrary model text
  - first contract baseline is a typed `runtime.sharedCompaction` bundle block sourced from the existing admin compaction policy plus Telegram owner config, carrying the fixed shared tool names and cross-channel threshold knobs before executor wiring lands
  - first dark native runtime seam may execute shared compaction through `apps/runtime` `POST /api/v1/turns/compact`, resolving the warmed bundle from current session state instead of reintroducing channel-specific runtime APIs
- **Excluded**
  - Telegram-only slash-command ownership in the final architecture
  - sandbox-assisted summarization
- **Validation**
  - runtime-bundle contract and warm-validation tests for `runtime.sharedCompaction`
  - dark runtime compaction endpoint tests for bundle/session resolution plus `runtime_session_compactions` persistence
  - public web manual compaction keeps the existing assistant API contract while routing through native `POST /api/v1/turns/compact`
  - public web compaction state/banner reads keep the existing assistant API contract while routing through native runtime session-state truth
  - web/Telegram parity tests
  - latency-triggered banner tests
  - session summary reuse on later turns
  - manual in-turn durable `compact_context` must not trigger a redundant post-turn auto-compaction in the same logical turn
  - reusable durable state must be accepted only from a validated machine-summary shape; invalid/legacy rows must be ignored safely on later-turn hydration
  - same-turn follow-up after durable compaction must rebuild provider messages from refreshed compaction state rather than stale pre-compaction history
- **Completion notes (2026-04-12)**
  - dev rollout and live validation confirmed the shared compaction path on both web and Telegram after the final `T15-2` package landed
  - the one observed "double OpenAI request" during Telegram validation was traced to the internal shared-compaction provider call from the previously applied bundle, not a duplicate Telegram update
  - compaction threshold/policy changes only affect live runtime behavior after `reapply`, because `apps/runtime` executes against applied/materialized bundle truth rather than draft admin edits
  - shared compaction durable state now uses validated `persai.runtimeSessionCompaction.v2` payloads on the happy path, and old/bad rows are ignored on reuse instead of poisoning later turns
  - same-turn durable compaction now suppresses redundant auto-compaction follow-up and clears stale token freshness after compaction rather than trusting pre-compaction token counts
  - shared compaction provider calls now keep output bounded and perform one retry when the first structured response fails validation, so sporadic provider-side JSON/schema misses can recover without persisting poisoned state or reviving channel-specific fallback seams

##### Tool slice T15-3a — Shared native tool runtime hardening and system helpers

- **Goal**
  Stabilize one PersAI-native machine-readable tool runtime before additional plan-tool families land, and finish the remaining always-on system helpers on top of that shared runtime.
- **Included**
  - shared tool transport contract (`tools`, `toolChoice`, `toolHistory`, tool calls, tool results) owned by the PersAI runtime/provider boundary
  - bundle-derived projection from `toolPolicies`, `runtime.sharedCompaction`, and later native runtime config blocks
  - executor-availability gating: no ordinary model-visible tool without a real PersAI-native executor
  - honest sync/stream behavior for tool-capable turns; never pseudo-stream while hidden buffered tool work is still running
  - lease-safe in-turn tool execution and durable post-tool state updates
  - structured tool result/audit envelopes reusable by later tool families
  - explicit provider/runtime request classification for main turns, tool-loop follow-ups, and compaction-only internal requests
  - remaining always-on system helpers such as `persai_workspace_attach` and `persai_tool_quota_status`; if they are not truly executable yet, they stay gated off the ordinary model-visible path and their later exposure/admin treatment moves to `T15-7`
  - `TOOLS.md` and similar artifacts as derived guidance only, never the source of truth
- **Excluded**
  - new knowledge-source executors
  - browser automation
  - reminder/scheduled-action implementation
  - media generation/editing implementation
  - sandbox tools
- **Validation**
  - runtime refuses to project a model-visible tool unless native policy and executor availability both agree
  - tool-capable sync/stream tests prove honest behavior and lease safety
  - system helpers are either backed by PersAI-owned executors or remain non-model-visible until those executors exist
  - prompt/runtime parity tests confirm derived guidance matches bundle truth
  - provider/runtime observability distinguishes `main_turn`, `tool_loop_followup`, `manual_compaction`, and `auto_compaction` instead of making internal runtime hops look like user turns

##### Tool slice T15-3b — Web search and fetch plan tools

- **Goal**
  Restore the current web-retrieval product surface as explicit PersAI-native plan tools, without routing it through a fake or premature knowledge layer.
- **Included**
  - `web_search`
  - `web_fetch`
  - PersAI-native provider/API executors for both tools
  - current provider seams for `web_search`: `Brave`, `Tavily`, `Perplexity`, `Google (Gemini)`
  - current provider seam for `web_fetch`: `Firecrawl`
  - the first truthful `T15-3b` sub-step may land `web_fetch` before `web_search`, because the single `Firecrawl` seam exercises the runtime/provider/API credential and quota plumbing without inventing a fake knowledge layer or skipping later search-provider parity
  - after `web_fetch`, the first bounded `web_search` sub-step may land `Tavily` first because `tool_web_search` defaults to `tavily` in the control plane and it is the smallest provider-backed search seam; the current follow-through then closes provider-selection parity for `Brave`, `Perplexity`, and `Google (Gemini)` on the shared native `query` / `count` contract before bounded live validation
  - normalized result contracts, attribution, quotas, and audit behavior for separate search vs fetch semantics
  - bounded inline use where latency budgets allow, with worker offload for slower/heavier fetch paths
- **Excluded**
  - transport/gating redesign already owned by `T15-3a`
  - interactive `browser` automation; it remains a separate plan-managed tool family
  - `knowledge_search` / `knowledge_fetch`
  - `memory_search` / `memory_get`
  - sandbox file search
  - one-off provider-specific search hacks outside the explicit provider routing surface
- **Validation**
  - provider/credential parity tests for `web_search` and `web_fetch`
  - deterministic result-contract tests for separate search vs fetch behavior
  - no user/model-visible web retrieval path depends on `knowledge_*` placeholders
  - the runtime may expose `web_fetch` before `web_search` only when the projected tool has a real native executor plus live credential/quota enforcement; once `web_search` parity is landed, all current control-plane providers may stay model-visible while unknown provider ids still stay dark
  - inline vs async routing tests where fetch work crosses latency budgets
  - quota/audit coverage for both tools

##### Tool slice T15-4 — Browser and web-interaction plan tools

- **Goal**
  Preserve the current browsing capability as an explicit plan-managed family with a PersAI-owned browser contract instead of smuggling interactive web actions into `web_search` / `web_fetch`.
- **Included**
  - `browser` as a separate plan-managed capability
  - first sub-step lands a shared native `runtime.workerTools` contract/bundle baseline for current worker-class tools so `browser`, future media generation/editing, and later scheduler-backed plan tools do not each invent separate async metadata
  - the initial worker baseline covers the then-current worker-policy surface (`browser`, `image_generate`, `tts`, hidden internal `cron`) with explicit family/outcome/timeout/confirmation/provider-routing/failure metadata before any one executor family is reactivated; `T15-5` later extends that shared worker layer to `scheduled_action`
  - a real PersAI control-plane credential seam for `browser` (`tool_browser` / `Browserless`) so admin Tool Credentials, materialization, and runtime bundle truth can carry browser provider selection and secret references without routing through legacy-only seams
  - a typed native `runtime.browser` bundle contract with canonical tool code, credential tool code, provider ids, a bounded `snapshot | act` action surface, and confirmation-required action metadata
  - a PersAI-owned browser executor contract whose backend seam may use `Browserless` or another remote-browser service without becoming the user/model-facing surface
  - a real native browser executor path through `apps/runtime -> apps/provider-gateway -> Browserless` so `browser` becomes model-visible only when worker policy, credential, and provider support all agree
  - browser exposure and quota behavior compile from the same existing plan/tariff tool activation fields already used by other plan-managed tools (`effectiveActivation` / `dailyCallLimit -> toolPolicies`); no browser-only quota or toggle surface is introduced
  - bounded stateless browser sessions that can either inspect rendered pages (`snapshot`) or perform explicit browser operations (`act`) before returning a fresh structured page snapshot
  - navigation/page interaction contract distinct from `web_search` / `web_fetch`
  - worker isolation whenever interaction latency or side effects exceed bounded inline rules
  - explicit audit/confirmation rules for higher-risk actions, with `act` remaining the only confirmation-tagged action in the current bounded surface
- **Excluded**
  - folding browser into retrieval/search or the future knowledge layer
  - exposing `Browserless` or any other backend as the tool contract
  - fake tab/profile/session-management APIs that the current Browserless-backed stateless executor does not actually provide
  - sandbox file/process permissions
- **Validation**
  - native runtime bundle contract tests for `runtime.workerTools`
  - native runtime bundle contract tests for `runtime.browser`
  - admin Tool Credentials state/materialization tests prove `tool_browser` reaches `toolCredentialRefs.browser` with the `Browserless` provider seam instead of stopping at UI-only metadata
  - warm validation rejects worker-tool entries that reference unknown/non-worker policies or omit current worker-class policy coverage
  - warm validation rejects invalid browser provider/action/credential drift in `runtime.browser`
  - provider-gateway browser executor tests cover Browserless request normalization, secret resolution, structured page snapshots, and upstream failure handling
  - runtime browser projection/execution tests cover exposure gating, provider routing, quota enforcement, worker timeout propagation, and structured tool-history results
  - backend-seam swap/adapter tests that keep the `browser` contract stable
  - tool-history/audit coverage
  - clear runtime/model distinction between browser interaction and retrieval

##### Tool slice T15-5 — Reminder and scheduled action plan tools

- **Goal**
  Rebuild the current reminder/task product surface on PersAI-native scheduler/worker ownership without carrying forward raw legacy cron mechanics or re-exposing hidden scheduler triggers.
- **Included**
  - `scheduled_action`
  - first sub-step remaps `scheduled_action` onto the shared `runtime.workerTools` contract as the `scheduled_action` family
  - next sub-step projects and executes the product-facing `scheduled_action` surface (`create`, `list`, `pause`, `resume`, `cancel`) through the native runtime tool loop via PersAI internal task registry/control seams rather than exposing raw scheduler triggers
  - the canonical create contract now uses `audience="user" | "assistant"`; `audience="assistant"` adds `actionType` and `actionPayload` for hidden background actions
  - assistant-side background actions may quietly update state or create a second `scheduled_action` with `audience="user"` when a user-visible follow-up is genuinely helpful, but they may not directly push user-visible text
  - the UI keeps ordinary user reminders in the main tasks panel while assistant-side actions render in a separate subdued panel
  - next sub-step extracts reminder delivery/fanout into a shared PersAI-owned delivery core so the current legacy callback path and the future native scheduler can reuse one delivery boundary
  - final sub-step replaces hidden legacy due-time pickup with a PersAI-owned scheduler loop over durable scheduled-action rows, a global rollout-resettable scheduler epoch, expiring claims, and retry state while reusing the shared delivery core
  - PersAI-owned task registry, due-time pickup, and scheduling/job orchestration
  - current reminder semantics preserved as the product-facing surface
  - hidden internal scheduler/worker triggers kept internal-only
- **Excluded**
  - exposing raw scheduler triggers, including legacy `cron`, as model/user-facing tools
  - designing a reminder-only degraded context mode; reminder-triggered turns must later reuse the same ordinary context policy that lands in `T15-6b`
  - browser/media work
- **Validation**
  - tool-policy/materialization tests prove `scheduled_action` now compiles as a worker `scheduled_action` while hidden internal `cron` remains separate internal scheduler machinery
  - native runtime tests prove `scheduled_action` now projects and executes through the shared tool loop with structured create/list/pause results for both `audience="user"` and `audience="assistant"`
  - API tests prove user-visible creates can still persist Telegram target routing through clean `conversationContext` input without regressing to raw scheduler exposure
  - API/scheduler tests prove assistant-side background actions wake the native runtime on a hidden path, cannot directly create user-visible chat output, and may create a second `audience="user"` scheduled action when follow-up delivery is appropriate
  - reminder callback tests prove delivery/fanout now goes through the shared reminder delivery core while replay safety and task-registry sync still hold on the legacy trigger adapter
  - scheduling/execution tests prove new scheduled actions persist durable native schedule/payload state, due work is claimed by the hidden PersAI scheduler loop, and recurring actions compute the next slot without legacy cron jobs
  - idempotent job delivery and retry behavior stay rollout-safe through a global scheduler epoch reset on startup/rollout, expiring claims, replay-safe delivery completion, and defer-on-failure retry state
  - internal scheduler/worker seams stay hidden from plan/model surfaces

##### Tool slice T15-6 — Media generation and editing plan tools

- **Goal**
  Restore product-critical media tools through PersAI-owned contracts rather than runtime-specific plugins.
- **Included**
  - `tts` as a tool capability where product semantics require explicit tool invocation
  - `image_generate`
  - `image_edit`
  - `video_generate`
  - provider-agnostic routing through the provider gateway
  - first providers may include `OpenAI` and `Google Gemini`
- **Excluded**
  - synchronous heavy video generation in ordinary chat
  - direct provider-specific plugin ownership
  - human memory and namespaced knowledge-source activation (lands in `T15-6b`)
- **Validation**
  - provider routing/fallback tests
  - queue/worker latency tests
  - quota/audit coverage per media tool

##### Tool slice T15-6b — Human memory and namespaced knowledge sources

- **Goal**
  Land PersAI-native cross-session human memory and namespaced knowledge sources so assistants can remember users between sessions and answer against private/shared corpora without confusing session context, durable human memory, product knowledge, or Step 16 sandbox access, and so ordinary prod turns stop depending on a blunt fixed-count history slice as their primary context strategy. This slice also lands the minimal PersAI-owned storage/ingest/status surface needed to make uploaded knowledge sources real inside ADR-072 rather than deferring all file/source management until later. The resulting layer must be one shared recall plane for facts, prior chats, and uploaded knowledge, but remain reference-first and token-budgeted so it does not dump whole corpora into ordinary prompts.
- **Included**
  - structured cross-session human memory per `assistantId + userId` for durable facts, preferences, and open loops rather than raw transcript blobs
  - an explicit bounded durable-memory write helper (for example `memory_write`) so the agent decides what to store through a tool call plus validator/audit path instead of hidden answer-side effects
  - unified read tools `knowledge_search` and `knowledge_fetch`
  - searchable assistant-user-private transcript knowledge built from canonical chat records across sessions, so requests such as "search my chats" resolve through the same native knowledge layer instead of heuristic prompt scans
  - namespaced knowledge sources for assistant/preset/subscription shared knowledge, assistant-user-private workspace knowledge built from PersAI-owned uploads or later sandbox snapshots, and PersAI-global product knowledge
  - canonical PersAI-owned storage for knowledge source files/documents plus metadata/provenance rows; sandbox may contribute later snapshots but is not the primary storage authority for uploaded knowledge files
  - one shared PersAI memory/knowledge retrieval plane across durable human-memory facts, searchable prior chats, uploaded knowledge, and shared product corpora instead of separate prompt hacks per source
  - PersAI-managed ingestion/index pipelines with versioning, citations, and source provenance
  - minimal native web/API surfaces to upload, list, delete, inspect status, inspect usage, and trigger bounded reindex for knowledge sources so the user has a real product surface for their assistant knowledge base during ADR-072
  - distinct quota/accounting for knowledge-source storage that does not piggyback on chat media upload counters or Step 16 workspace/sandbox storage limits
  - `knowledge_search` returns lightweight hits/references (namespace, source identifiers, snippet/score, and chat/message/chunk refs when the source is prior chats) while `knowledge_fetch` returns bounded source excerpts or surrounding-context windows rather than whole transcripts/documents
  - compatibility remapping for current inventory `memory_search` / `memory_get` semantics into the unified read layer once the real backends exist
  - policy-controlled runtime auto-hydration of hot memory/open loops where it reduces tool spam without hiding heavier retrieval and without exceeding explicit per-turn token budgets
  - ordinary prod context assembly built from validated shared compaction, human memory, namespaced knowledge, and policy-aware hydration instead of a fixed message-count slice as the main behavior
  - keeping the current fixed hydrated-message cap only as a bounded fallback/guardrail after richer context assembly has run, rather than as the default prompt-building policy
  - future reminder-triggered turns reusing the same ordinary context policy as interactive turns instead of inventing a separate worker-only prompt mode
- **Excluded**
  - treating `summarize_context` / `compact_context` as long-term human memory
  - copying full prior chats/transcript corpora into durable human memory just to make them searchable
  - treating sandbox as the canonical storage location for user knowledge files
  - direct live reads from sandbox filesystem/process state or direct code/file execution; Step 16 owns that boundary
  - folding `web_search` / `web_fetch` into the internal knowledge layer
  - raw storage/vector/document vendor APIs as model-facing tool contracts
  - unvalidated freeform memory writes from ordinary assistant messages
  - auto-injecting full prior chats, full uploaded documents, or full shared-memory dumps into ordinary turns by default
  - deferring every user-visible knowledge-source upload/list/status action until after ADR-072
  - desktop-grade file-manager polish such as folders, tags, bulk curation, or marketplace merchandising as a prerequisite for the first honest landing
  - turning a forced lightweight prompt mode into the default prod behavior
- **Validation**
  - strict namespace isolation across assistant/preset/subscription shared knowledge, assistant-user-private knowledge, and PersAI-global knowledge
  - memory-write policy/validation/audit tests
  - retrieval citation/provenance tests for `knowledge_search` / `knowledge_fetch`
  - prior-chat transcript search tests prove `knowledge_search` can find canonical cross-session chat hits and `knowledge_fetch` returns bounded surrounding context by reference instead of replaying full transcripts
  - ingestion/reindex tests from workspace/sandbox uploads into indexed knowledge without requiring Step 16 file/process access during ordinary turns
  - upload/list/delete/status/reindex flows preserve namespace isolation, provenance, and replay-safe quota/accounting updates for knowledge-source files
  - knowledge-source storage accounting stays distinct from chat media upload accounting and Step 16 workspace/sandbox storage accounting
  - token-budget tests prove only bounded hot memory/open loops auto-hydrate into ordinary turns while heavier transcript/document recall remains tool-driven through `knowledge_fetch`
  - bad-row/schema guards for durable memory and knowledge payloads
  - replay/idempotency tests for durable memory writes
  - ordinary interactive turns and reminder-triggered turns both use the same context-assembly policy unless an explicit admin/operator override says otherwise
  - the fixed hydrated-history cap is no longer the primary prod context strategy once richer memory/knowledge hydration is available

##### Tool slice T15-7 — Plan/admin exposure, quotas, and model guidance

- **Goal**
  Make tool exposure predictable for operators, users, and the model after the executor families are real.
- **Included**
  - `system tools` always-on policy
  - future user/model/admin exposure of always-on helpers that stayed dark in `T15-3a` until real PersAI-native executors existed
  - `plan tools` enabled/disabled by plan/admin policy
  - per-tool quotas and audit rules
  - user/model-facing descriptions of what each tool is for
  - channel/runtime rules for which tools are legal in which contexts
  - admin `Tools` surface owns operator-facing exposure/configuration for always-on system tools such as shared compaction; assistant-scoped Telegram `auto summarize` remains in Telegram settings rather than being replaced by a global admin toggle
  - minimal admin/user-facing usage and management surfaces for knowledge sources after `T15-6b` lands its real storage/index backends: upload/list/delete/status/reindex plus clear usage/limit visibility
  - distinct operator/user visibility for chat media upload quotas, knowledge-source storage quotas, and workspace/sandbox storage quotas instead of one opaque storage bucket
  - admin/operator-only forced lightweight prompt mode as an explicit degraded override for testing, emergency cost/latency control, or diagnostics after the normal `T15-6b` context policy exists
  - audit-visible context-mode exposure so operators can see when turns ran under forced lightweight prompt rules
- **Excluded**
  - final admin/UI dead-tail cleanup (handled in Step 15b)
  - sandbox permissions matrix
  - forcing users to manage knowledge sources only through hidden backend flows or chat-only prompt magic once the native knowledge layer exists
  - collapsing media upload, knowledge-source storage, and workspace/sandbox storage quotas into one opaque metric
  - user-facing or plan-facing lightweight-mode toggles
  - silently auto-enabling forced lightweight prompt mode in ordinary prod traffic
- **Validation**
  - plan/admin exposure tests
  - quota enforcement tests
  - user/admin surfaces show native usage, limits, and source/index status from PersAI quota/accounting truth rather than inferred UI-only state
  - prompt/runtime alignment checks so the model does not hallucinate unavailable tools
  - forced lightweight prompt mode stays off by default, admin/operator-only, and visible in audit/runtime trace outputs when active

#### Deferred activation within ADR-072 — Future knowledge access layer

### Step 15a — Native web TTS streaming/output

**Purpose**

Deliver real web voice output as a PersAI-native channel capability rather than a post-turn attachment-only fallback.

**Files/modules likely affected**

- `apps/runtime/src/modules/turns/*`
- new runtime voice-output modules in `apps/runtime`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- web chat audio playback / streaming UI modules in `apps/web`
- provider gateway TTS interfaces if shared

**Dependencies**

- Steps 9, 10, and 15

**Migration notes**

- web TTS is a channel output capability on the native web turn path, not merely a persisted attachment after turn completion
- live web voice output must not depend on post-turn attachment persistence to feel complete
- persisted audio attachments may remain optional archival or replay artifacts, but they are not the primary contract for native web voice output
- the model may still use explicit `tts` tools where product semantics require tool-driven audio generation, but ordinary web voice playback remains owned by the channel/output layer
- Step 15a is not the whole TTS tool program; it covers native web voice output as a channel capability while explicit `tts` tool semantics stay under Step 15 tool slices
- keep text-only web turn behavior healthy when voice output is disabled or unavailable

**Rollback notes**

- disable web voice-output streaming independently of text turn execution
- fall back to text-only response rather than a hidden attachment-only substitute

### Step 15b — Replace bootstrap preset and lifecycle UI with native prompt surfaces

**Purpose**

Move admin/setup UX onto the PersAI-native prompt and lifecycle model before final OpenClaw removal.

**Files/modules likely affected**

- `apps/web/app/admin/presets/page.tsx`
- `apps/web/app/admin/layout.tsx`
- `apps/api/src/modules/workspace-management/application/manage-bootstrap-presets.service.ts`
- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/web/app/app/setup/page.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.ts`
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- new admin/control-plane prompt editor modules under `apps/api/src/modules/workspace-management/application/` and `interface/http/`

**Dependencies**

- Steps 2, 7, 15

**Migration notes**

- replace `Bootstrap Document Presets` with a PersAI-native prompt template editor; old file labels may survive only as temporary migration labels during transition
- the system-prompt editor must cover every prompt section that actually reaches runtime turn execution; do not leave hidden prompt behavior outside admin ownership
- first-turn/bootstrap greeting behavior, if retained, must be separated from ordinary system-prompt editing so operators understand what affects runtime turns vs onboarding/recreate flow
- setup preview, create, publish, reapply, reset, and recreate must compile through the same bundle/prompt-template pipeline
- destructive reset/recreate UX must state which state is deleted: chats, memory, tasks, published versions, materialized bundles/specs, and media artifacts
- if forced lightweight prompt mode exists after `T15-7`, expose it only in admin/operator UX with clear warning text, current-state indication, and explanation that ordinary prod execution should rely on compaction/memory/knowledge rather than blunt context trimming
- do not preserve OpenClaw workspace-file semantics as the user-facing explanation of these lifecycle actions

**Rollback notes**

- temporarily keep the legacy preset UI label while continuing to compile the native prompt templates underneath
- runtime execution remains native even if the admin surface rollback is needed

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
- sandbox tools live here, not in Step 15:
  - `read_file`
  - `write_file`
  - `edit_file`
  - `exec`
  - `shell`
  - related filesystem/process tools
- sandbox tools require separate permissions, limits, audit, and isolation policy from ordinary runtime tools

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

- Steps 10, 12, 14, 15, 15b, 16

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

| Item                               | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-072 document                   | completed   | Target architecture, slices, and step order are documented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Runtime replacement implementation | in_progress | Steps 1-14 are complete. PersAI now owns Telegram webhook ingress/delivery, group/chat metadata sync, canonical Telegram transcript persistence, and native request-time text/group execution. Step 15 is now active with `T15-0`, `T15-1`, `T15-2`, `T15-3a`, `T15-3b`, `T15-4`, and `T15-5` complete; `T15-5` closes with the full native scheduled-action stack: shared compaction now has a typed native bundle contract, dark native runtime seams, public web manual/state/banner routing on native truth, Telegram auto summarize through the same runtime-owned compaction service, rolling-latency web banner signaling, later-turn summary reuse, validated `persai.runtimeSessionCompaction.v2` durable-state semantics with bad-row read guards, a hardened shared tool runtime that exposes only real compaction tools, real native web retrieval executors, a shared `runtime.workerTools` block for the current worker-policy surface, a real Browserless-backed native browser path with `tool_browser`, typed `runtime.browser`, provider-gateway browser execution, runtime worker-tool projection/execution for the bounded `snapshot` + `act` browser contract, a real native `scheduled_action` projection/executor seam over the existing PersAI task registry/control-plane APIs, explicit `audience="user"                                                                                                                                                                                                        | "assistant"`semantics with assistant-side`actionType`/`actionPayload`, a shared PersAI-owned reminder delivery core, a hidden assistant-action runtime path, and a PersAI-owned scheduler loop that claims due scheduled-action rows from durable task state with a global rollout-resettable scheduler epoch, expiring claims, and retry-safe behavior instead of creating legacy cron jobs for new reminders. Native `web_search` now honors the full current control-plane provider set (`Tavily`, `Brave`, `Perplexity`, `Google (Gemini)`), native `web_fetch`executes through the Firecrawl seam when its credential is configured, and focused runtime/provider-gateway tests now cover the native browser path as well. Hidden internal`cron`remains internal-only and legacy-callback-compatible for older rows, while the current tasks UI now separates muted assistant-side actions from user-facing reminders.`persai_workspace_attach`/`persai_tool_quota_status`remain intentionally dark until later`T15-7`exposure/executor follow-through, and the next queued Step 15 family is`T15-6 — Media generation and editing plan tools` |
| Current active slice               | in_progress | `Slice 6 — Tools, control-plane UX, and sandbox separation` is now the next active migration area after Step 14 closeout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Current active step                | in_progress | `Step 15 — Introduce bounded inline tools and async worker jobs` remains active; `T15-0`, `T15-1`, `T15-2`, `T15-3a — Shared native tool runtime hardening and system helpers`, `T15-3b — Web search and fetch plan tools`, `T15-4 — Browser and web-interaction plan tools`, and `T15-5 — Reminder and scheduled action plan tools` are now complete, and the next queued tool family is `T15-6 — Media generation and editing plan tools`. `scheduled_action` now compiles as a worker `scheduled_action`, executes on the native tool loop through PersAI internal task registry/control endpoints, persists native schedule/payload state directly in PersAI task rows, supports both `audience="user"` reminders and hidden `audience="assistant"` background actions with `actionType` / `actionPayload`, and due work is now claimed/executed by a PersAI-owned scheduler loop with a global rollout-resettable scheduler epoch, expiring claims, and retry delay instead of hidden legacy cron jobs. Hidden internal `cron` remains internal-only only as compatibility machinery for old callback rows during rollout, while the active tasks UI now keeps assistant-side actions in a separate subdued panel instead of mixing them into the ordinary reminder list. Bounded live validation plus the post-validation assistant follow-up retry/prompt hardening now close `T15-5` honestly. `persai_workspace_attach` / `persai_tool_quota_status` stay non-model-visible until later `T15-7` exposure/executor follow-through |

### Slice ledger

| Slice                                                     | Status      | Exit criteria                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slice 1 — Native bundle and execution boundary foundation | completed   | Native runtime contracts, `AssistantRuntimeBundle` persistence, and the neutral runtime facade now land beside legacy materialization                                                                                         |
| Slice 2 — Provider gateway and runtime shell              | completed   | `apps/provider-gateway` and `apps/runtime` now exist with warmup/bundle shells plus health, readiness, and metrics                                                                                                            |
| Slice 3 — Distributed session/state core and web runtime  | completed   | Web request-time text execution now runs through native runtime on Redis/Postgres session state, with Step 10 closed after bounded shadow evidence plus live native cutover validation in dev                                 |
| Slice 4 — Attachment context and STT cutover              | completed   | Attachment staging now lives in PersAI-owned object storage with bounded current-turn multimodal input, richer canonical extracts, and native STT routed through `apps/runtime` / `apps/provider-gateway` instead of OpenClaw |
| Slice 5 — Telegram native adapter and group semantics     | completed   | Telegram ingress/delivery and native Telegram request-time text/group execution now run through PersAI over the shared runtime core                                                                                           |
| Slice 6 — Tools, control-plane UX, and sandbox separation | in_progress | Heavy tools and sandbox are isolated from ordinary chat latency, and admin/setup surfaces align to native prompt/runtime truth                                                                                                |
| Slice 7 — OpenClaw removal and schema cleanup             | planned     | OpenClaw request-time path and `openclaw*` runtime artifacts are removed from PersAI                                                                                                                                          |

### Step ledger

| Step                                                                             | Status      | Dependencies                  | Completion note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 — Add the ADR and native runtime contract package                         | completed   | none                          | `packages/runtime-contract` now exports the first PersAI-native runtime tier, conversation, bundle-ref, media, session, turn, and health contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Step 2 — Introduce `AssistantRuntimeBundle` and bundle persistence               | completed   | Step 1                        | `packages/runtime-bundle` now compiles a deterministic native bundle and `assistant_materialized_specs` dual-writes `runtime_bundle*` beside legacy OpenClaw materialization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Step 3 — Split the fat runtime adapter into a neutral runtime facade             | completed   | Steps 1-2                     | `apps/api` now depends on `AssistantRuntimeFacade` while `OpenClawRuntimeBridge` traps legacy payload translation at the migration boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Step 4 — Create `apps/provider-gateway`                                          | completed   | Step 1                        | `apps/provider-gateway` now exists as a dark internal service with OpenAI/Anthropic provider modules plus health, readiness, metrics, catalog, and warmup seams                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Step 5 — Create `apps/runtime` shell with health/readiness/metrics               | completed   | Steps 1, 4                    | `apps/runtime` now exists as a dark internal service with health, readiness, metrics, observability counters, and bounded native bundle warm/invalidate seams while execution remains disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Step 6 — Add Postgres runtime tables and Redis session keys                      | completed   | Step 5                        | Postgres runtime bundle/session/compaction/turn-receipt tables now exist, and `apps/runtime` owns concrete Prisma-backed persistence services plus Redis coordination services for conversation/session/receipt/bundle markers without changing active request-time execution yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Step 7 — Implement bundle warm/invalidate flow                                   | completed   | Steps 2, 4, 5, 6              | `apps/runtime` warm/invalidate endpoints now persist bundle-state metadata and Redis bundle markers with shared-state-first ordering and compensation around later local-cache mutation; `apps/api` apply/reapply invokes assistant-wide invalidate + current-bundle warm through a temporary explicit runtime-base-url boundary and also pushes provider-gateway warmup/catalog replacement through a temporary explicit provider-gateway-base-url boundary, so apply/materialization is now the real Step 7 control-plane warm trigger while both activation seams remain explicitly queued for Step 9 removal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Step 8 — Implement runtime session resolve, lease, and idempotency               | completed   | Step 6                        | `apps/runtime` now has `SessionStoreService`, `SessionLeaseService`, `IdempotencyService`, `TurnAcceptanceService`, `TurnFinalizationService`, and `TurnLeaseHeartbeatService` over `runtime_sessions`, Redis conversation-session pointers/lease keys, in-flight accepted-turn claims, and `runtime_turn_receipts`, so session ordering and replay safety are explicit before web cutover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Step 9 — Implement native web `createTurn` and `streamTurn`                      | completed   | Steps 4, 5, 6, 7, 8           | `apps/provider-gateway` now exposes both `generate-text` and `stream-text`, `apps/runtime` now exposes native `createTurn` and `streamTurn`, and `apps/api` delivered the first honest native web execution surfaces before Step 10 replaced the boolean cutover flags with route modes. Both native web paths already passed bounded dev-GKE live validation, including replay/idempotency checks and stream disconnect persistence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Step 10 — Add web shadow comparison and cut over web                             | completed   | Step 9                        | `apps/api` now uses temporary `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE` / `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE` values (`legacy`, `shadow`, `native`) so shadow mode can collect bounded comparison evidence, Admin Overview exposes bounded recent shadow samples per API pod, `apps/runtime` hydrates recent canonical web chat history into provider `messages[]`, and the OpenAI provider path now accepts assistant history correctly. The ordinary dev web route has been switched to `native` and validated on live chat traffic, so Step 10 is complete for the current web text path while temporary route-mode cleanup remains later follow-up work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Step 11 — Implement native attachment staging                                    | completed   | Steps 4, 5, 6                 | Active web/inbound attachment persistence now writes to PersAI-owned object storage, cleanup paths delete PersAI media objects, failed staged uploads roll back their transient empty rows, direct uploads also persist canonical preview/transcription metadata plus Office/text-style extracts, and native web turns now hydrate current/historical attachment context from canonical attachment rows plus object-key refs while sending current inbound images/PDFs as real provider input only for the current turn under a bounded request-size budget. Historical attachments intentionally stay summary/extract-only so binary payload does not replay through long chat history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Step 12 — Implement native STT                                                   | completed   | Steps 4, 11                   | Voice/media transcription now streams audio through `apps/api -> apps/runtime -> apps/provider-gateway -> OpenAI` without OpenClaw request-time transcription or workspace-media staging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Step 13 — Replace Telegram proxy with a native Telegram adapter                  | completed   | Steps 8, 9, 11, 12            | Public Telegram webhook ingress, owner gate handling, group/chat metadata sync, Bot API media download/delivery, and canonical transcript persistence now run in `apps/api`; the old PersAI internal Telegram ingress/callback endpoints were removed with the proxy loop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Step 14 — Cut over Telegram text and groups                                      | completed   | Step 13                       | Telegram text/group request-time execution now routes through native `apps/runtime` with shared conversation identity/history hydration, live dev Telegram validation passed, and the temporary Telegram-only `/compact`/hint seam was removed instead of being carried forward                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Step 15 — Introduce bounded inline tools and async worker jobs                   | in_progress | Steps 9-10                    | `T15-0` now freezes the current catalog/UI/runtime tool surface, `T15-1` adds explicit native `toolPolicies` metadata for `system`, `plan`, and `internal` tools plus `allowed` / `forbidden` usage and `inline`, `worker`, and `sandbox` execution modes, `T15-2` completes the typed `runtime.sharedCompaction` contract plus native compaction/session-resolve seams and caller cutovers with validated durable-state reuse and bad-row guards, `T15-3a` closes the shared runtime hardening pass, `T15-3b` is complete with real native web retrieval, `T15-4` is complete with the first real native browser path, and `T15-5` is now complete with the scheduled-action worker-contract baseline, the real native `scheduled_action` executor seam, a shared PersAI-owned reminder delivery core for user-facing reminder fanout, a hidden assistant-action runtime path for `audience="assistant"` actions, and a PersAI-owned due-time scheduler loop backed by durable task-row schedule/payload/claim state plus a global scheduler epoch that resets execution claims across rollout/startup. `web_fetch` is landed end-to-end on the shared tool loop using runtime-owned daily-limit consumption plus provider-gateway Firecrawl fetch normalization/untrusted attribution, `web_search` is landed across the full current provider surface instead of a `Tavily`-only subset, the native bundle now carries `runtime.workerTools` with enforced parity for every current worker-policy tool (`browser`, `image_generate`, `tts`, `scheduled_action`, hidden internal `cron`), PersAI now has a real `tool_browser` / `Browserless` control-plane seam plus typed `runtime.browser` provider/action/confirmation metadata, runtime/provider-gateway now project and execute the bounded `snapshot` + `act` browser contract through a Browserless-backed worker path with quota/provider gating and structured tool-history results, and `scheduled_action` now executes `create` / `list` / `pause` / `resume` / `cancel` through PersAI internal task registry/control seams while due user reminders and assistant background actions are claimed/executed on a PersAI-owned scheduler path instead of hidden legacy cron jobs for new reminders. The current tasks UI path has already passed bounded live validation, the post-validation assistant follow-up retry/prompt hardening is landed, the next active tool family is `T15-6 — Media generation and editing plan tools`, and later helper exposure work remains pending in `T15-7` |
| Step 15a — Native web TTS streaming/output                                       | planned     | Steps 9, 10, 15               | Native web voice output is a channel capability and no longer relies on post-turn attachment delivery to feel complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Step 15b — Replace bootstrap preset and lifecycle UI with native prompt surfaces | planned     | Steps 2, 7, 15                | Admin/setup UX stops treating OpenClaw bootstrap docs as the product contract; create/preview/publish/reapply/reset/recreate align to the native bundle pipeline, and any future forced lightweight prompt override is exposed only as an explicit admin/operator control with warning and state visibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Step 16 — Build isolated sandbox service                                         | planned     | Step 15                       | Sandbox exists outside ordinary chat path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Step 17 — Remove OpenClaw runtime integration from PersAI active paths           | planned     | Steps 10, 12, 14, 15, 15b, 16 | Legacy active request-time runtime path is deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Step 18 — Remove OpenClaw-shaped schema and document cleanup                     | planned     | Step 17                       | Final architectural cleanup is complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Step 15 tool slice ledger

| Tool slice                                                       | Status    | Lands in | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T15-0 — Current tool inventory baseline                          | completed | Step 15  | ADR-072 now captures the current catalog/UI/runtime tool surface, provider seams, and explicit parity landing rules for every existing tool before later Step 15 redesign work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| T15-1 — Tool taxonomy and usage policy baseline                  | completed | Step 15  | Native runtime bundles now carry explicit `toolPolicies`, `TOOLS.md` is derived from the same policy list, and runtime warm validation rejects tool surfaces that lack matching policy metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| T15-2 — Shared summarization and compaction tools                | completed | Step 15  | `runtime.sharedCompaction` now materializes the shared `summarize_context` / `compact_context` naming plus web latency/token-threshold knobs and Telegram auto-summarize policy, `apps/runtime` now has dark native `POST /api/v1/turns/compact` and `POST /api/v1/turns/session/resolve` seams for shared compaction execution and session-state reads, public web manual compaction plus GET/banner state call those seams, Telegram owner auto summarize now reuses the same runtime-owned compaction path after native turns, web banner suggestions also honor rolling reply latency, later runtime turns reuse only validated durable compaction state, and bad/legacy compaction rows are ignored safely on the read path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T15-3a — Shared native tool runtime hardening and system helpers | completed | Step 15  | Shared runtime hardening is now landed: sync and stream turns expose only real `summarize_context` / `compact_context` tools, OpenAI/Anthropic stream paths surface `tool_calls` so runtime can execute tools and continue the same reply with explicit `tool_started` / `tool_finished` events, compaction tool calls reuse the accepted-turn lease, provider/runtime observability now classifies `main_turn`, `tool_loop_followup`, `manual_compaction`, and `auto_compaction`, same-turn durable compaction suppresses redundant post-turn auto-compaction, shared compaction now keeps output bounded plus retries once on invalid structured output before failing closed, and native web streaming now preserves honest user-visible ordering by flushing buffered pre-tool text before tool lifecycle while the web delivery path flushes pending text before activity markers. Prompt guidance is derived from projected runtime truth rather than `TOOLS.md`, and `persai_workspace_attach` / `persai_tool_quota_status` stay explicitly dark until later `T15-7` exposure/executor follow-through instead of blocking later Step 15 tool families                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| T15-3b — Web search and fetch plan tools                         | completed | Step 15  | `web_search` and `web_fetch` now land as separate provider-backed PersAI-native executors with current catalog/provider seam parity and no dependence on a premature `knowledge_*` layer. Native `web_search` honors the full current provider surface (`Tavily`, `Brave`, `Perplexity`, `Google (Gemini)`) on the shared native `query` / `count` contract, native `web_fetch` executes through the Firecrawl seam when its credential is configured, runtime/provider-gateway consume the internal quota/secret seams through the now-wired PersAI internal API boundary, and bounded live validation after `reapply` has confirmed the working configured path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T15-4 — Browser and web-interaction plan tools                   | completed | Step 15  | `browser` stays a separate plan-managed family with a PersAI-owned browser contract; the shared `runtime.workerTools` baseline now covers the then-current worker-policy surface (`browser`, `image_generate`, `tts`, hidden internal `cron`), PersAI now carries a real browser control-plane/bundle seam via `tool_browser` (`Browserless`) plus typed `runtime.browser` provider/action/confirmation metadata, and runtime/provider-gateway now project and execute a bounded stateless `snapshot` + `act` browser contract through the hidden Browserless executor seam with quota/provider gating, timeout propagation, and structured tool-history/audit results                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T15-5 — Reminder and scheduled action plan tools                 | completed | Step 15  | `scheduled_action` is now the canonical product-facing surface while PersAI-native scheduler/worker triggers remain hidden internal machinery instead of carrying forward raw legacy `cron` semantics. The full code slice is now landed: `scheduled_action` compiles as a worker `scheduled_action` on the shared `runtime.workerTools` layer, native runtime now projects/executes the product-facing `create` / `list` / `pause` / `resume` / `cancel` surface through PersAI internal task registry/control seams plus clean native `conversationContext` for Telegram reminder target routing, the create contract now distinguishes `audience="user"` reminders from hidden `audience="assistant"` background actions with `actionType` / `actionPayload`, assistant-side actions run on a hidden native runtime path that cannot directly create user-visible chat output, current reminder delivery/fanout now runs through one shared PersAI-owned delivery core instead of living only inside the legacy `cron-fire` adapter, and new scheduled actions now persist native schedule/payload state directly in PersAI task rows so a hidden PersAI-owned scheduler loop can claim due work with a global rollout-resettable scheduler epoch, expiring claims, and retry delay instead of creating legacy cron jobs. Hidden internal `cron` stays internal-only only as legacy callback compatibility for pre-cutover rows during rollout, the current tasks UI now renders assistant-side actions in a separate subdued panel without reopening raw scheduler semantics on the model/product surface, and bounded live validation plus the post-validation assistant follow-up retry/prompt hardening now close this slice honestly |
| T15-6 — Media generation and editing plan tools                  | planned   | Step 15  | `tts`, `image_generate`, `image_edit`, `video_generate`, provider-agnostic routing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| T15-6b — Human memory and namespaced knowledge sources           | planned   | Step 15  | Cross-session human memory per assistant-user plus searchable assistant-user-private prior chats, preset/subscription knowledge, assistant-user-private workspace knowledge, and PersAI-global knowledge land behind unified `knowledge_search` / `knowledge_fetch`; durable human-memory writes stay explicit tool/validator flows, canonical PersAI-owned storage plus minimal upload/list/delete/status/reindex surfaces land for knowledge files/sources, transcript/document recall stays reference-first with bounded `knowledge_fetch`, sandbox remains only an authoring/ingest surface until Step 16, distinct knowledge-storage quota/accounting stays separate from chat media and workspace/sandbox limits, and normal prod context assembly stops treating the current fixed hydrated-history cap as the primary strategy once richer memory/knowledge hydration exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| T15-7 — Plan/admin exposure, quotas, and model guidance          | planned   | Step 15  | Always-on system tools, plan-controlled tools, quotas, audit, prompt/runtime alignment, operator-facing attachment/exposure of memory/knowledge capabilities after the executor families are real, minimal admin/user visibility for knowledge-source usage/status/management, clear separation of media-vs-knowledge-vs-workspace storage quotas, and any forced lightweight prompt mode stays an explicit admin/operator-only override rather than an ordinary prod default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Sandbox tool matrix                                              | planned   | Step 16  | `read_file`, `write_file`, `edit_file`, `exec`, `shell`, and related isolated tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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
3a. If the active step is Step 15, follow the tool-slice order exactly: `T15-0 -> T15-1 -> T15-2 -> T15-3a -> T15-3b -> T15-4 -> T15-5 -> T15-6 -> T15-6b -> T15-7`. `web_search` and `web_fetch` are separate plan tools in `T15-3b`; do not hide them behind `knowledge_*`. `knowledge_search` / `knowledge_fetch` and bounded durable-memory writes land later in `T15-6b` only once real PersAI-native memory/knowledge backends exist, and sandbox filesystem/process access still waits for Step 16.
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
