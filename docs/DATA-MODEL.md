# Data Model

This document describes the current active PersAI data-model truth at a high level.

ADR-072 remains the historical migration record through the native-path closeout. ADR-078 is completed and archived as the consolidated follow-through program. ADR-080 is the active target-state decision for admin-controlled Knowledge authoring and Skill curation. ADR-081 is the active target-state decision for unified user-visible Files. ADR-087 is the active target-state decision for unified quota advisories and paid light mode. ADR-088 is the active target-state decision for the unified notification platform, control plane, and delivery architecture.

## Control-plane ownership

PersAI is the source of truth for:

- assistants and published versions
- persona archetypes plus draft/published Voice DNA selection and snapshot state
- runtime bundle materialization
- durable materialization rollout control-plane state through `materialization_rollouts` and `materialization_rollout_items`
- canonical chats and messages
- canonical assistant chat attachments and media metadata
- persisted app-user identity/profile state, including `app_users.preferred_locale` as the primary user language truth and `app_users.country_code` as separate regional metadata
- durable web-chat logical turn attempts keyed by `assistantId + userId + surfaceThreadKey + clientTurnId`, used for retry/replay/status reconciliation
- canonical user-visible Files through `assistant_files` and durable `fileRef`, with runtime-owned model aliases resolving back to that canonical id
- assistant-private knowledge source metadata plus platform/admin-managed Skill, Product KB, and global Knowledge metadata and indexed chunks
- admin-authored Skill knowledge cards and Product KB text entries, with explicit lifecycle governance before indexing/runtime use
- persisted assistant workspace files through `assistant_files`
- assistant background task state through `assistant_background_tasks` and per-run history through `assistant_background_task_runs`
- plan-owned retrieval policy and admin-managed knowledge governance
- durable retrieval observability rollups/events
- governance, quota, audit, and admin state, including subscription-period media quota counters
- destructive assistant/workspace deletion must clear newer assistant/workspace-owned registries (for example `assistant_files`, `assistant_web_chat_turn_attempts`, `assistant_media_jobs`, `assistant_background_tasks`, `assistant_background_task_runs`, retrieval rows, and period quota/billing rows) before the owning assistant/workspace/user rows are removed
- durable quota-advisory threshold/dedupe state for active-surface warning delivery
- durable notification control-plane state across assistant outbox delivery, billing lifecycle notification jobs, admin notification channels, delivery attempts, and workspace notification policy rows, with ADR-088 defining the target-state convergence of these currently split models
- integration state such as Telegram binding/config
- ADR-097 document-domain persistence (`assistant_documents`, `assistant_document_versions`, `assistant_document_render_jobs`, `assistant_document_provider_mappings`, `assistant_document_delivered_files`, `assistant_document_revision_logs`) for stable `doc_id`, version graph, render-job lifecycle, provider reconciliation metadata, delivery linkage, and revision history

## Runtime-plane ownership

The native runtime path uses PersAI-owned runtime state models for:

- bundle warm/invalidation state
- runtime sessions
- turn receipts and idempotency state
- session compaction metadata
- web compaction banner state and background compaction notice classification read `runtime_session*` state together with the current materialized runtime-bundle compaction config; persisted bundle truth may arrive as either a materialized object or a JSON document string and both shapes are valid current-state storage forms

## Document render-job truth

ADR-097 adds a document-domain async execution model separate from `assistant_media_jobs`:

- `assistant_documents` is the canonical persisted document identity (`doc_id`) and high-level lifecycle owner
- `assistant_document_versions` stores the version graph plus the normalized source/request snapshot used to render a concrete version
- `assistant_document_render_jobs` is the durable async worker registry for document rendering and delivery, including claim/retry state, terminal error state, and worker/provider status JSON
- `assistant_document_provider_mappings` stores provider reconciliation identifiers plus the latest provider operational metadata for a version/provider pair
- `assistant_document_delivered_files` links the canonical delivered `AssistantFile` row back to document/version/render-job truth
- `assistant_document_revision_logs` is the append-only revision/audit trail for future existing-document flows

Current active truth for the narrow PDFMonkey-first rollout:

- PersAI remains the source of truth for `doc_id`, version graph, render-job lifecycle, quota settlement, and delivered-file truth
- provider-side ids/status are reconciliation metadata only; they are persisted on both success and terminal failure and must not replace PersAI job truth
- `AssistantDocumentDeliveredFile` + canonical `assistant_files` remain the only delivered-file path; provider URLs are operational metadata, not product truth
- no document-domain row may be reinterpreted through `assistant_media_jobs`; the media lane remains a separate model for image/audio/video work

## Web chat send reliability

Web/Capacitor chat sends now carry a stable client envelope:

- `assistant_web_chat_turn_attempts` records each logical send with status `accepted`, `running`, `completed`, `failed`, or `interrupted`, plus chat/message ids and terminal replay payloads when available.
- `assistant_media_jobs` is the ADR-086 durable generated-media job registry for `image` / `audio` / `video` work across both `web` and `telegram`. It now carries not only the canonical job row and web continuity projection for open states (`queued`, `running`, `completion_pending`), but also the source surface, worker-owned request payload, result payload, claim TTL, retry timing, acknowledgement/completion assistant message ids, and terminal error state needed for durable backend execution plus backend-owned web/Telegram completion delivery.
- `assistant_telegram_album_collectors` is the durable Telegram media-group collector used when Telegram sends an album as multiple webhook updates that share `media_group_id`. Each row is keyed by `(assistant_id, telegram_chat_id, media_group_id)`, stores the album caption (when present), a JSON array of Telegram file parts (`fileId`, mime, filename, turn kind), first/last part timestamps, and scheduler claim columns. API webhook ingress appends parts immediately and returns `200`; `TelegramAlbumFinalizerSchedulerService` claims quiet albums after `TELEGRAM_ALBUM_FINALIZE_DELAY_MS` (1500ms) and executes exactly one inbound Telegram turn with all collected attachments. Single-photo-with-caption messages without `media_group_id` stay on the direct webhook path and are not collected.
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

`attachmentId`, `artifactId`, `objectKey`, storage paths, raw sandbox paths, knowledge source ids, and retrieval references are not target-state model-facing file selectors. They may remain internal implementation identifiers where needed, and `fileRef` remains the canonical product/runtime handle for Files, but ordinary model-visible prompt history/tool usage should use runtime-owned human aliases that resolve to `fileRef` server-side instead of exposing raw selectors in conversation text.

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
- workspace-scoped `KnowledgeRetrievalEvent` rows for individual search/fetch telemetry; ADR-094 extends this row with two nullable columns — `mode_used VARCHAR(32)` (the inline branch the seam picked: `smart_inline_full`, `smart_inline_section`, `smart_inline_summary`, `snippet_only` for search; `short`, `section`, `full` for fetch; `orchestrate_inline` for the orchestrator's own per-source skill fetches and `snippet_only` on its aggregate per-stage signal) and `bytes_returned INTEGER` (chars actually returned to the caller in that event; `0` on snippet-only / aggregate stage rows). After the 2026-05-13 backfill, the smart-search tags are no longer document-only: the same top-hit tags may now appear under `source=document`, `source=global`, or `source=subscription`, while `source=memory` remains snippet-only and `source=chat` still derives richer volume from fetch rather than search-inline. The migration is additive and reversible — pre-ADR-094 rows simply keep both columns `NULL`
- workspace-scoped `KnowledgeRetrievalRollup` rows for durable aggregated retrieval metrics
- `PlatformRuntimeProviderSettings.adminKnowledgeRetrievalPolicy` as the admin-owned Product/Skill KB retrieval and authoring model policy (`embeddingModelKey`, `retrievalModelKey`, `authoringModelKey`); ADR-094 extends this row with admin-controlled smart-retrieval hard ceilings (`smartSearchEnabled`, `smartSearchLongDocSummaryChars`, `fetchFullModeAbsoluteMaxChars`, `fetchFullModeAbsoluteMaxChatMessages`) that no plan can override

ADR-079 indexing is DB-backed for current source types: `assistant_knowledge_source`, `global_knowledge_source`, `skill_document`, `skill_knowledge_card`, and `product_knowledge_text_entry`. Upload/reindex writes source metadata and a pending `KnowledgeIndexingJob`; assistant-private jobs keep a workspace owner, while shared platform KB jobs have no tenant workspace owner. The API worker claims jobs with token/expiry fields, records attempt/retry/failure state, processes normalized source content, persists source provider/processor/quality/error state, writes legacy chunk rows, and replaces pgvector rows through `KnowledgeVectorChunk` when embeddings are available. `needs_review` is an indexing quality state and does not imply ADR-080 lifecycle governance.

Assistant-private uploaded knowledge-source rows now also expose the persisted extraction metadata on the ordinary assistant API path (`processorProviderKey`, `processorMode`, `processingQuality`), and a dedicated inspect endpoint derives a minimal debug/inspection view from `assistant_knowledge_sources` + current-version `assistant_knowledge_source_chunks`: `sizeBytes`, `chunkCount`, extracted `textChars`, first-chunk preview, the first 20 chunk previews, and a lightweight `looksLikeTocHeadingOnly` flag. This is a product/debug surface only; it does not change indexing or chunk truth.

Enabled Skill prompt materialization is runtime-bundle state, not a separate persisted Skill prompt table. The materializer reads `AssistantSkillAssignment` rows plus active platform-catalog `Skill` instruction cards, applies the effective enabled-Skills limit, and writes the resulting bounded `Enabled Skills` block into the materialized runtime bundle through Prompt Constructor. Disabled, archived, draft, plan-disabled, and over-limit Skills are omitted. Skill assignment changes and assigned Skill edits/archive mark affected assistant materialization dirty so the block is refreshed before runtime use.

Runtime router Skill planning is also bundle-derived state. The materialized runtime bundle carries compact enabled Skill summaries (`id`, localized name, short description, category, up to two tags, and up to two instruction-card examples as semantic routing hints) for classifier input. The runtime `retrievalPlan` is per-turn transient output and is not persisted as a separate planning table; durable retrieval telemetry remains the later observability path.

Orchestrated retrieval context is transient runtime turn state. ADR-079 does not add a persisted retrieval-plan table: the API validates the per-turn plan, reads existing platform Skill chunks, assistant knowledge, memory/chat, and Product/subscription sources, then returns a bounded source-aware context block to the runtime. Skill references are derived from ready Skill documents/cards for currently active assistant Skill assignments and are constrained by selected Skill ids, not by the consuming assistant workspace. Product KB/global retrieval reads active/ready platform rows; assistant uploads, memory, chat, files, and telemetry remain assistant/workspace-scoped. Source-level orchestration observability reuses `KnowledgeRetrievalEvent` / `KnowledgeRetrievalRollup` for `skill`, `document`, `product`, and `web` plan classes, storing latency/result/empty/error signals rather than full prompts or chunks. The `KnowledgeRetrievalEventSource` enum carries `document`, `global`, `product`, `skill`, `memory`, `chat`, `subscription`, and `web`; the previous `preset` enum value was dropped in 2026-05-04 because prompt presets are not a model-facing knowledge source. The retrieval observability `policyState` field records whether each search ran under the active-Skill policy (`skill_only`, `escalated_to_user`, `escalated_to_web`, `escalated_to_product`) or under the ordinary-turn priority policy (`ordinary_personal_first`, `ordinary_product_first`, `ordinary_web_first`, `ordinary_mixed_ambiguous`).

The active retrieval-policy contract is plan-managed rather than hard-coded for user-uploaded assistant knowledge. Retrieval limits, helper toggles, fetch windows, and embedding-search enablement resolve from plan billing hints and materialize into active runtime/control-plane behavior. Admin-owned Product KB and Skill documents use the platform admin knowledge retrieval policy for model slots so admin KB indexing/rerank can be tuned independently from user plans. ADR-094 extends `billingHints.retrievalPolicy` with five additive per-plan keys (`smartSearchShortDocChars`, `smartSearchMediumDocChars`, `chatSectionDefaultRadius`, `fetchFullModeMaxChars`, `fetchFullModeMaxChatMessages`) so each tier can be tuned independently for the smart `knowledge_search` and the flexible `knowledge_fetch`. The `KnowledgeRetrievalPolicy` reading path now defaults to a Start-tier-grade shape (not the prior Free-tier shape), so an existing plan row without `retrievalPolicy` overrides becomes a reasonable paid baseline; Free is now expected to be an explicit override in `billingHints.retrievalPolicy`, not the implicit baseline.

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

**ADR-088 Slice 2 (landed 2026-05-08):** the legacy assistant-outbox path is fully deleted. All assistant-authored conversational notifications now flow through `NotificationIntentService.createIntent({ class: "conversational", ... })` and the unified delivery worker. The deleted services are `AssistantNotificationOutboxService`, `AssistantNotificationOutboxSchedulerService`, `AssistantNotificationDeliveryService`, and `QuotaAdvisoryStateService`. The deleted tables are `assistant_notification_outbox`, `assistant_quota_advisory_states`, and `workspace_notification_policies` (idle + quota rows data-migrated to `notification_policies`). Notification policy for `idle_reengagement` and `quota_advisory` is now stored in the `notification_policies` table alongside all other sources. `whatsapp` is removed from `AssistantPreferredNotificationChannel`. The `system_event` `NotificationSource` enum value is reserved for Slice 4 admin telemetry; no producer currently creates intents with this source.

**ADR-088 Slice 3 (landed 2026-05-08):** `billing_lifecycle_notification_jobs` is dropped. Billing lifecycle notifications now flow through `notification_intents` (class=`transactional`, source=`billing_lifecycle`). Policy stored in `notification_policies` with source=`billing_lifecycle`. Per-rule sub-policy shape in `notification_policies.config`: `{ assistantPushEnabled: boolean, rules: { trial_ending: { enabled: boolean, offsetDays: number | null }, trial_expired: ..., renewal_failed: ..., grace_ending: ..., grace_expired: ..., payment_recovered: ... } }`. Email delivered through `EmailChannelAdapter` (Postmark, `notifications.persai.dev` domain). Optional assistant push through `web_notification_center` channel when `assistantPushEnabled=true`.

## Persona / Voice DNA state

Current active Voice DNA persistence includes:

- `persona_archetypes` as the editable canonical store for the 4 shipped archetypes
- `assistants.draft_archetype_key` as the user's current draft-time voice selection
- `assistant_published_versions.snapshot_archetype_key` plus `snapshot_voice_dna` as the publish-time fallback snapshot

Materialization prefers the live `persona_archetypes` row when it exists, and only falls back to `snapshot_voice_dna` if the referenced archetype is no longer present.

## Runtime provider and plan model state

Current active runtime-provider settings persistence includes:

- user plan visibility exposes the effective plan's structured `presentation.price`, allowing product UI to classify zero-price plans by `amount === 0` and render them as free/indefinite access without inferring from lifecycle status.
- `platform_runtime_provider_settings.available_models_by_provider` as the legacy chat-model alias used by existing text-routing/provider warmup paths.
- `platform_runtime_provider_settings.available_model_catalog_by_provider` as the typed provider/model catalog. Each provider owns `models[]` profile rows with model key, capabilities (`chat`, `image`, `video`), token quota weights (`inputTokenWeight`, `cachedInputTokenWeight`, `outputTokenWeight`), and optional admin reference metadata. Older capability-list JSON is normalized into neutral default-weight profiles when read.
- `platform_runtime_provider_settings.document_processing_policy` as the admin-owned ADR-079 Document Processing policy for default provider, high-quality fallback provider, local fallback, automatic fallback, and extraction-quality threshold.
- admin plan `billing_provider_hints` as the persisted plan-level selection store for `primaryModelKey`, `imageGenerateModelKey`, `imageGenerateFallbackModelKey`, `imageEditModelKey`, `imageEditFallbackModelKey`, `videoGenerateModelKey`, `videoGenerateFallbackModelKey`, plan-owned quota limits such as weighted Credits, storage, internal `activeWebChatsLimit`, user-facing `messagesPerChat`, and monthly media generation/editing unit allowances, ADR-083 lifecycle policy fields (`lifecyclePolicy.trialFallbackPlanCode`, `lifecyclePolicy.paidFallbackPlanCode`), and ADR-084 Slice 2 pricing presentation fields under `presentation` (`showOnPricingPage`, `displayOrder`, localized title/subtitle/notes/badge/ctaLabel, structured price, and localized feature bullets). `0` on `activeWebChatsLimit` and `messagesPerChat` means unlimited. The pricing presentation layer is display/admin truth only; real plan entitlements and limits remain the billing/quota source of truth.
- per-chat conversation-length enforcement remains request-time/control-plane logic, not a separate persisted counter table: the API reads the current durable `assistant_chat_messages` count for the thread before creating the next user message and returns a calm product conflict when the effective `messagesPerChat` limit has been reached.
- `workspace_payment_intents` as the PersAI-owned pre-provider checkout truth introduced by ADR-084 Slice 3. Each row persists the user/workspace, target paid plan code, normalized action (`new_purchase`, `upgrade`, later `renewal` / `manual_admin`), payment method class (`card` or `sbp_qr`), amount/currency/billing period snapshot, caller idempotency key, return URL, current provider key/session refs, normalized checkout mode (`embedded`, `redirect`, `payment_link`, `qr_code`, `manual_test`), provider-neutral checkout payload JSON, expiration, and last error state. The active recurring slice also persists recurring checkout truth in payment-intent metadata (`checkoutKind`, whether the selected method really supports recurring in the active contour, and an explicit unsupported reason when it does not) so product/runtime surfaces can distinguish recurring-start from honest one-shot fallback. For the active CloudPayments contour, the persisted payload now carries constructor-specific initialization/customization details under its own schema while keeping product truth provider-neutral. ADR-084 Slice 5 also makes `status=reversed` first-class payment-intent truth so refund/reversal outcomes are visible without scraping metadata. This row is created before contacting a billing provider and is the canonical audit trail when redirects fail, retries happen, or provider/webhook confirmation arrives later.
- `billing_lifecycle_settings` as the persisted admin-owned global lifecycle policy for `gracePeriodDays` and global fallback plan. **ADR-088 Slice 3 (landed 2026-05-08):** the `notificationPolicy` sub-object has been removed from `BillingLifecycleSettings.metadata`; billing notification policy is now stored in `notification_policies` (source=`billing_lifecycle`).
- `workspace_subscription_billing_events` as the PersAI-owned snapshot log for trusted provider/admin/manual payment inputs before they mutate subscription truth. Rows store normalized event code/source, provider/payment refs, target paid period facts, metadata, and apply status so retries and duplicate webhooks do not directly race on `workspace_subscriptions`. Recurring follow-through also uses billing-event metadata as the idempotency gate for provider-side managed-upgrade mutation, so duplicate/retry webhook delivery does not re-run `subscriptions/update` after PersAI has already accepted the event.
- `workspace_subscriptions` as PersAI-owned subscription lifecycle truth. ADR-083 Slice 3 materializes a row from the active default registration plan when none exists, stores trial/current-period boundaries for trial registrations, stores explicit `graceStartedAt/graceEndsAt`, and uses `expired_fallback` for persisted fallback state after trial or grace expiry. The recurring follow-through extends that truth with provider-managed subscription references plus `cancelAtPeriodEnd`, which is now the canonical state for "auto-renew disabled but paid access still active until this period ends." Bind-success enablement is distinct from resume: paid access without a provider subscription can later materialize provider-managed recurring truth through a dedicated auto-renew-enable transition. Scheduled cheaper-paid downgrade is also distinct from period-end fallback: PersAI persists the requested cheaper paid target in subscription metadata before the provider mutation so partial failure cannot leave provider truth ahead of PersAI, but the actual cheaper paid plan becomes active only on the next trusted renewal/payment success whose provider amount/currency matches that scheduled cheaper plan. If the next renewal stays on the old amount, PersAI clears the stale marker instead of pretending the cheaper entitlements took effect anyway. **ADR-092:** columns `last_payment_method_class`, `auto_renew_method_class`, `recurring_migration_status` (+ target/failure/timestamp), and `provider_recurring_descriptor` store canonical split payment-method truth and migration state; webhook + managed-subscription update paths populate them. OpenAPI `AssistantBillingSubscriptionManagementState` exposes `lastPaymentMethodLabel`, `autoRenewMethodLabel`, and `recurringMigration` instead of a single ambiguous payment-method string.
- `workspace_subscription_lifecycle_events` as append-only subscription lifecycle history for trial start/expiry, fallback, payment activation, renewal success/failure, grace start/expiry, payment recovery, payment reversal, and recurring-management events such as `auto_renew_disabled`, `auto_renew_enabled`, `subscription_resumed`, and `subscription_canceled`. These events are distinct from generic assistant audit logs and are the source for Ops detail, notification scheduling, and billing support investigation.
- ~~`billing_lifecycle_notification_jobs`~~ **DROPPED in ADR-088 Slice 3 (migration `20260508233251_adr088_slice3_billing_policy`).** Billing lifecycle notification work now flows through `notification_intents` (class=`transactional`, source=`billing_lifecycle`, renderStrategy=`template`, six rules). Billing notification policy is now stored in `notification_policies` (one row per workspace, `source=billing_lifecycle`). The `config` JSON column carries per-rule sub-policy: `{ assistantPushEnabled: boolean, rules: { [rule]: { enabled: boolean, offsetDays: number | null } } }`. No row of `apps/api/src` code references `billing_lifecycle_notification_jobs` after Slice 3.

ADR-087 adds one more quota/product truth layer:

- 90% warnings for finite limits are product-level advisory state, not raw transport errors
- warning delivery is deduplicated via `notification_intents.dedupeKey` (ADR-088 Slice 2); the deleted `assistant_quota_advisory_states` table is no longer used
- paid token-budget light mode is derived from effective plan truth plus the current period-scoped token counter (`used >= limit`) and lasts until that period resets; free/zero-price plans may still receive warnings but do not enter paid light mode
- upgrade eligibility for advisory copy must derive from explicit catalog truth rather than plan-name heuristics; ADR-087 currently defines the maximum plan as the highest-priced visible paid plan

`Admin > Ops Cockpit` reads support projections from these PersAI-owned tables: `workspace_subscriptions`, `workspace_subscription_lifecycle_events`, and period quota counters. Billing notification history lives in `notification_intents` / `notification_delivery_attempts` (ADR-088 Slice 3) and is surfaced through `Admin > Notifications`. Provider customer/subscription refs are displayed only as support identifiers; product surfaces do not read provider state directly at request time.

ADR-085 Slice 1 adds the first durable materialization rollout control-plane tables:

- `materialization_rollouts` — one queued rollout/job per propagation reason with `rolloutType`, `triggerSource`, `scopeType`, `scopeMetadata`, `criticality`, `targetGeneration`, queue summary counts, and operator ownership fields (`createdByUserId`, timestamps, concurrency/rate-limit snapshot)
- `materialization_rollout_items` — one per targeted assistant with `targetGeneration`, `priority`, status/attempts/retry state, terminal error fields, timestamps, and resulting materialized spec/content/runtime bundle hashes when available

Current active usage after Slice 1:

- `Admin > Plans > Force reapply all` now creates a `manual_reapply` row in `materialization_rollouts` and corresponding per-assistant `materialization_rollout_items`
- `materialization_rollout_items` are processed by a dedicated API worker under the `scheduler_leases.scheduler_key = materialization_rollout` leader row
- the old `assistant_platform_rollouts` / `assistant_platform_rollout_items` tables remain legacy JSON-governance rollout truth until the later ADR-085 replacement slice removes them from the active product path

ADR-082 Slice 4 adds `workspace_media_monthly_quota_counters` as the period-scoped truth for media generation/editing allowances. Rows are keyed by workspace, tool code (`image_generate`, `image_edit`, `video_generate`), and period start/end; counters separately track reserved, settled, released, and reconciliation-required units. Slice 5 uses those columns as the delivery-confirmed settlement lifecycle: reservations happen before provider work, successful delivery moves reserved units into settled units, provider/no-delivery outcomes are released or marked reconciliation-required, and only reserved plus settled units count as active user quota usage. Periods resolve from `WorkspaceSubscription.currentPeriodStartedAt/currentPeriodEndsAt` with an explicit UTC calendar-month fallback for local/manual states. `WorkspaceToolUsageDailyCounter` remains day-scoped safety/rate-limit state and is not the paid monthly media quota model.

Materialization validates plan-selected image/video model keys against the capability-aware catalog and writes the resolved primary/fallback keys into each runtime bundle tool credential ref. Runtime tool execution treats that credential chain as request-time truth for `image_generate`, `image_edit`, and `video_generate`, so feature-specific requests can switch to a compatible fallback model or soft-skip before calling the provider.

ADR-088 Slice 1 introduced the unified notification platform tables; ADR-088 Slice 2.5 (landed 2026-05-09) collapsed configuration to **global singletons** and keeps per-event tables workspace-attributed:

**Per-event tables (workspace-attributed):**

- `notification_intents` — durable notification intent records keyed by `workspaceId` plus source/class/priority/dedupe key. `lifecycleStatus` values: `pending`, `claimed`, `delivered`, `failed`, `dead_letter`, `skipped`, `deferred_quiet_hours`, `deferred_rate_limit`. Carries render strategy, template id, fact payload JSON, policy snapshot JSON, allowed channels array, escalation metadata, quiet-hours flag, surface/thread binding, and dedupe key.
- `notification_delivery_attempts` — per-channel delivery attempt log keyed by `intentId` (cascade). Stores `attemptNumber`, `channel`, `status` (`pending`, `sent`, `delivered`, `failed`, `bounced`, `complaint`, `escalated`), `providerRef`, structured `error` JSON, `startedAt` / `completedAt`, and self-referential `escalationOf` FK (`ON DELETE SET NULL`). The table deliberately does **not** carry its own `workspaceId`; admin queries derive workspace through the parent intent join (see `ManageNotificationPlatformService.listDeliveries`).
- `notification_dead_letters` — dead-lettered intents keyed by `workspaceId` and `intentId` (FK). Fields: `lastError` JSON, `escalationAttempts`, `claimedForReplayAt`, `resolvedAt` (NULL = active, non-NULL = replayed or discarded).

**Global singleton tables (operator-owned, no `workspaceId`):**

- `notification_channel_registry` — operator-managed channel configuration: exactly one row per `NotificationChannelType` for the whole platform (`@unique` on `channelType`). Fields: `channelType`, `enabled`, `config` JSON, `healthStatus` (`healthy`, `degraded`, `down`, `unconfigured`), `consecutiveFailures`, `lastDeliveryAt`, `lastFailureAt`. Web channels (`web_thread`, `web_notification_center`) are always available per-workspace through the resolver and the registry row is advisory for them. Other channel types use the row as the operator gate.
- `notification_policies` — global per-source notification policy: exactly one row per `NotificationSource` (`@unique` on `source`). Fields: `source`, `enabled`, `channels` (array), `cooldownMinutes`, `maxPerDay`, `escalationAfterMinutes`, `escalationChannel`, `respectQuietHours`, `renderStrategy`, `renderInstructionRef`, `templateId`, `config` JSON.
- `notification_quiet_hours` — global singleton quiet hours (one row, `singleton` boolean unique on `true`). Fields: `enabled`, `startLocal` (HH:MM), `endLocal` (HH:MM), `timezoneMode` (`workspace_default`, `per_user_resolved`), `defaultTimezone`, `appliesToSources` (string array).

**Code-level defaults:** `apps/api/src/modules/workspace-management/application/notifications/defaults/notification-defaults.ts` exports `NOTIFICATION_POLICY_DEFAULTS`, `NOTIFICATION_QUIET_HOURS_DEFAULT`, and `NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS` covering every value of `NotificationSource` and `NotificationChannelType`. The resolver (`ResolveWorkspaceNotificationChannelsService`) and `NotificationIntentService` import from this file when no DB row exists; no inline copies are permitted elsewhere. Per-workspace channel availability is auto-derived at delivery time from `Workspace.owner.AppUser.email`, `AssistantChannelSurfaceBinding` (`bindingState=active`), and intent context — no per-workspace notification-config rows ever exist.

Active enum values (Prisma source of truth):

| Enum                                 | Values                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `NotificationSource`                 | `idle_reengagement`, `quota_advisory`, `reminder`, `background_task_push`, `billing_lifecycle`, `admin_system`, `system_event` |
| `NotificationClass`                  | `conversational`, `transactional`, `operational`, `administrative`                                                             |
| `NotificationPriority`               | `immediate`, `scheduled`, `digest`, `skippable`                                                                                |
| `NotificationLifecycleStatus`        | `pending`, `claimed`, `delivered`, `failed`, `dead_letter`, `skipped`, `deferred_quiet_hours`, `deferred_rate_limit`           |
| `NotificationRenderStrategy`         | `grounded_llm`, `template`, `static_fallback`                                                                                  |
| `NotificationDeliveryAttemptStatus`  | `pending`, `sent`, `delivered`, `failed`, `bounced`, `complaint`, `escalated`                                                  |
| `NotificationChannelType`            | `telegram_thread`, `web_thread`, `web_notification_center`, `email`, `admin_webhook`, `web_push`, `mobile_push`                |
| `NotificationChannelHealth`          | `healthy`, `degraded`, `down`, `unconfigured`                                                                                  |
| `NotificationQuietHoursTimezoneMode` | `workspace_default`, `per_user_resolved`                                                                                       |

Legacy notification tables retired in Slices 2 and 3 (dropped 2026-05-08):

| Legacy table                                          | Retired by |
| ----------------------------------------------------- | ---------- |
| `assistant_notification_outbox`                       | Slice 2    |
| `assistant_quota_advisory_states`                     | Slice 2    |
| `workspace_notification_policies` (idle + quota rows) | Slice 2    |
| `billing_lifecycle_notification_jobs`                 | Slice 3    |

Remaining legacy notification tables still **transitional** until Slice 4:

| Legacy table                            | Owning producer             | Retiring slice |
| --------------------------------------- | --------------------------- | -------------- |
| `workspace_admin_notification_channels` | legacy admin webhook config | Slice 4        |
| `admin_notification_deliveries`         | legacy admin webhook log    | Slice 4        |

ADR-082 Slice 3 makes these provider/model profiles the active token quota-weight truth for completed native turns. `WorkspaceQuotaUsageEvent.dimension=token_budget` records one weighted Credits delta per completed turn where runtime `usageAccounting.entries` are available, with metadata carrying raw input/cached-input/output token totals, applied weights, rounded Credits, and whether any entry fell back to neutral default weights. Plans continue to own token budget limits; provider/model weights remain global Admin Runtime policy.

## Secret ownership

Current secret wiring is split between:

- `persai-api-secrets`
- `persai-runtime-secrets`

No active data-model boundary should require `persai-openclaw-secrets`.

Document-processing provider keys for Mistral OCR and LlamaParse use the same encrypted `platform_runtime_provider_secrets` store as other PersAI-managed provider/tool credentials, under dedicated document-processing storage keys. ADR-084 Slice 5 extends that same encrypted store to billing-provider secrets too (currently the CloudPayments API Secret managed from `Admin > Tools`). Raw keys are write-only in admin surfaces.

## Historical traces

Historical migration traces may still exist in old migrations and archival docs, including renamed legacy columns or compatibility-era materialization fields. Those traces do not define the active request-time model.
