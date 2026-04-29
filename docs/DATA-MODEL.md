# Data Model

This document describes the current active PersAI data-model truth at a high level.

ADR-072 remains the historical migration record through the Step 18 native-path closeout. The active post-closeout program now lives in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Control-plane ownership

PersAI is the source of truth for:

- assistants and published versions
- persona archetypes plus draft/published Voice DNA selection and snapshot state
- runtime bundle materialization
- canonical chats and messages
- canonical assistant chat attachments and media metadata
- durable web-chat logical turn attempts keyed by `assistantId + userId + surfaceThreadKey + clientTurnId`, used for retry/replay/status reconciliation
- assistant/global knowledge source metadata and indexed chunks
- persisted assistant workspace files through `assistant_files`
- assistant background task state through `assistant_background_tasks` and per-run history through `assistant_background_task_runs`
- plan-owned retrieval policy and admin-managed knowledge governance
- durable retrieval observability rollups/events
- governance, quota, audit, and admin state
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

## Knowledge and retrieval state

Current active knowledge/retrieval persistence includes:

- assistant-scoped uploaded knowledge sources plus indexed assistant chunk rows
- workspace-scoped global knowledge sources plus indexed global chunk rows
- workspace-scoped `KnowledgeRetrievalEvent` rows for individual search/fetch telemetry
- workspace-scoped `KnowledgeRetrievalRollup` rows for durable aggregated retrieval metrics

The active retrieval-policy contract is plan-managed rather than hard-coded. Retrieval limits, helper toggles, fetch windows, and embedding-search enablement resolve from plan billing hints and materialize into active runtime/control-plane behavior.

## Durable assistant memory (ADR-074 M1)

Active durable memory persistence lives in `assistant_memory_registry_items` and is split into two real classes at write-time. Each row carries:

- `memoryClass`: `core` | `contextual` — the prompt-hydration class. Controlled by `classifyDurableMemoryWriteClass` (`apps/api/src/modules/workspace-management/domain/memory-class-policy.ts`); not user-tunable.
- `kind`: `fact` | `preference` | `open_loop` | `null` — the model-visible kind label. Promoted from `sourceLabel` text into a real enum column so downstream slices (M2/M3 ranking, future analytics) do not need to scrape prompt strings.
- `lastUsedAt`: `Timestamp(ms) | null` — bumped every time the row is hydrated into a turn; oldest core entries are demoted first when a new core write would push past `MEMORY_CORE_HARD_CAP = 15` entries per assistant–user pair.

Per-turn hydration runs through `POST /api/v1/internal/runtime/memory/hydrate-for-turn` on the `API_INTERNAL_PORT=3002` listener (`HydrateMemoryForTurnService`). The service returns the active `core` block (always all of it, ordered oldest-first, hard-capped at 15) plus a relevance-retrieved `contextual` tail (lexical search over `summary`, default top-8). The runtime renders these as two distinct prompt blocks (`durable_memory_core`, `durable_memory_contextual`); only the `core` block participates in the cached prompt prefix family registered in `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts`, so contextual rotation per turn does not invalidate ADR-074 P1's cached prefix.

Memory Center surfaces both `memoryClass` and `kind` as read-only badges through `AssistantMemoryRegistryItemState` (`packages/contracts/openapi.yaml`); promote/demote between classes is intentionally not exposed to users (founder principle 1: classification is a coded outcome, not a setting).

## Assistant tasks and background actions (ADR-077)

Active task persistence is split by product meaning:

- `assistant_task_registry_items` remains the current user-reminder registry for the assistant settings "Задачи для тебя" card. It owns user-visible reminders and scheduled messages.
- `assistant_background_tasks` is the new current-state table for assistant-side quiet background actions shown under "Действия ассистента".
- `assistant_background_task_runs` stores per-fire history for those assistant actions: checked/no-push, pushed, completed, skipped, or failed, with evaluator decision JSON, push text, delivery result, and usage/error breadcrumbs.

`scheduled_action` is no longer target-state truth for assistant-side background checks. It remains the reminder tool. Background actions are evaluated by the ADR-077 background-task executor and deliver through the existing assistant notification preference instead of creating a second reminder.

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
- `platform_runtime_provider_settings.available_model_catalog_by_provider` as the capability-aware provider catalog. Each provider owns `chat`, `image`, and `video` model key lists.
- admin plan `billing_provider_hints` as the persisted plan-level selection store for `primaryModelKey`, `imageGenerateModelKey`, `imageEditModelKey`, and `videoGenerateModelKey`.

Materialization validates plan-selected image/video model keys against the capability-aware catalog and writes the resolved key into each runtime bundle tool credential ref. Runtime tool execution treats that `modelKey` as request-time truth for `image_generate`, `image_edit`, and `video_generate`.

## Secret ownership

Current secret wiring is split between:

- `persai-api-secrets`
- `persai-runtime-secrets`

No active data-model boundary should require `persai-openclaw-secrets`.

## Historical traces

Historical migration traces may still exist in old migrations and archival docs, including renamed legacy columns or compatibility-era materialization fields. Those traces do not define the active request-time model.
