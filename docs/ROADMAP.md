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
- [x] H8 — Telegram runtime readiness (end-to-end webhook delivery + group chats)
  - [x] H8a — encrypted bot token storage (`PlatformRuntimeProviderSecretStoreService`, per-assistant key)
  - [x] H8b — materialize Telegram config into `openclawBootstrap.channels.telegram` (token, webhookUrl, HMAC secret, groupReplyMode, parseMode, policy)
  - [x] H8c — OpenClaw Telegram bridge (`persai-runtime-telegram.ts`): dynamic Grammy bot manager, webhook handler, `my_chat_member` group tracking
  - [x] H8d — GKE Ingress for public webhook URL (`bot.persai.dev/telegram-webhook/*`)
  - [x] H8e — Prisma `assistant_telegram_groups` table + internal callback endpoint
  - [x] H8f — UI: Groups section (auto-populated list with status), Group reply mode toggle (mention/reply vs all)
- [ ] H9 — WhatsApp/MAX readiness and secret-ref parity
