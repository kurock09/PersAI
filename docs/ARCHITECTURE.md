# Architecture

## System shape

PersAI is a modular monolith control plane plus three internal execution services:

- `apps/api` - public HTTP API, control plane, ingress-facing orchestration
- `apps/web` - product and admin UI
- `apps/runtime` - PersAI-native execution runtime
- `apps/provider-gateway` - internal provider transport boundary
- `apps/sandbox` - isolated file/process execution boundary for the native `files` / `exec` / `shell` path

OpenClaw is not part of the active architecture. Historical migration traces remain only in archival documents and old migrations.

ADR-072 remains the historical migration ADR through the native-path closeout. ADR-078 is completed and archived as the consolidated follow-through program. ADR-080 is the active target-state decision for admin-controlled Knowledge authoring and Skill curation. ADR-081 is the active target-state decision for the unified user Files architecture. ADR-087 defines the active target-state decision for unified quota advisories and paid light mode. ADR-088 defines the active target-state decision for the unified notification platform, control plane, and delivery architecture. ADR-092 is the active billing decision for split payment-method truth (last payment vs auto-renew), explicit SBP recurring migration with provider-confirmed completion semantics, provider recurring description sync, payment-success + receipt email policy, and Admin > Notifications billing-history acceptance. ADR-093 is the proposed umbrella for **agent execution** of clean PROD launch readiness and concurrency hardening (large sessions, deploy discipline, audits, load evidence) without changing product business rules. **ADR-102** is the active pre-PROD architectural cleanup program (runtime honesty, contract drift, admin multi-assistant tails, CI hygiene, optional document economics) — execute via one-slice-per-session agent discipline from `docs/ADR/102-pre-prod-architectural-cleanup-and-truth-hardening.md`. ADR-098 adds the active public trust-page model: market-aware site pages are platform-owned content, legal market derives from `app_users.country_code`, and compliance required versions resolve from published `terms` / `privacy` rows rather than one global hardcoded baseline.

## Core boundaries

### Control plane

`apps/api` owns:

- assistants, publish/apply lifecycle, and runtime bundle materialization
- Voice DNA archetype seed/edit flows, prompt-template defaults, and published Voice DNA snapshot materialization
- canonical chat/message persistence
- unified user-visible Files over the canonical `AssistantFile` registry
- assistant/global knowledge indexing, retrieval policy, and admin knowledge governance
- admin-authored Skill knowledge cards, Product KB text entries, and assistant-assisted admin knowledge drafts
- durable retrieval observability and workspace-scoped operator surfaces for knowledge quality
- governance, quota, admin, and audit boundaries
- Telegram webhook ingress
- durable quota-advisory threshold evaluation, assistant-authored active-surface follow-up delivery, quiet paid light-mode state, and advisory dedupe
- web/telegram compaction-state and queue/advisory reads must derive from the current materialized runtime bundle truth, tolerating either the persisted runtime-bundle object or the persisted JSON document form so UI/notification state does not drift from runtime config
- unified notification platform (ADR-088 Slices 1+2+3+2.5 implemented): global truth + auto-derived per-workspace channel availability; Postmark via `Admin > Tools` secret store. `NotificationIntentService` is the single entry point; all conversational producers and `BillingLifecycleProducerService` create intents; `NotificationDeliveryWorkerService` claims/renders/delivers via typed channel adapters using `ResolveWorkspaceNotificationChannelsService` for per-workspace availability; `notification_channel_registry`, `notification_policies`, `notification_quiet_hours` are global singletons (no `workspaceId`); per-workspace availability derived at delivery time from `AppUser.email`, `AssistantChannelSurfaceBinding`, intent context; `Admin > Notifications` is the compact operator control plane; legacy tables deleted; Postmark credentials in `Admin > Tools`; seed writes zero notification rows
- PersAI-owned billing lifecycle state, trusted provider/admin billing event snapshots, append-only lifecycle events; billing email delivered via Postmark through the notification platform (`class=transactional`, six template modules, dedupeKey, traceId=billing event id). ADR-092 is now active runtime truth: last successful payment method and the auto-renew instrument are distinct truths; managed SBP upgrade flows persist explicit `recurringMigration` state instead of implying SBP auto-renew from one-time success; provider recurring descriptions are synchronized with PersAI plan naming; payment-success communications include branded PersAI copy plus an official provider-receipt footer when available; billing intents remain visible in `Admin > Notifications` delivery history for platform-scoped admins.

### Runtime plane

`apps/runtime` owns:

- runtime bundle warm/use
- request-time turn execution
- runtime session and turn state
- native execution health/readiness

### Provider plane

`apps/provider-gateway` owns:

- provider client boot/warmup
- model/provider request transport
- provider health/readiness surface

### Sandbox plane

`apps/sandbox` owns:

- isolated file/process job execution
- assistant-workspace materialization and persistence through canonical `AssistantFile` rows
- sandbox job health/readiness and job polling surfaces used by `apps/runtime`

## Active request path

### Web

1. Browser calls `apps/api`
2. `apps/api` persists canonical state and forwards request-time execution to `apps/runtime`
3. `apps/runtime` calls back into `apps/api` over the dedicated internal listener for turn-time data hydration and retrieval orchestration (for example durable memory hydration through `POST /api/v1/internal/runtime/memory/hydrate-for-turn` and bounded knowledge context through `POST /api/v1/internal/runtime/knowledge/orchestrate`)
4. `apps/runtime` calls `apps/provider-gateway`
5. when a turn uses file/process tools, `apps/runtime` also calls `apps/sandbox`
6. result returns through `apps/api`
7. `apps/api` finalizes canonical message/media/quota state
8. ADR-099 media/STT/TTS billing-facts foundation now keeps provider-priced media truth additive to quota: runtime/provider-gateway may return normalized `billingFacts`, and API persists those facts on the owning durable media/attachment rows without appending ledger events yet

### Telegram

1. Telegram webhook hits `apps/api`
2. `apps/api` resolves assistant/runtime context
3. ordinary text and blocked media requests may still run request-time through `apps/runtime`, but accepted generated `image` / `audio` / `video` requests now enqueue durable `assistant_media_jobs` and return quickly from the webhook
4. the shared backend media-job worker later calls `apps/runtime` through `POST /api/v1/internal/runtime/media-jobs/run`
5. before final delivery, backend completion processing can call `POST /api/v1/internal/runtime/media-jobs/complete` with current canonical chat history to get optional fresh-history framing text
6. `apps/api` owns canonical persistence plus backend-owned async delivery back into Telegram

## Deploy topology

The active dev namespace `persai-dev` should contain only:

- `api`
- `web`
- `runtime`
- `provider-gateway`
- `sandbox`

Ingress truth:

- `persai.dev` -> `web`
- `api.persai.dev` -> `api`
- `bot.persai.dev` `/telegram-webhook` -> `api`

ADR-091 defines the active background-scheduler control-plane pattern for `apps/api`: each scheduler kind owns one durable row in `scheduler_leases`, and leadership is coordinated through short lease acquire / heartbeat / release writes instead of long-lived advisory-lock transactions. This keeps the scheduler shape uniform across idle re-engagement, background tasks, background compaction, and media jobs while avoiding pinned Prisma connections during outbound work.

### Database connection pool sizing

`apps/api` should set the Prisma datasource `connection_limit` explicitly through the `PRISMA_CONNECTION_LIMIT` environment variable.

Documented sizing rule:

`CONNECTIONS_PER_POD = max(10, cpu_count × 4)`

Rationale:

- ADR-091's lease-based scheduler pattern removes the old "hold one DB connection for the full scheduler tick" budget.
- The four background schedulers now consume only short-lived lease and per-candidate transactions.
- User-facing API traffic and read-heavy admin traffic remain the dominant pool consumers, so the pool should be sized for request concurrency rather than for pinned scheduler leaders.

## Runtime truth

Current active config expectations:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_SANDBOX_BASE_URL=http://sandbox:3013`

## Data / contract truth

- authoritative API contract: `packages/contracts/openapi.yaml`
- generated contract artifacts: `packages/contracts/src/generated/*`
- runtime bundle is the active materialized execution artifact
- `platform_site_pages` is the canonical persisted public trust-page model for `/terms`, `/privacy`, `/requisites`, and `/contacts`
- `assistant_files` is the canonical persisted assistant-workspace/file authority on the active path
- ADR-101 Slice 1 unlocks the root assistant cardinality for the next product foundation: one workspace member may own multiple `Assistant` rows, and `WorkspaceMember.activeAssistantId` stores the selected assistant pointer. Existing assistant-scoped runtime/chat/file state remains assistant-id-owned; active assistant resolution and web switcher migration are still later ADR-101 slices.
- ADR-100 Slices 2-5 add explicit web-chat mode truth on `assistant_chats.chat_mode` (`normal | smart | project`). `deep_mode_enabled` remains a compatibility boolean during migration: `smart` and `project` still dual-write `deepMode=true` for old clients, but runtime now branches on `RuntimeTurnRequest.chatMode` so `project` uses its own retrieval-aware execution profile while `smart` keeps the existing deep/premium path. Project chats also emit a project-only visible activity/reasoning feed through additive stream events; these are bounded runtime-authored summaries, not raw hidden chain-of-thought.
- ADR-100 Slice 6B keeps the retrieval architecture PersAI-native and additive: project-mode retrieval ordering is adjusted through a small internal gather-profile hint on the existing runtime-to-API orchestration seam, rather than through a second project retrieval service or a global rewrite of ordinary active-skill behavior.
- ADR-100 Slice 6C/6D/6E completes the core pre-deploy project-file correction without adding a parallel file/knowledge subsystem: the existing `working_files` developer section remains the cheap selector seam, canonical `AssistantFile` / `fileRef` truth now owns lazy cached deep extraction on first use, and project-mode orchestration stages project chat files as a real source before KB while still reusing the shared API-owned extraction stack.
- ADR-100 Slice 6F adds one more bounded pre-deploy file-intelligence seam without changing the public product model: API owns durable `assistant_upload_micro_description_jobs` plus a leased scheduler/worker that can generate a tiny background semantic summary for uploads when deterministic summary is absent. Ordinary non-project/B2C upload analysis is gated by admin runtime boolean `routerPolicy.analyzeUploadsOnB2cUpload` (default `false`), while project mode always enqueues once canonical `fileRef` truth exists. The helper reuses the existing `systemTool` model slot, canonical truth persists on `AssistantFile.metadata.semanticSummary` / `semanticSummarySource` with attachment-metadata mirroring when practical, and the durable job row now also stores replay-safe helper usage (`usageJson`, `usageOccurredAt`) before API appends a non-blocking internal cost-ledger `tool_helper` row keyed by immutable job id. This is still a cheap semantic-anchor path, not parse-every-upload behavior, and it does not change user quota accounting.
- runtime knowledge access now publishes the active bounded `hybrid` retrieval contract
- document source extraction is API-owned shared infrastructure: Knowledge indexing and ADR-097 document generation both use the API `DocumentExtractionService` for local text/PDF/DOCX extraction, provider-backed OCR/parsing, provider trace, and quality metadata. Runtime receives pre-extracted transient `sourceFiles[]` for PDFMonkey/Gamma and must not duplicate Knowledge OCR/provider-selection logic.
- ADR-094 extends the knowledge contract: `knowledge_search` may inline a single short/medium hit (`inlinedDocument` / `inlinedSection` / `documentSummary`); `knowledge_fetch` requires `mode` (`short|section|full`) with optional `radius`. Per-plan volume caps live in `billingHints.retrievalPolicy` (`smartSearchShortDocChars`, `smartSearchMediumDocChars`, `chatSectionDefaultRadius`, `fetchFullModeMaxChars`, `fetchFullModeMaxChatMessages`); admin-owned hard ceilings live in `PlatformRuntimeProviderSettings.adminKnowledgeRetrievalPolicy` (`smartSearchEnabled`, `smartSearchLongDocSummaryChars`, `fetchFullModeAbsoluteMaxChars`, `fetchFullModeAbsoluteMaxChatMessages`). The orchestrated server path applies the same length-based smart inlining for single ready-doc turns.
- Admin Runtime owns the structured provider/model catalog: each provider catalog row carries capabilities, `active` state, token quota weights, and one billing-mode-specific pricing shape that must match the row `billingMode` (`token_metered`, `time_metered`, `fixed_operation`, or `tiered_operation`). Historical rows are archived/inactivated in the same catalog instead of being hard-deleted, while `availableModelsByProvider` remains the derived active chat-model alias for downstream selectors. Plans own quota limits and model-role selections, not provider/model economic weights. Completed native turns still charge the user-facing Credits quota from provider/runtime `usageAccounting.entries` weighted by the catalog rows, with estimator-based accounting only as a marked fallback when runtime usage is missing. ADR-099 Session C now keeps that quota flow unchanged while widening the additive money ledger: ordinary completed web chat and Telegram chat turns with concrete runtime `usageAccounting.entries` append immutable `model_cost_ledger_events` rows for both ordinary main-reply model calls (`chat_main_reply`) and the existing router/classifier system-tool calls already surfaced in `usageAccounting.entries` (`router`), and successful background-task evaluator runs now append a single `background_task` row when the persisted `assistant_background_task_runs.usageJson` snapshot carries concrete provider/model/token facts. Those background-task rows use the persisted run-start timestamp on the durable run row as the pricing timestamp seam, so the same timestamp-matched catalog lookup remains replay-safe without keying cost off a later scheduler completion clock. These rows all preserve the archived pricing context on each event without changing quota semantics. Retrieval-helper/reranker usage is still intentionally excluded because current `knowledge_retrieval_events` persistence does not yet provide a clean replay-safe per-helper source seam. ADR-099 Session D adds the first minimal read-model rollout on top of that proof set: `Admin > Business` now shows last-7-day ledger-backed model cost totals plus purpose/surface splits, and `Admin > Ops` now shows current-quota-period ledger-backed model cost totals plus top provider/model rows for the selected workspace. Both surfaces are explicitly labeled as the current covered ledger set rather than full-platform economics. Media, STT, image, video, and other remaining non-ordinary-chat ledger coverage remains later ADR-099 work. Plans also own monthly media generation/editing unit allowances for `image_generate`, `image_edit`, and `video_generate`; the monthly counter truth is subscription-period scoped, delivery-confirmed, and separate from day-keyed safety counters. Runtime reserves monthly media units before expensive provider work; API delivery settles only successfully delivered artifacts and records provider-output/no-delivery cases as reconciliation-required rather than settled user quota. ADR-087 adds unified finite-limit advisories: 90%-crossing warnings are assistant-authored follow-up messages in the current active surface, free/zero-price plans may receive warnings but not paid light mode, and paid token-budget exhaustion degrades ordinary text turns into the safe `cost_driving_restricted` light-mode path until the current quota period resets rather than surfacing budget-driven slowdown/rate-limit UX as the primary product truth. The follow-up text is grounded from post-turn `quota_status` facts plus workspace-owned `quota_advisory` policy instruction, not from static surface copy. ADR-084 Slice 3 adds PersAI-owned `workspace_payment_intents` before any provider checkout/session call, so checkout starts from persisted PersAI intent truth rather than raw client state. ADR-083 lifecycle policy is PersAI-owned: trusted provider/admin payment inputs are first recorded as billing event snapshots, then they update `WorkspaceSubscription`, after which effective plan resolution, quota/materialization visibility, and lifecycle-derived notifications read the new PersAI state. Trial fallback is plan-owned through `lifecyclePolicy.trialFallbackPlanCode`, paid grace fallback is plan-owned through optional `lifecyclePolicy.paidFallbackPlanCode` with persisted global fallback as the fallback-of-last-resort, and grace duration is persisted in billing lifecycle settings. Effective subscription resolution materializes missing workspace subscriptions from the active default registration plan, assigns real trial/current-period windows for trial registrations, keeps paid access active during grace, and persists fallback/recovery before quota/materialization visibility reads the effective plan.
- Skill, Product KB, and platform/global Knowledge sources are platform/admin-managed shared KBs, not tenant workspace-owned rows. Assistant workspace remains consumer context for private assistant knowledge, assignment validation, memory/chat/files, quota, and retrieval telemetry.
- admin-authored Knowledge entries are Knowledge sources, not Files; ADR-080 defines their draft/review/apply lifecycle before ADR-079 indexing and runtime retrieval
- historical compatibility/migration traces do not define current request-time behavior

## Files truth

ADR-081 defines the active Files target state:

- `AssistantFile` is the canonical durable registry for every user-visible or assistant-reusable file.
- `fileRef` is the canonical PersAI/API file identity for reusable files, but the normal model-visible chat/tool prompt surface uses server-owned human aliases that resolve to `fileRef` inside the runtime.
- chat `attachmentId`, runtime `artifactId`, object-storage `objectKey`, storage path, raw sandbox path, knowledge source id, and retrieval reference id are not primary model-facing file selectors. Raw `fileRef` also must not be injected into normal conversational history text.
- product open/download links use the canonical Files route by `fileRef`; the old attachment download route is not active target-state UI/API truth.
- media storage and sandbox storage are implementation details behind one user Files model.
- Knowledge remains a separate product plane and is not merged into Files.

## Historical material

Historical OpenClaw references may still exist in:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old migrations

Those traces are not part of the active architecture unless a current code/config/deploy path still depends on them.
