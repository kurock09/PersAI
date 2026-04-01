# ROADMAP

## Current phase

Foundation Phase

## Step 1

- [x] Monorepo scaffold
- [x] pnpm workspaces
- [x] apps/web skeleton
- [x] apps/api skeleton
- [x] packages baseline
- [x] infra baseline
- [x] Helm baseline
- [x] local Postgres Docker baseline
- [x] logger/config/request context baseline
- [x] Prisma baseline
- [x] seed baseline
- [x] /health
- [x] /ready
- [x] /metrics
- [x] CI baseline

## Step 2

- [x] Clerk integration
- [x] app_users model
- [x] workspaces model
- [x] workspace_members model
- [x] GET /api/v1/me
- [x] POST /api/v1/me/onboarding
- [x] onboarding idempotency
- [x] protected /app
- [x] onboarding gate
- [x] OpenAPI spec in packages/contracts
- [x] Orval generation
- [x] smoke/e2e flow

## Step 2-1 OpenClaw

- [x] O1 - OpenClaw repo/deploy boundary
- [x] O2 - OpenClaw image build/push automation
- [x] O3 - OpenClaw dev deploy enablement
- [x] O4 - OpenClaw health/runtime verification
- [x] O5 - OpenClaw config/secrets baseline
- [x] O6 - backend-to-OpenClaw integration contract

## Step 3 Assistant Platform Core

- [x] A1 — assistant domain model
- [x] A2 — assistant lifecycle API skeleton
- [x] A3 — draft/publish/version model
- [x] A4 — rollback/reset semantics
- [x] A5 — runtime apply state model
- [x] A6 — assistant governance baseline
- [x] A7 — materialized runtime spec
- [x] A8 — OpenClaw apply/reapply adapter

## Step 4 Assistant User Control Surface

- [x] B1 — assistant dashboard shell
- [x] B2 — assistant editor sections
- [x] B3 — quick start and advanced setup
- [x] B4 — publish/apply UX states
- [x] B5 — rollback/reset UX
- [x] B6 — assistant activity/update markers
- [x] Step 4 closure stabilization (live hybrid validation + client status handling + minimal visual baseline)

## Step 5 Web Chat Core

- [x] C1 — chat domain model
- [x] C2 — web chat backend transport
- [x] C3 — streaming web chat
- [x] C4 — chat list and chat actions
- [x] C5 — active web chats cap
- [x] C6 — chat error/degradation UX

## Step 6 Memory and Tasks Control

- [x] D1 — memory control domain hardening
- [x] D2 — memory center MVP
- [x] D3 — memory source policy enforcement
- [x] D4 — tasks control domain hardening
- [x] D5 — tasks center MVP

## Step 7 Plans, Billing, and Entitlements

- [x] P1 — plan catalog and entitlement model
- [x] P2 — admin plan management UI
- [x] P3 — subscription state and billing abstraction
- [x] P4 — capability resolution engine
- [x] P5 — quota accounting baseline
- [x] P6 — enforcement points
- [x] P7 — user/admin plan visibility

## Step 8 Tools, Channels, and Integrations

- [x] E1 — tool catalog and activation model
- [x] E2 — tool policy and OpenClaw capability envelope
- [x] E3 — channel and surface binding model hardening
- [x] E4 — Telegram connection and delivery surface
- [x] E5 — integrations panel and messenger binding UX
- [x] E6 — provider and fallback baseline

## Step 9 Admin, Audit, and Operations

- [x] F1 — append-only audit log hardening
- [x] F2 — admin RBAC and step-up actions
- [x] F3 — ops cockpit baseline
- [x] F4 — business cockpit baseline
- [x] F5 — admin system notifications
- [x] F6 — progressive rollout and rollback controls

## Step 10 Hardening and Recovery

- [x] G1 — secret lifecycle hardening
- [x] G2 — abuse and rate limit enforcement
- [x] G3 — recovery and ownership transfer flows
- [x] G4 — retention/delete/compliance baseline
- [x] G5 — WhatsApp and MAX readiness hardening

## Step 11 OpenClaw Native Runtime (ADR-048)

- [x] P0–P3 — native PersAI→OpenClaw HTTP runtime: `agentCommandFromIngress` for web sync/stream, persona hydration, `503` fail-fast on missing spec, Redis-backed spec store, SHA pin in `openclaw-approved-sha.txt`, CI validation script

## Step 12 Admin-Driven Runtime Control Plane

- [x] H1 — runtime provider profile baseline (OpenAI + Anthropic, primary/fallback model refs, encrypted credential refs; ADR-050)
- [x] H1a — admin UI for provider profile (structured editor in rollout controls)
- [x] H1b — global provider settings (admin UI for API keys, models, `availableModelsByProvider`; ADR-051)
- [x] H2 — tool credentials and quota limits (8-tool catalog, per-tool daily limits, admin tool credentials UI; ADR-052)
- [x] H2a — tool/plan cleanup (single-source catalog, dead flags removal, per-plan `primaryModelKey` + quota limits, `dailyCallLimit` enforcement)
- [x] H3 — runtime hydration (persona, memory, workspace isolation; ADR-053)
  - [x] H3a — persona: traits/avatar/birthday schema, 7 bootstrap docs, `PERSAI_WORKSPACE_ROOT` + GCS FUSE
  - [x] H3b — memory: OpenClaw memory API, PersAI proxy, Memory Center UI
  - [x] H3c — chat history: message pagination endpoint, UI load-on-open
- [x] H4 — assistant lifecycle audit (create/edit/reset verification)
  - [x] H4a — create: fixed `tone` → `playfulness` trait key mismatch
  - [x] H4b — edit: verified correct (bootstrap write-once preserved)
  - [x] H4c — reset: fixed 3 bugs (traits/avatar copy, stale BOOTSTRAP.md)
  - [x] H4d — UI completeness: action buttons, avatar picker, file upload
- [x] H5 — assistant lifecycle rework (CREATE/EDIT/RESET)
  - [x] H5a — EDIT: single "Save and apply" button
  - [x] H5b — RESET: full wipe (chats, memory, specs, workspace files)
  - [x] H5c — admin-editable bootstrap presets (`{{placeholder}}` templates, admin UI)
- [x] H6 — lazy invalidation for scale (ADR-054, designed for 5 000–10 000 users)
  - [x] H6a — `configGeneration` counter + `configDirtyAt` per-assistant flag
  - [x] H6b — OpenClaw two-tier freshness check (cached generation + PersAI endpoint)
  - [x] H6c — Force Reapply All admin action (step-up protected)
  - [x] H6d — Force Reapply bumps `configGeneration` before re-materialization
- [x] H7 — runtime integration hardening
  - [x] H7a — OpenClaw credential refs dual-format parser (Object + Array)
  - [x] H7b — `AsyncLocalStorage` per-request context (eliminates `process.env` race)
  - [x] H7c — tool catalog rename (`memory_get`, `cron`) + SQL data migration
  - [x] H7d — auto-seed platform data at API startup (`SeedToolCatalogService`)
  - [x] H7e — null-plan governance backfill (legacy assistants get default plan on startup)
- [x] H8 — Telegram runtime readiness (end-to-end delivery + group chats)
  - [x] H8a — encrypted bot token storage (`PlatformRuntimeProviderSecretStoreService`, per-assistant key)
  - [x] H8b — materialize Telegram config into `openclawBootstrap.channels.telegram`
  - [x] H8c — OpenClaw Telegram bridge (`persai-runtime-telegram.ts`): dynamic Grammy bot manager, webhook/polling, group tracking
  - [x] H8d — GKE Ingress for public webhook URL (`bot.persai.dev/telegram-webhook/*`)
  - [x] H8e — Prisma `assistant_telegram_groups` table + internal callback endpoint
  - [x] H8f — UI: Groups section, Group reply mode toggle, Disconnect/Reconnect buttons
  - [x] H8g — polling fallback (no `webhookUrl` → Grammy long polling, no public domain required)
  - [x] H8h — auto-apply on connect/disconnect (immediate OpenClaw spec sync)
  - [x] H8i — Telegram workspace isolation (agent turns use per-assistant `workspaceDir`, shared memory with web chat)
  - [x] H8j — fix `workspaceDir` race condition (`process.env` → `commandInput` passthrough)
  - [x] H8k — fix session `cwd` drift + memory tools workspace: sync `header.cwd` on every turn, route memory reads through `persaiRuntimeRequestContext.workspaceDir`
  - [x] H8l — fix group-update callback: read `baseUrl` from `cfg.secrets.providers["persai-runtime"]` (not nonexistent top-level key)
- [x] H9 — per-request credential isolation (ADR-055, eliminates `process.env` race at 1000+ concurrent users)
  - [x] H9a — extend `PersaiRuntimeRequestCtx` with `toolCredentials` + `getPersaiToolCredential` helper
  - [x] H9b — remove `process.env` mutation from `persai-runtime-agent-turn.ts` (sync, telegram, stream)
  - [x] H9c — patch credential readers (Tavily, Firecrawl, web-fetch) to read from context first
  - [x] H9d — new `plugin-sdk/persai-credential` subpath for extension boundary compliance
  - [x] H9e — systemic credential centralization: replace per-tool `getPersaiToolCredential` with centralized `resolvePersaiToolCredentialForEnvVars` + `withPersaiActiveTool` context wrapper; integrate into `model-auth-env` so all provider auth resolution prioritizes PersAI-injected credentials
  - [x] H9f — fix dead credential paths for `web_search` (Tavily provider selection), `tts` (OpenAI + ElevenLabs), `image_generate`, `web_fetch` (Firecrawl), and `memory_search` embeddings
  - [x] H9g — admin plan UI: expose `toolCostDriving` and `toolCostDrivingQuotaGoverned` flags with descriptive labels in plan management
- [x] H10 — thinking/reasoning UX (stream thinking tokens, collapsible "Thought for Xs" block with fade-out preview)
  - [x] H10a — OpenClaw NDJSON thinking stream for PersAI web runtime
  - [x] H10b — API/Web SSE transport for `thinking` events
  - [x] H10c — web chat Thought block with collapsed preview and duration label
- [x] UI polish — chat scroll, sidebar, avatar upload, Telegram sync
  - [x] UP1 — reverse-paginated chat history (load last 20, lazy-load older on scroll up via IntersectionObserver)
  - [x] UP2 — new chat appears in sidebar immediately on creation
  - [x] UP3 — avatar file upload to workspace (POST/GET endpoints in PersAI API + OpenClaw gateway, replaces blob: URLs)
  - [x] UP4 — Telegram bot profile sync (setMyName, setMyDescription, setMyProfilePhoto on every apply)
- [x] Quota UX and avatar consistency hardening
  - [x] QA1 — quota/capability 409 errors mapped to user-friendly messages (plan limit, feature unavailable)
  - [x] QA2 — reapply/publish POST endpoints return HTTP 200 (was 201); frontend uses `isSuccessStatus` guard
  - [x] QA3 — shared `AssistantAvatar` component (sm/md/lg) replaces all hardcoded Sparkles across chat header, messages, empty state, home dashboard, sidebar
  - [x] QA4 — avatar cache-busting (minute-granularity `?v=` param) + backend `Cache-Control: no-cache, must-revalidate`
  - [x] QA5 — Telegram binding metadata sync on publish (displayName + avatarUrl patched in DB after apply)
  - [x] QA6 — Telegram settings UI shows assistant draft avatar/name instead of stale getMe data
- [x] Streaming quality hardening
  - [x] SQ1 — `res.flush()` after each SSE write (eliminates Node/TCP buffering delay)
  - [x] SQ2 — remove `accumulated` from delta SSE events (O(token) payload instead of O(total))
  - [x] SQ3 — `requestAnimationFrame` batching for `onDelta`/`onThinking` setState (1 render per frame)
- [x] Telegram group deduplication (supergroup migration fix + title refresh on rename)
  - [x] TG1 — backend: on `joined` event, mark stale active records with same title as "left" before upsert
  - [x] TG2 — backend: GET groups deduplicates by title (keeps most recently updated)
  - [x] TG3 — frontend: groups list shows only active groups
- [x] H8-scale — Telegram runtime lifecycle hardening for 1000+ users
  - design note: ADR-057 defines assistant-scoped runtime reconcile and corrected single-assistant freshness semantics
  - rule: user settings changes stay partial/assistant-scoped; broad reapply remains admin/platform-only
  - [x] H8s1 — stop restarting Telegram bots on every no-op `spec apply`; only rotate runtime bot state when token/webhook mode/webhook URL actually changed
  - [x] H8s2 — remove eager `syncBotProfile` from startup/reinit path; run profile sync only after real persona/avatar changes or explicit reconnect
  - [x] H8s3 — persist Telegram runtime/profile fingerprints (`botToken` hash, webhook mode/url, persona hash, avatar hash) so sync decisions are idempotent
  - [x] H8s3.1 — correct `ensure-fresh-spec`: return fresh single-assistant spec for local OpenClaw reconcile instead of backend-side `full apply`
  - [x] H8s4 — add bounded startup/reinit concurrency with jitter/backoff instead of reinitializing all bots at once
  - [x] H8s5 — add cooldown/rate-limit guards for `setMyName` / `setMyDescription` / `setMyProfilePhoto` to prevent Telegram `429` storms
  - [x] H8s6 — keep startup cheap and readiness-safe: defer non-critical Telegram profile work until after gateway becomes ready
  - [x] H8s8 — add runtime session lifecycle control: clear `agent:persai:<assistantId>:*` sessions on assistant reset/recreate, enforce TTL/GC for stale channel sessions, and keep session growth bounded for 1000+ users
  - [x] H8s9 — full session purge on reset/recreate: delete all runtime sessions (`agent:main` + `agent:persai`) for the assistant's workspace and delete per-chat sessions on web chat deletion; policy decision: no archive, full purge
- [ ] H11 — WhatsApp/MAX readiness and secret-ref parity
- [x] H12 — Cron webhook callback + preferred notification channel + memory lifecycle
  - [x] H12a — Prisma: `preferredNotificationChannel` field on assistant model + migration
  - [x] H12b — PersAI API: `POST /api/internal/cron-fire` webhook endpoint (current scope: receives OpenClaw cron callback, updates registry rows, delivers directly to Telegram when the assistant has an active Telegram binding plus a known inbound chat target, otherwise falls back to the dedicated web reminders chat; future WhatsApp/MAX outbound remains outside H12 scope)
  - [x] H12c — OpenClaw `persai-runtime-context.ts`: add `cronWebhookUrl` to request context (PersAI-only file)
  - [x] H12d — OpenClaw `cron-tool.ts`: auto-inject `delivery: { mode: "webhook", to: cronWebhookUrl }` from context (~5 lines, same pattern as toolDenyList)
  - [x] H12e — UI: notification channel toggle in assistant settings (shows only connected channels)
  - [x] H12f — Update `PERSAI-FORK-PATCHES.md` + `verify-persai-patches.mjs` with new patch entry
  - [x] H12g — Memory lifecycle on assistant create/reset: if `MEMORY.md` / `memory/` don't exist → create; if exist → clear. On edit/update — do NOT touch memory (implemented via minimal `openclaw/src/gateway/persai-runtime/*` bridge because pure API-only ownership was not technically viable)
  - [x] H12h — PersAI-owned reminders/tasks replace product dependence on native `cron`: current scope covers internal registry upsert/delete by `externalRef`, hard-delete on assistant reset, one-time disappearance after successful webhook finish, recurring rows staying live with updated `nextRunAt`, new product-facing `reminder_task` tool for create/list/pause/resume/cancel, plan/seed policy that hides user-facing `cron`, PersAI-owned write control-plane (`reminder_task` -> PersAI internal control endpoint -> backend-driven internal cron control via `persai-runtime`), Telegram-safe context-only session lookup during create, and delivery-side stripping of internal `Recent context` artifacts from user-visible reminder messages; future WhatsApp/MAX outbound or a backend-owned timer are separate follow-up work, not H12 blockers
- [x] H13 — Unified messenger turn gateway
  - [x] H13a — single PersAI API entry point for web + Telegram turns, with reminder callback ingress normalized under the same backend error/render family; future WhatsApp/MAX/VK can follow the same PersAI adapter pattern
  - [x] H13b — unified enforcement: quota (tokens, messages), rate limits, and per-tool daily limits now apply across the supported inbound turn surfaces (`web_chat`, `telegram`, `reminder_callback` policy ingress), with runtime tool calls gated through a minimal existing OpenClaw `before_tool_call` seam
  - [x] H13c — human-readable error messages across web, Telegram, and reminder callback delivery now render from the same backend code family
  - [x] H13d — adapter pattern: new messenger = new adapter in PersAI API, OpenClaw stays a thin runtime executor via `/api/v1/runtime/chat/channel`
  - [x] H13e — stable backend error codes replace string-only UX heuristics for shared web/Telegram/reminder-facing failure semantics
## Step 13 Media, Attachments, and Voice (M-series, ADR-059)

- [x] M1 — media foundation (DB model, storage, contracts, cleanup, quota dimension)
  - [x] M1a — Prisma: `assistant_chat_message_attachments` table + `media_storage_bytes` quota extension + migration
  - [x] M1b — `AssistantChatMessageAttachmentRepository` (create, findByMessageIds, findById, deleteByMessageIds, deleteByChatId, deleteByAssistantId)
  - [x] M1c — OpenClaw bridge: workspace media upload/download/delete-chat HTTP handlers (`persai-runtime-media.ts`)
  - [x] M1d — PersAI adapter: `uploadChatMedia`, `downloadChatMedia`, `deleteChatMedia` on `OpenClawRuntimeAdapter`
  - [x] M1e — API endpoints: `POST /assistant/chat/:chatId/message/:messageId/attachment` (multipart) + `GET /assistant/attachment/:attachmentId` (proxy download)
  - [x] M1f — extend message history response with `attachments[]`
  - [x] M1g — extend `hardDeleteChat` with media directory cleanup + attachment row deletion
  - [x] M1h — extend `resetAssistant` transaction with `assistant_chat_message_attachments.deleteMany`
  - [x] M1i — `media_storage_bytes` quota tracking on upload/delete via existing `TrackWorkspaceQuotaUsageService`
  - [x] M1j — `mediaClasses` capability activation from plan entitlements (replace hardcoded false)
  - [x] M1k — contracts: attachment schemas in web chat types
- [x] M2 — tool media delivery (web chat)
  - [x] M2a — OpenClaw bridge: `resolveAgentResponse` returns `{ text, media[] }` from payloads (replaces `resolveAgentResponseText`)
  - [x] M2b — OpenClaw bridge: sync/stream HTTP response includes `media[]`; stream NDJSON emits `media` event after `done`
  - [x] M2c — PersAI adapter: parse `media[]` from sync response and stream events
  - [x] M2d — send/stream services: copy tool media to workspace `media/<chatId>/<messageId>/`, create attachment rows
  - [x] M2e — web UI: `ChatMessageBubble` renders image attachments inline, audio with `<audio>` player, tool_output with appropriate display
  - [x] M2f — web UI: message history load includes attachments
- [x] M3 — web voice messages (send + receive)
  - [x] M3a — web UI: `ChatInput` microphone button + `MediaRecorder` API (opus/webm) + recording UX
  - [x] M3b — upload voice → transcribe via `POST /assistant/voice/transcribe` → receive transcription
  - [x] M3c — OpenClaw bridge: `POST /api/v1/runtime/workspace/media/transcribe` (calls native `transcribeAudioFile`)
  - [x] M3d — PersAI adapter: `transcribeMedia(assistantId, storagePath)` method
  - [x] M3e — turn service: voice recording → STT → transcription as message text + voice attachment uploaded post-turn
  - [x] M3f — web UI: voice message bubbles with audio player + transcription text
- [x] M4 — web file/image upload
  - [x] M4a — web UI: activate paperclip, file picker (images + documents)
  - [x] M4b — web UI: preview chips before send, upload on send (optimistic UI with local blob URLs)
  - [x] M4c — web UI: user message image inline display, audio player, document download cards via `AttachmentStrip`
  - [x] M4d — validation: max file size, allowed MIME types at upload boundary
  - [x] M4e — quota enforcement: `media_storage_bytes` limit tracked via existing quota service
- [x] M5 — Telegram media inbound (voice, photo, document)
  - [x] M5a — OpenClaw bridge: `persai-runtime-telegram.ts` handlers for `message:voice`, `message:photo`, `message:document`
  - [x] M5b — voice handler: Grammy `getFile` → `transcribeAudioFile()` → send transcription to PersAI turn with attachment metadata
  - [x] M5c — photo/document handler: download → store in workspace → send to PersAI turn with attachment metadata
  - [x] M5d — extend `InternalTelegramTurnRequest` and `HandleInternalTelegramTurnService` with attachment fields
  - [x] M5e — persist Telegram inbound media as attachment rows on resulting message records
- [x] M6 — Telegram media outbound (voice, photo, tool results)
  - [x] M6a — OpenClaw bridge: extend Telegram reply handling with `sendPhoto`/`sendVoice`/`sendAudio`/`sendVideo`/`sendDocument` via `deliverTelegramMedia`
  - [x] M6b — tool-generated images → Telegram photo
  - [x] M6c — TTS/voice tool output → Telegram voice note (opus, `audioAsVoice` flag)
  - [x] M6d — all 4 message handlers (text, voice, photo, document) deliver media after text reply
- [x] M7 — Yandex SpeechKit TTS provider
  - [x] M7a — **native OpenClaw**: new `src/tts/providers/yandex.ts` (SpeechKit v1 REST API, oggopus + mp3 output, API-Key + IAM Token auth)
  - [x] M7b — **native OpenClaw**: register `buildYandexSpeechProvider` in `src/tts/provider-registry.ts` + `TTS_PROVIDERS` + `ResolvedTtsConfig.yandex` + secret collector
  - [x] M7c — verify PersAI admin UI Yandex TTS provider selection + credential delivery (already wired via `TOOL_PROVIDER_OPTIONS` + `TOOL_PROVIDER_ENV_FALLBACKS`)

## Step 13.1 Unified Media Pipeline (ADR-060)

- [x] ADR-060: unified media pipeline architecture (preprocessor + delivery + inbound)
- [x] MediaPreprocessorService: audio normalize (webm/ogg→mp3), image normalize (heic→jpg, resize), PDF text extract, video audio STT
- [x] InboundMediaService: unified resolve() replacing per-channel buildAttachmentContext + enrichMessageWithAttachments
- [x] MediaDeliveryService: unified deliver() replacing per-channel persistToolMediaAttachments
- [x] ChannelMediaAdapter interface + WebMediaAdapter + TelegramMediaAdapter
- [x] Refactor StreamWebChatTurnService to use InboundMediaService + MediaDeliveryService
- [x] Refactor SendWebChatTurnService to use InboundMediaService + MediaDeliveryService
- [x] Refactor HandleInternalTelegramTurnService to use InboundMediaService
- [x] Remove duplicated media logic from turn services (~200 lines)
- [x] Module registration with factory-based adapter injection
- [ ] Add WhatsApp adapter (future, when WhatsApp channel is implemented)
- [ ] Add VK adapter (future, when VK channel is implemented)

## Step 14 Tech Debt and Scale

- [ ] H14 — Fork-diff reduction (tech debt, trigger: next upstream sync or stable sprint)
  - [ ] H14a — secrets + tool credentials → `exec` provider + PersAI API bridge (removes 9 native OpenClaw files)
  - [ ] H14b — remove explicit store from `server-runtime-state.ts` (1 file, trivial)
- [ ] H15 — GKE runtime tuning for 5 000+ users
  - scope note: this is a system-wide platform slice, not Telegram-specific hardening
  - [ ] H15a — review and tune Kubernetes probe budgets (`startupProbe`, `readinessProbe`, `livenessProbe`, timeout, `failureThreshold`) from measured rollout/warmup behavior
  - [ ] H15b — validate rollout safety and startup latency budgets for `api`, `web`, and `openclaw` under realistic cold-start and recovery scenarios
- [ ] H16 — Autonomous workspace heartbeat isolation and cheap-model routing
  - scope note: separate main-workspace orchestration from assistant/user-scoped autonomous loops so background polling behavior is explicit and isolated
  - immediate hygiene (landed):
  - [x] H16-hygiene-a — `BOOTSTRAP.md` is now one-time/consumed: deleted from workspace after first successful bootstrap read, re-created only on full reset/recreate
  - [x] H16-hygiene-b — heartbeat/background polling uses a dedicated background session key (`__bg_heartbeat`), separated from user assistant turn sessions
  - [x] H16-hygiene-c — background default-model selection follows PersAI admin global settings (`defaultModelKey`) instead of hardcoded `gpt-4.1`
  - remaining deeper isolation:
  - [ ] H16a — verify which runtime paths still read `HEARTBEAT.md` from the default OpenClaw workspace instead of assistant-scoped `workspaceDir`
  - [ ] H16b — bind heartbeat polling and related autonomous file checks to the correct assistant/user workspace where product behavior is expected per assistant
  - [ ] H16c — document the role of the main/default workspace vs assistant-scoped workspaces so background agent behavior is understandable and debuggable
  - [ ] H16d — route low-value background polling / heartbeat reads to a dedicated cheaper model tier, separate from user-facing turn models
