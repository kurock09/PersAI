# ROADMAP

## Current phase

Step 15 — Tiered OpenClaw runtime and production hardening

Scaling-readiness control layer is now tracked by:
- `docs/ADR/070-scaling-readiness-program-and-clean-delivery-discipline.md`
- `docs/SCALING-READINESS-PLAN.md`
- current active slice: `SR9` (Billing and quota correctness under concurrency)
- next recommended slice after `SR9`: `SR10` (Capacity validation and production gate)
- last closed slice: `SR8` (Webhook and realtime burst hardening, closed 2026-04-06 after bounded live replay validation across web, reminders, and Telegram with accepted residual on one stale Telegram binding state that required manual rebind and whose exact historical cause was not isolated)

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
  - [x] H8s10 — Telegram SaaS hardening: owner-only DM default, owner claim deep-link onboarding, honest `claim_required|connected|invalid_token` state, duplicate `update_id` dedupe, and terminal Telegram auth failure handling
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
  - [x] M7c — fix TTS provider selection: PersAI admin `providerId` now propagated to OpenClaw `getTtsProvider()` via `toolProviderOverrides` in runtime context (credential delivery was already wired, but provider selection was broken — always defaulted to OpenAI)

## Step 13.1 Unified Media Pipeline (ADR-060)

- [x] ADR-060: unified media pipeline architecture (preprocessor + delivery + inbound)
- [x] MediaPreprocessorService: audio normalize (webm/ogg→mp3), image normalize (heic→jpg, resize), PDF text extract, video audio STT
- [x] InboundMediaService: unified resolve() replacing per-channel buildAttachmentContext + enrichMessageWithAttachments
- [x] MediaDeliveryService: unified deliver() replacing per-channel persistToolMediaAttachments
- [x] ChannelMediaAdapter interface + WebMediaAdapter + TelegramMediaAdapter
- [x] Delivery boundary clarified: PersAI owns media preprocessing, persistence, and orchestration; Telegram Bot API sends still execute in the OpenClaw bridge from turn response media payloads
- [x] Refactor StreamWebChatTurnService to use InboundMediaService + MediaDeliveryService
- [x] Refactor SendWebChatTurnService to use InboundMediaService + MediaDeliveryService
- [x] Refactor HandleInternalTelegramTurnService to use InboundMediaService
- [x] Remove duplicated media logic from turn services (~200 lines)
- [x] Module registration with factory-based adapter injection

## Step 14 Tech Debt, Scale, and Platform Hardening

- [x] H16-hygiene — Autonomous workspace immediate hygiene (landed)
  - [x] H16-hygiene-a — `BOOTSTRAP.md` is now one-time/consumed: deleted from workspace after first successful bootstrap read, re-created only on full reset/recreate
  - [x] H16-hygiene-b — heartbeat/background polling uses a dedicated background session key (`__bg_heartbeat`), separated from user assistant turn sessions
  - [x] H16-hygiene-c — background default-model selection follows PersAI admin global settings (`defaultModelKey`) instead of hardcoded `gpt-4.1`
- [x] S14a — Assistant persona identity hardening
  - [x] S14a1 — persistent `assistantGender` field (`male` / `female` / `neutral`): schema (`draft_assistant_gender`, `snapshot_assistant_gender`), API (create/edit/publish/preview), UI (setup wizard + settings)
  - [x] S14a2 — remove `other` from gender options; `normalizeAssistantGender` centralizes validation
  - [x] S14a3 — bootstrap template `{{assistant_gender_line}}` placeholder in `SOUL.md` / `IDENTITY.md` presets + SQL migration + admin preset editor update
  - [x] S14a4 — personality description free-text field in creation wizard (parity with edit flow)
  - [x] S14a5 — avatar `blob:` URL client-side cache (`AVATAR_BLOB_CACHE`) — eliminates re-fetch on every mount
- [x] S14b — Runtime-backed setup preview
  - [x] S14b1 — `PreviewAssistantSetupService`: backend-owned transient materialization for wizard last-page preview (no persistent side effects)
  - [x] S14b2 — `POST /api/v1/assistant/setup/preview` endpoint + ClerkAuthMiddleware route registration
  - [x] S14b3 — robust token refresh in setup wizard (fresh token per API call in `persistDraftForPreview`)
- [x] S14c — Admin Ops Cockpit v2
  - [x] S14c1 — user directory: `GET /api/v1/admin/ops/users` (paginated, searchable), `AdminOpsUserDirectoryService`
  - [x] S14c2 — user-scoped cockpit view: `GET /api/v1/admin/ops/cockpit?userId=` loads any user's cockpit data
  - [x] S14c3 — per-user reapply: `POST /api/v1/admin/ops/users/:userId/reapply`
  - [x] S14c4 — full user delete: `DELETE /api/v1/admin/ops/users/:userId`, `AdminDeleteUserService` (cascade across all tables + OpenClaw runtime workspace reset), self-delete protection
  - [x] S14c5 — compact 3+2 column layout, truncated UUIDs, dynamic header
- [x] S14d — OpenClaw TTS refactor: remove directive pipeline, switch to tool-call-only path
  - [x] S14d1 — strip `resolveAgentResponseWithTts`, `normalizeTtsDirectives`, `stripTtsDirectives`, `createTtsDeltaStripper`, `flushTtsDeltaStripper` from `persai-runtime-agent-turn.ts`
  - [x] S14d2 — remove `outputDir` pass-through from `maybeApplyTtsToPayload`
  - [x] S14d3 — set `tts.auto: "off"` in `values-dev.yaml`
- [x] S14e — Bug fixes
  - [x] S14e1 — `Session expired` on preview: missing `ClerkAuthMiddleware` route for `POST /api/v1/assistant/setup/preview`
  - [x] S14e2 — `formality` slider inconsistency (trait key mismatch in setup wizard)
  - [x] S14e3 — MIME type normalization: strip `;charset=…` parameters in `MediaPreprocessorService`
  - [x] S14e4 — user data prefill (birthday, gender, timezone) during assistant recreation
- [x] S14f — UI/UX MVP polish
  - [x] S14f1 — mobile chat UX: responsive sidebar (hamburger toggle), touch-friendly message bubbles, bottom-anchored input, safe-area padding
  - [x] S14f2 — auto chat naming: new chats derive title from first ~50 characters of user's initial message (backend `PrepareAssistantInboundTurnService`)
  - [x] S14f3 — custom authentication UI: fully custom sign-in, sign-up, SSO callback, and profile pages using Clerk hooks (`useSignIn`, `useSignUp`, `useUser`, `useClerk`) replacing all prebuilt Clerk components
  - [x] S14f4 — Clerk theme integration: `ClerkProvider` `appearance` prop wired to CSS variables (`--accent`, `--surface-raised`, etc.) + safety-net CSS overrides for full visual consistency
  - [x] S14f5 — color theme refinements: warm green accent palette, improved dark/light mode contrast, resolved "muddy" dark theme and light code-block visibility issues
- [x] S14g — i18n localization (EN + RU)
  - [x] S14g1 — `next-intl` infrastructure: `i18n/request.ts` (locale detection via cookie → Accept-Language → fallback), `NextIntlClientProvider` in root layout, `next.config.ts` plugin
  - [x] S14g2 — `messages/en.json`: ~300+ strings organized by namespace (landing, auth, chat, sidebar, home, setup, settings, telegram, profile, persona, errors, common)
  - [x] S14g3 — `messages/ru.json`: product-quality Russian copy (friendly "ты" tone, clear CTAs, soft error messages, adapted trait/gender labels)
  - [x] S14g4 — string migration: all user-facing components migrated to `useTranslations`/`getTranslations` with `t()` calls (auth, chat, sidebar, home, setup wizard, settings, telegram, profile, app-shell)
  - [x] S14g5 — `assistant-persona.ts` refactored to provide translation keys (`labelKey`, `labelLeftKey`/`labelRightKey`) instead of hardcoded English strings
  - [x] S14g6 — language switcher: Globe icon in sidebar, EN/RU dropdown, `persai-locale` cookie persistence

## Step 15 Tiered OpenClaw Runtime and Production Hardening (ADR-063)

- [x] R15a — docs-first runtime program alignment
  - [x] ADR-063: one combined program for shared-runtime hardening + tiered routing
  - [x] detailed execution plan: `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
  - [x] architecture / roadmap / test-plan alignment without deepening one-runtime legacy assumptions
- [x] R15b — shared runtime production hardening baseline
  - [x] explicit deny-by-default user-facing tool surface for PersAI runtime turns
  - [x] explicit OpenClaw sandbox/workspace-access/resource limits in Helm/config
  - [x] internal runtime/network boundary hardening in GKE before paid rollout
  - [x] split public API traffic from internal runtime endpoints so `api/v1/internal/*` no longer shares the same externally reachable service/port
  - [x] enforce API ingress `NetworkPolicy` after trusted public ingress CIDRs are explicitly configured
  - [x] add repeatable `shared-runtime:readiness` gate so prepared hardening baseline is validated before rollout
  - [x] split runtime auth into distinct inbound `OPENCLAW_GATEWAY_TOKEN` vs outbound `PERSAI_INTERNAL_API_TOKEN`
  - [x] add repeatable `networkpolicy:readiness` gate so CIDR-dependent rollout is checked before auto-sync deploy
  - [x] document one canonical pre-prod merge gate for agents/operators before CIDR-dependent auto-sync rollout
  - [x] add required `PERSAI_INTERNAL_API_TOKEN` to secret source-of-truth and verify it reached Kubernetes before delivery
- [x] R15c — OpenClaw fork audit automation
  - [x] code-first fork inventory from `persai-fork-base..HEAD`
  - [x] invariant checks for high-risk native patches beyond `docs/PERSAI-FORK-PATCHES.md`
  - [x] CI/agent gate for undocumented or unverified high-risk drift
  - [x] canonical upstream merge gate command for agents/operators
  - [x] targeted runtime/security smoke pack linked after the gate
  - [x] clear current strict-gate blockers by documenting or removing undocumented high-risk fork files (`src/config/zod-schema.core.ts`, `src/secrets/configure.ts`)
- [x] R15d — runtime assignment control plane
  - [x] runtime tier model with plan defaults and admin overrides
  - [x] UI selects runtime policy/isolation level, not pod/service topology
  - [x] materialization emits resolved runtime assignment state (`plan default -> override -> effective tier`)
  - [x] no new admin/runtime flow may assume one permanent global runtime endpoint
- [x] R15e — GKE tiered runtime pools
  - [x] per-tier deployment/service/config scaffolding with explicit pool services and direct tier URLs
  - [x] `free_shared_restricted`
  - [x] `paid_shared_restricted`
  - [x] `paid_isolated`
  - [x] per-tier deployment/service/config/network readiness while keeping one PersAI control plane
  - [x] sandbox activation gate: sandbox-enabled pools launch with real Docker-backed runtime paths, preload published `openclaw-sandbox*` images via Workload Identity/GAR reader, mirror bind-source workspace paths into `docker-dind`, and are live-verified on web + Telegram after fresh pod rollout
  - [x] bounded rollback + explicit removal slice for temporary compatibility routing
- [x] R15f — adapter/runtime router
  - [x] remove the single-runtime assumption from the OpenClaw adapter boundary
  - [x] route apply/chat/stream/channel turns to the correct runtime tier without breaking existing users
- [x] R15g — clean migration and cutover
  - [x] test users migrate directly to the tiered model with repeatable live proof from materialized `effectiveTier` plus adapter `runtime_route` logs
  - [x] do not preserve new legacy around “single shared runtime forever”; live cutover checks identify the actual pool host used for runtime bridge calls and sandbox-capable shared pools recover automatically after fresh pod rollout

---

## Pending / Future

- [x] K16 — Post-R15 security governance and admin control-plane hardening
  - [x] K16a — separate plan-managed vs hidden-internal tool policy truth so runtime materialization, admin plan API, and user-visible tool docs no longer rely on the old raw activation rows alone
    - Admin plans now expose the same three-way tool policy split the control plane uses internally: editable `plan_managed`, read-only always-on `platform_managed`, and read-only `hidden_internal`.
    - `persai_workspace_attach` and `persai_tool_quota_status` are now cataloged as `platform_managed` system tools, existing plans are backfilled with non-plan-managed activation rows, and ordinary plan mutations still reject attempts to edit them.
  - [x] K16b — add graceful model fallback on limit exhaustion instead of hard chat shutdown
    - [x] web/telegram inbound turns now resolve `cost_driving_restricted` through materialized runtime routing truth and can degrade to the safe fallback model path instead of hard-failing the chat turn
    - [x] admin plans no longer expose `Cost tool units` as a product-facing edit field; only `tokenBudgetLimit` remains in the ordinary plan UI/API surface
    - [x] runtime transport/UI now surfaces fallback-mode metadata so chat can show a neutral degraded marker instead of pretending the turn used the normal path
  - [x] K16c — expand Ops Cockpit for full-width operator workflow plus assistant-level test plan override/reset
    - `Ops Cockpit` now uses a wider operator layout and shows the assistant effective-plan block directly in the cockpit state.
    - Added assistant-level test plan override/reset flow (`assistant_plan_override`) as a control-plane seam on `assistant_governance`, without mutating workspace billing rows.
    - Effective subscription/materialization precedence is now `workspace subscription -> assistant override -> assistant fallback -> catalog default -> none`, so tester overrides reach runtime truth and not only the admin UI.
  - [x] K16d — file hardening baseline: dangerous extension denylist, stricter binary upload path, and aligned write/upload size rules
    - `PersAI` upload/stage/transcribe/channel-ingress now pass through one shared media security policy instead of separate MIME-only checks.
    - dangerous executable/script extensions are blocked, and raw `application/octet-stream` no longer passes the ordinary allow path unless a safe type can be verified.
    - `persai_workspace_attach` and OpenClaw runtime media upload now enforce the same class of file hardening on the runtime side, reducing bypass paths through workspace files/tool output.
    - tool-output persistence now validates downloaded artifacts before re-uploading them into runtime storage, and the API upload endpoints now share the same max-size constant as the media policy layer instead of carrying separate hardcoded limits.
  - [x] K16e — explicit per-tier security matrix for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`
    - PersAI now has a code-backed runtime tier security matrix (`admin/runtime` read-only surface + contract state) instead of relying on scattered Helm/doc assumptions.
    - All three product tiers now declare the same restricted built-in deny baseline, `sandbox.mode=all` / `scope=session` / `network=none` / `readOnlyRoot=true`, `exec` only inside sandbox, and `write` only inside the sandbox workspace boundary.
    - `reminder_task` remains the only plan-managed service tool in the matrix, `cron` stays hidden-internal, and `persai_workspace_attach` plus `persai_tool_quota_status` are called out as always-on platform-managed tools across tiers.
    - Dev Helm runtime wiring now also reflects that matrix honestly for sandbox sessions: the sandbox tool allowlist includes the actual PersAI product/service tools instead of collapsing to the OpenClaw coding-only default, and the Docker sandbox user is pinned to `0:0` so rootless `docker:dind` plus GCS FUSE workspaces no longer leave `write`/`edit` failing with live `Permission denied`.
    - Live cluster deploy verified 2026-04-05: `helm template | kubectl apply` + pod rollout restart confirmed the full tool surface (all product/service tools) appears in fresh sessions. No OpenClaw source patches were needed.
  - [x] K16f — user-facing tariff and usage UX aligned with the new plan model
    - sidebar now shows current tariff plus token usage instead of the old chat-only progress bar
    - assistant settings keep only token/chat usage bars and list active per-tool daily limits from the effective plan
    - user-facing UI no longer reinforces the old `Cost tool units` product model
  - [x] K16g — production security audit and hardening (ADR-065, ADR-066, ADR-067, ADR-069)
    - [x] ADR-065 (Wave 1): openclaw container securityContext locked (readOnlyRootFilesystem, runAsNonRoot, drop ALL caps). Per-tier resource limits (CPU/RAM/ephemeral/PIDs). Egress NetworkPolicy for all openclaw pods.
    - [x] ADR-066: Telegram webhook tier-aware proxy through PersAI API, removing hardcoded ingress to free_shared pool.
    - [x] ADR-067: media storage quota enforcement, per-peer Telegram rate limit, draft input validation (maxLength + avatarUrl https), NetworkPolicy covering all pools.
    - [x] ADR-069: workspace storage quota enforcement (write + exec guard with cached du, default 500 MB). dind privileged canary attempted then reverted (GKE COS doesn't support rootless dind without privileged). Admin UI workspace storage field per plan.
    - [x] Cross-assistant file isolation (Wave 2): workspace media path no longer falls back to global root.
    - [x] GKE autoscaling enabled for runtime node pool.
- [ ] H11 — WhatsApp/MAX follow-through: extend the current readiness model with Telegram-parity managed `secret_refs`, rotation/revoke flow, and runtime materialization when those channels ship
- [ ] Channel media adapters: WhatsApp, VK, Matrix — add one `*MediaAdapter` plus module registration when each channel ships, and align channel enum/contracts with Matrix if it remains in scope
- [ ] TTS admin advanced settings UI: expose provider-specific voice/model controls in PersAI admin (OpenAI first); current runtime behavior uses provider defaults and gender-based mapping, not the old `[[tts:voice=...]]` directive path
- [ ] H14 — Fork-diff reduction (tech debt follow-up inside Step 15 runtime program)
  - [ ] H14a — migrate secret refs and tool credential injection away from native `source: "persai"` plumbing toward a generated `exec` provider + PersAI API bridge, reducing dedicated PersAI secret-provider fork surface in OpenClaw core
  - [ ] H14b — remove duplicate explicit spec-store wiring from `server-runtime-state.ts` and update the fork verification scripts that currently assert that patch
  - [ ] H14c — stop deepening PersAI-specific native secret configuration UX; prefer PersAI-owned admin/config generation paths
  - [ ] H14d — prefer plugin-sdk/helper seams and PersAI-owned bridge tools before adding new native runtime patches
- [ ] H15 — GKE runtime tuning for 5 000+ users (execution follow-up inside Step 15 runtime program)
  - [x] H15a — tune sandbox-capable pool startup budget from measured preload/warmup behavior; API/web probes already live in Helm values, while broader OpenClaw readiness/liveness parity remains follow-up work
  - [ ] H15b — validate rollout safety and cold-start/recovery latency for `api`, `web`, and tiered `openclaw` pools with repeatable operational checks
- [ ] SR0 — Scaling readiness documentation/control baseline
  - [x] ADR-070 accepted as umbrella governance for scaling-readiness, evidence-first delivery, and clean-delivery rules
  - [x] `docs/SCALING-READINESS-PLAN.md` created as central execution-plan source-of-truth for Cursor-agent slices
  - [x] roadmap/test-plan/changelog/session-handoff aligned to the new program baseline
- [x] SR1 — Platform baseline and observability
  - closed with: honest API readiness, dependency/request/latency metrics, and explicit `SR1` deploy-observation + alert + OpenClaw probe/log baseline (`docs/SR1-OBSERVABILITY-BASELINE.md`)
- [x] SR2 — GKE production baseline
  - closed with: explicit workload rollout truth for `api`, `web`, and OpenClaw pools; enabled bounded disruption/placement baseline for `api` and `web` (`replicas=2`, `PDB`, topology spread); and explicit-but-disabled autoscaling assumptions so infra defaults are no longer implicit
- [x] SR3 — API concurrency and dependency hardening
  - closed with: bounded API correctness fixes for chat-thread creation races, OpenClaw preflight burst pressure, duplicate in-process Prisma clients, distributed `peerKey` abuse throttling, and atomic distributed registration of user/assistant abuse counters under contention
  - `SR3b`: adapter preflight now uses short TTL caching plus in-flight dedup per runtime tier, reducing burst-time dependency pressure from repeated `/healthz` + `/readyz` checks on nearby runtime calls
  - `SR3c`: API no longer opens two separate Prisma clients/pools for identity-access vs workspace-management in the same process; workspace-management now aliases the shared Prisma singleton
  - `SR3d`: peer abuse throttling for `peerKey`-based inbound paths is no longer process-local memory only; the peer counter now persists and increments atomically in Postgres so the touched Telegram path keeps the same guard across API replicas
  - `SR3e`: user/assistant abuse counters no longer rely on `find -> compute -> upsert` under burst; registration now runs through a serializable Postgres transaction with retry on contention
- [x] SR4 — OpenClaw runtime throughput and multi-replica correctness
  - closed with: explicit single-replica production runtime contract for OpenClaw (`single_replica`, one pod per runtime pool, `Recreate` rollout only), explicit prohibition of multi-replica session mode, and honest identification of the shared global active-turn lane as the current throughput ceiling
  - `SR4a`: runtime readiness now treats PersAI `multi_replica` session mode as not yet supported by code: Redis-backed apply/spec storage is necessary metadata sharing, but session store continuity, workspace continuity, execution ordering, and restart handoff remain unproven across replicas
- [x] SR5 — Sandbox and dind capacity hardening
  - closed with: parallel sandbox image preload (SR5a), per-tier dind contention evidence (SR5b), cross-pool isolation confirmation, predictable linear degradation under sandbox-heavy bursts
  - `SR5a`: sandbox startup path optimization — parallel docker pulls with retry, progress logging, ~5-7 min deploy-gap reduction
  - `SR5b`: dind contention baseline — 4× concurrent sandbox CPU saturation measured on all tiers, linear degradation confirmed, pod stability proven, cross-pool isolation verified
- [x] SR6 — Storage and workspace path hardening
  - [x] `SR6a` — workspace quota cache invalidation parity for sandbox `remove` / `rename`, plus docs drift cleanup for truthful `SR6` boundaries vs `SR7`/`SR9`
  - [x] `SR6b` — mid-exec workspace quota watch for oversized single-command writes, plus docs correction after live 17 GB burst evidence
  - [x] `SR6c` — workspace quota measurement fail-safe semantics for `du` failure / malformed output
  - [x] `SR6d` — first-poll quota watch tightening after live evidence that one `800 MB` write could still complete against a `700 MB` quota and only block follow-up commands
  - [x] `SR6e` — known file-mutation quota cache delta accounting reduced avoidable post-mutation `du -sb` pressure on ordinary file-mutation paths
  - [x] `SR6f` — oversized writes are operationally bounded near quota, user-visible quota failure is preserved, and cleanup remains allowed; strict ideal `dd` exit-code semantics are accepted residual risk rather than a blocker
- [x] SR7 — Media pipeline capacity hardening
  - [x] `SR7a` — PersAI-owned STT ingress paths now use per-request transient scratch directories instead of the shared `_stt_tmp` / `_voice_tmp` paths, and `/metrics` now exposes bounded stage-level signals for touched media-heavy paths so the first `SR7` deploy has an honest observation surface
  - [x] `SR7b` — web staged uploads now emit the same bounded media-stage visibility model through `web_stage_attachment`, so web image/file upload observation is no longer outside the shared `SR7` metrics surface
- [x] SR8 — Webhook and realtime burst hardening
  - [x] `SR8b` — combined Telegram/web/reminder replay closure package
- [ ] SR9 — Billing and quota correctness under concurrency ← **active slice**
  - [ ] `SR9a` — assistant plan override propagation ← pending auth fix deploy + re-test
  - [x] `SR9b` — token budget atomic accounting (closed: live-validated 2026-04-07)
  - [x] `SR9c` — media storage quota atomicity + dual quota pre-check (closed: live-validated 2026-04-07)
  - [x] `SR9d` — active web chats cap race-safe creation (closed: live-validated 2026-04-07)
  - [ ] `SR9e` — workspace subscription sync propagation ← pending auth fix deploy + re-test
  - [x] `SR9f` — tool daily quota check-vs-consume (closed: live-validated 2026-04-07)
- [ ] SR10 — Capacity validation and production gate
- [ ] H16 — Autonomous workspace heartbeat deeper isolation
  - note: the immediate hygiene slice above is complete; the remaining H16 work is the deeper isolation/refactor track
  - scope note: separate main-workspace orchestration from assistant/user-scoped autonomous loops so background polling behavior is explicit and isolated
  - [ ] H16a — verify which heartbeat/autonomous paths still read `HEARTBEAT.md` via the default agent workspace (`resolveAgentWorkspaceDir`) instead of the PersAI assistant-scoped `workspaceDir`
  - [ ] H16b — bind heartbeat polling and related autonomous file checks to the correct assistant/user workspace where product behavior is expected per assistant
  - [ ] H16c — document the role of the main/default workspace vs assistant-scoped workspaces so background agent behavior is understandable and debuggable
  - [ ] H16d — route low-value background polling / heartbeat reads to a dedicated cheaper model tier, separate from user-facing turn models
