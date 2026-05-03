# Data Model

This document describes the current active PersAI data-model truth at a high level.

ADR-072 remains the historical migration record through the native-path closeout. ADR-078 is completed and archived as the consolidated follow-through program. ADR-080 is the active target-state decision for admin-controlled Knowledge authoring and Skill curation. ADR-081 is the active target-state decision for unified user-visible Files.

## Control-plane ownership

PersAI is the source of truth for:

- assistants and published versions
- persona archetypes plus draft/published Voice DNA selection and snapshot state
- runtime bundle materialization
- canonical chats and messages
- canonical assistant chat attachments and media metadata
- durable web-chat logical turn attempts keyed by `assistantId + userId + surfaceThreadKey + clientTurnId`, used for retry/replay/status reconciliation
- canonical user-visible Files through `assistant_files` and durable `fileRef`
- assistant-private knowledge source metadata plus platform/admin-managed Skill, Product KB, and global Knowledge metadata and indexed chunks
- admin-authored Skill knowledge cards and Product KB text entries, with explicit lifecycle governance before indexing/runtime use
- persisted assistant workspace files through `assistant_files`
- assistant background task state through `assistant_background_tasks` and per-run history through `assistant_background_task_runs`
- plan-owned retrieval policy and admin-managed knowledge governance
- durable retrieval observability rollups/events
- governance, quota, audit, and admin state, including subscription-period media quota counters
- integration state such as Telegram binding/config

## Runtime-plane ownership

The native runtime path uses PersAI-owned runtime state models for:

- bundle warm/invalidation state
- runtime sessions
- turn receipts and idempotency state
- session compaction metadata

## Web chat send reliability

Web/Capacitor chat sends now carry a stable client envelope:

- `assistant_web_chat_turn_attempts` records each logical send with status `accepted`, `running`, `completed`, `failed`, or `interrupted`, plus chat/message ids and terminal replay payloads when available.
- `assistant_chat_message_attachments.client_turn_id` and `client_attachment_id` bind staged uploads to the same logical send. Normal attachment merge uses `clientTurnId` ownership instead of the prior "nearby empty message" heuristic.
- the old surface-binding last-completed replay metadata may remain as a transitional compatibility write, but the durable attempt registry is the current authority for retry/status reconciliation.

## Sandbox and assistant workspace state

Current active Step 20 persistence includes:

- `assistant_files` as the canonical file registry for persisted assistant workspace files
- `assistant_workspace_leases` for multi-pod workspace ownership/serialization
- `sandbox_jobs` for queued/running/completed/blocked sandbox execution telemetry and result state

`SandboxFileRef` is not active current-model truth anymore.

ADR-081 extends the target-state authority of `assistant_files`: every user-visible or assistant-reusable file must be represented by an `AssistantFile` row and a durable `fileRef` immediately when persisted. That includes user uploads, assistant-generated artifacts, delivered assistant attachments, and sandbox-created files.

ADR-081 Slice 1 adds `assistant_chat_message_attachments.assistant_file_id` as the projection link from chat rendering/download rows to canonical `assistant_files`. Ready upload/inbound/delivery attachments are registered into `assistant_files` immediately; `attachmentId` remains message-rendering state, while `assistant_files.id` is the durable `fileRef`.

`attachmentId`, `artifactId`, `objectKey`, storage paths, raw sandbox paths, knowledge source ids, and retrieval references are not target-state model-facing file selectors. They may remain internal implementation identifiers where needed, but `fileRef` is the product/runtime handle for Files.

ADR-081 Slice 5 removes the old attachment download route from the active product path. Chat attachment rows can still exist as message-rendering projections, but reusable/openable files are surfaced through `assistant_files.id` (`fileRef`) and the Files API does not expose storage paths, `objectKey`, or checksum internals as user-facing state.

Knowledge sources remain separate from Files. A Knowledge document may link internally to a source file, but Knowledge source ids and retrieval references are not sendable file handles.

## Knowledge and retrieval state

Current active knowledge/retrieval persistence includes:

- assistant-scoped uploaded knowledge sources plus indexed assistant chunk rows
- platform-scoped global knowledge sources plus indexed global chunk rows
- platform-scoped Product KB text entries/files plus indexed Product KB chunk rows
- first-class platform-catalog `Skill` / `SkillDocument` / `SkillKnowledgeCard` rows plus assistant-scoped `AssistantSkillAssignment` rows for ADR-079 professional Skills; Skill ownership/visibility is not derived from tenant workspace, and `Skill.category` currently stores the admin-selected Skill group key
- `KnowledgeIndexingJob` rows for pending source processing, including `skill_document` sources
- `KnowledgeVectorChunk` rows as the pgvector-backed normalized vector index boundary. Platform sources use source type/id/version/chunk/model and optional `skillId`; `workspaceId` is reserved for assistant-private sources and may be `NULL` for shared KB sources.
- workspace-scoped `KnowledgeRetrievalEvent` rows for individual search/fetch telemetry
- workspace-scoped `KnowledgeRetrievalRollup` rows for durable aggregated retrieval metrics
- `PlatformRuntimeProviderSettings.adminKnowledgeRetrievalPolicy` as the admin-owned Product/Skill KB retrieval and authoring model policy (`embeddingModelKey`, `retrievalModelKey`, `authoringModelKey`)

ADR-079 indexing is DB-backed for current source types: `assistant_knowledge_source`, `global_knowledge_source`, `skill_document`, `skill_knowledge_card`, and `product_knowledge_text_entry`. Upload/reindex writes source metadata and a pending `KnowledgeIndexingJob`; assistant-private jobs keep a workspace owner, while shared platform KB jobs have no tenant workspace owner. The API worker claims jobs with token/expiry fields, records attempt/retry/failure state, processes normalized source content, persists source provider/processor/quality/error state, writes legacy chunk rows, and replaces pgvector rows through `KnowledgeVectorChunk` when embeddings are available. `needs_review` is an indexing quality state and does not imply ADR-080 lifecycle governance.

Enabled Skill prompt materialization is runtime-bundle state, not a separate persisted Skill prompt table. The materializer reads `AssistantSkillAssignment` rows plus active platform-catalog `Skill` instruction cards, applies the effective enabled-Skills limit, and writes the resulting bounded `Enabled Skills` block into the materialized runtime bundle through Prompt Constructor. Disabled, archived, draft, plan-disabled, and over-limit Skills are omitted. Skill assignment changes and assigned Skill edits/archive mark affected assistant materialization dirty so the block is refreshed before runtime use.

Runtime router Skill planning is also bundle-derived state. The materialized runtime bundle carries compact enabled Skill summaries (`id`, localized name, short description, category, up to two tags, and up to two instruction-card examples as semantic routing hints) for classifier input. The runtime `retrievalPlan` is per-turn transient output and is not persisted as a separate planning table; durable retrieval telemetry remains the later observability path.

Orchestrated retrieval context is transient runtime turn state. ADR-079 does not add a persisted retrieval-plan table: the API validates the per-turn plan, reads existing platform Skill chunks, assistant knowledge, memory/chat, and Product/subscription sources, then returns a bounded source-aware context block to the runtime. Skill references are derived from ready Skill documents/cards for currently active assistant Skill assignments and are constrained by selected Skill ids, not by the consuming assistant workspace. Product KB/global retrieval reads active/ready platform rows; assistant uploads, memory, chat, files, and telemetry remain assistant/workspace-scoped. Source-level orchestration observability reuses `KnowledgeRetrievalEvent` / `KnowledgeRetrievalRollup` for `skill`, `document`, `product`, and `web` plan classes, storing latency/result/empty/error signals rather than full prompts or chunks.

The active retrieval-policy contract is plan-managed rather than hard-coded for user-uploaded assistant knowledge. Retrieval limits, helper toggles, fetch windows, and embedding-search enablement resolve from plan billing hints and materialize into active runtime/control-plane behavior. Admin-owned Product KB and Skill documents use the platform admin knowledge retrieval policy for model slots so admin KB indexing/rerank can be tuned independently from user plans.

ADR-080 adds the target-state authoring layer for Skill and Product KB knowledge. Authored Skill knowledge cards and Product KB text entries are Knowledge sources, not Files. They carry admin lifecycle state (`draft`, `active`, `stale`, `archived`) separately from ADR-079 processing/indexing state (`processing`, `ready`, `failed`, `needs_review`). Draft and archived authored entries must not be injected into runtime retrieval; active entries enqueue or refresh normal ADR-079 indexing jobs.

The built-in PersAI Product Overview and Product Principles documents are no longer code-owned runtime documents. They are seeded/backfilled as single active platform `ProductKnowledgeTextEntry` rows so admins can see and edit them in Product KB. Runtime Product KB retrieval reads admin-managed Product KB text entries/files plus plan/subscription catalog facts for tariffs and quota differences; non-pricing product truth should not be hard-coded into runtime retrieval.

Assistant-assisted Skill authoring currently returns a transient draft proposal rather than a persisted `KnowledgeAuthoringDraft` row. The proposal can fill editable Skill draft fields and draft-only knowledge-card editor content; durable `Skill` / `SkillKnowledgeCard` rows are written only when the admin explicitly saves, and runtime retrieval remains gated by `active` lifecycle plus indexing readiness.

## Durable assistant memory

Active durable memory persistence lives in `assistant_memory_registry_items` and is split into two real classes at write-time. Each row carries:

- `memoryClass`: `core` | `contextual` — the prompt-hydration class. Controlled by `classifyDurableMemoryWriteClass` (`apps/api/src/modules/workspace-management/domain/memory-class-policy.ts`); not user-tunable.
- `kind`: `fact` | `preference` | `open_loop` | `null` — the model-visible kind label. Promoted from `sourceLabel` text into a real enum column so downstream slices (M2/M3 ranking, future analytics) do not need to scrape prompt strings.
- `lastUsedAt`: `Timestamp(ms) | null` — bumped every time the row is hydrated into a turn; oldest core entries are demoted first when a new core write would push past `MEMORY_CORE_HARD_CAP = 15` entries per assistant–user pair.

Per-turn hydration runs through `POST /api/v1/internal/runtime/memory/hydrate-for-turn` on the `API_INTERNAL_PORT=3002` listener (`HydrateMemoryForTurnService`). The service returns the active `core` block (always all of it, ordered oldest-first, hard-capped at 15) plus a relevance-retrieved `contextual` tail (lexical search over `summary`, default top-8). The runtime renders these as two distinct prompt blocks (`durable_memory_core`, `durable_memory_contextual`); only the `core` block participates in the cached prompt prefix family registered in `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts`, so contextual rotation per turn does not invalidate ADR-074 P1's cached prefix.

Memory Center surfaces both `memoryClass` and `kind` as read-only badges through `AssistantMemoryRegistryItemState` (`packages/contracts/openapi.yaml`); promote/demote between classes is intentionally not exposed to users (founder principle 1: classification is a coded outcome, not a setting).

## Assistant tasks and background actions

Active task persistence is split by product meaning:

- `assistant_task_registry_items` remains the current user-reminder registry for the assistant settings "Задачи для тебя" card. It owns user-visible reminders and scheduled messages.
- `assistant_background_tasks` is the new current-state table for assistant-side quiet background actions shown under "Действия ассистента".
- `assistant_background_task_runs` stores per-fire history for those assistant actions: checked/no-push, pushed, completed, skipped, or failed, with evaluator decision JSON, push text, delivery result, and usage/error breadcrumbs.

`scheduled_action` is no longer target-state truth for assistant-side background checks. It remains the reminder tool. Background actions are evaluated by the background-task executor and deliver through the existing assistant notification preference instead of creating a second reminder.

Assistant notification delivery is source-neutral and durable. `scheduled_action:user_reminder`, `background_task`, `idle_reengagement`, and future `system_event` sources enqueue rows in `assistant_notification_outbox`; `AssistantNotificationOutboxSchedulerService` claims/retries/dead-letters those rows and is the only active caller of `AssistantNotificationDeliveryService`, which resolves `Assistant.preferredNotificationChannel`, sends Telegram when configured, falls back to the web `system:notifications` thread, and persists delivered artifacts through `MediaDeliveryService`. Workspace-level user notification policy lives in `workspace_notification_policies`; the first active policy is admin-controlled `idle_reengagement` with enablement, idle threshold, cooldown, and LLM instruction.

## Persona / Voice DNA state

Current active Voice DNA persistence includes:

- `persona_archetypes` as the editable canonical store for the 4 shipped archetypes
- `assistants.draft_archetype_key` as the user's current draft-time voice selection
- `assistant_published_versions.snapshot_archetype_key` plus `snapshot_voice_dna` as the publish-time fallback snapshot

Materialization prefers the live `persona_archetypes` row when it exists, and only falls back to `snapshot_voice_dna` if the referenced archetype is no longer present.

## Runtime provider and plan model state

Current active runtime-provider settings persistence includes:

- `platform_runtime_provider_settings.available_models_by_provider` as the legacy chat-model alias used by existing text-routing/provider warmup paths.
- `platform_runtime_provider_settings.available_model_catalog_by_provider` as the typed provider/model catalog. Each provider owns `models[]` profile rows with model key, capabilities (`chat`, `image`, `video`), token quota weights (`inputTokenWeight`, `cachedInputTokenWeight`, `outputTokenWeight`), and optional admin reference metadata. Older capability-list JSON is normalized into neutral default-weight profiles when read.
- `platform_runtime_provider_settings.document_processing_policy` as the admin-owned ADR-079 Document Processing policy for default provider, high-quality fallback provider, local fallback, automatic fallback, and extraction-quality threshold.
- admin plan `billing_provider_hints` as the persisted plan-level selection store for `primaryModelKey`, `imageGenerateModelKey`, `imageGenerateFallbackModelKey`, `imageEditModelKey`, `imageEditFallbackModelKey`, `videoGenerateModelKey`, `videoGenerateFallbackModelKey`, plan-owned quota limits such as weighted Credits, storage, active web chats, and monthly media generation/editing unit allowances, and ADR-083 lifecycle policy fields: `lifecyclePolicy.trialFallbackPlanCode` for admin-selected trial expiry fallback and `lifecyclePolicy.paidFallbackPlanCode` for plan-specific paid grace fallback.
- `billing_lifecycle_settings` as the persisted admin-owned global lifecycle policy for `gracePeriodDays`, global fallback plan, and lifecycle notification policy. Email is required in policy truth; assistant push is optional; notification rule enablement/offsets are stored in metadata rather than treated as code-only product truth.
- `workspace_subscription_billing_events` as the PersAI-owned snapshot log for trusted provider/admin/manual payment inputs before they mutate subscription truth. Rows store normalized event code/source, provider/payment refs, target paid period facts, metadata, and apply status so retries and duplicate webhooks do not directly race on `workspace_subscriptions`.
- `workspace_subscriptions` as PersAI-owned subscription lifecycle truth. ADR-083 Slice 3 materializes a row from the active default registration plan when none exists, stores trial/current-period boundaries for trial registrations, stores explicit `graceStartedAt/graceEndsAt`, and uses `expired_fallback` for persisted fallback state after trial or grace expiry.
- `workspace_subscription_lifecycle_events` as append-only subscription lifecycle history for trial start/expiry, fallback, payment activation, renewal success/failure, grace start/expiry, payment recovery, and payment reversal. These events are distinct from generic assistant audit logs and are the source for Ops detail, notification scheduling, and billing support investigation.
- `billing_lifecycle_notification_jobs` as durable billing lifecycle notification work derived from subscription lifecycle events. Rows capture required email work and optional assistant notification work with dedupe keys, schedule times, static required-facts copy, and delivery/enqueue status. Assistant notification jobs enqueue into `assistant_notification_outbox`; email jobs remain pending until a real email adapter exists.

`Admin > Ops Cockpit` reads support projections from these PersAI-owned tables: `workspace_subscriptions`, `workspace_subscription_lifecycle_events`, `billing_lifecycle_notification_jobs`, and period quota counters. Provider customer/subscription refs are displayed only as support identifiers; product surfaces do not read provider state directly at request time.

ADR-082 Slice 4 adds `workspace_media_monthly_quota_counters` as the period-scoped truth for media generation/editing allowances. Rows are keyed by workspace, tool code (`image_generate`, `image_edit`, `video_generate`), and period start/end; counters separately track reserved, settled, released, and reconciliation-required units. Slice 5 uses those columns as the delivery-confirmed settlement lifecycle: reservations happen before provider work, successful delivery moves reserved units into settled units, provider/no-delivery outcomes are released or marked reconciliation-required, and only reserved plus settled units count as active user quota usage. Periods resolve from `WorkspaceSubscription.currentPeriodStartedAt/currentPeriodEndsAt` with an explicit UTC calendar-month fallback for local/manual states. `WorkspaceToolUsageDailyCounter` remains day-scoped safety/rate-limit state and is not the paid monthly media quota model.

Materialization validates plan-selected image/video model keys against the capability-aware catalog and writes the resolved primary/fallback keys into each runtime bundle tool credential ref. Runtime tool execution treats that credential chain as request-time truth for `image_generate`, `image_edit`, and `video_generate`, so feature-specific requests can switch to a compatible fallback model or soft-skip before calling the provider.

ADR-082 Slice 3 makes these provider/model profiles the active token quota-weight truth for completed native turns. `WorkspaceQuotaUsageEvent.dimension=token_budget` records one weighted Credits delta per completed turn where runtime `usageAccounting.entries` are available, with metadata carrying raw input/cached-input/output token totals, applied weights, rounded Credits, and whether any entry fell back to neutral default weights. Plans continue to own token budget limits; provider/model weights remain global Admin Runtime policy.

## Secret ownership

Current secret wiring is split between:

- `persai-api-secrets`
- `persai-runtime-secrets`

No active data-model boundary should require `persai-openclaw-secrets`.

Document-processing provider keys for Mistral OCR and LlamaParse use the same encrypted `platform_runtime_provider_secrets` store as other PersAI-managed provider/tool credentials, under dedicated document-processing storage keys. Raw keys are write-only in admin surfaces.

## Historical traces

Historical migration traces may still exist in old migrations and archival docs, including renamed legacy columns or compatibility-era materialization fields. Those traces do not define the active request-time model.
