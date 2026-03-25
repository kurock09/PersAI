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

## Step 11 Product Experience and Visual Polish

- [x] **ADR-048 (OpenClaw fork)** — native PersAI runtime HTTP: **P0–P3** on applied-spec path (`agentCommandFromIngress` for web sync/stream; persona `instructions` → `extraSystemPrompt`); no-apply path now fails fast with `503` instead of compat echo so PersAI can surface a degraded runtime honestly. Pin SHA in `openclaw-approved-sha.txt` (update when fork advances); CI `validate-openclaw-persai-runtime.sh`; for multi-replica / restart-safe runtime state, configure the fork with `PERSAI_RUNTIME_SPEC_STORE=redis` and `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL` instead of process memory. Current dev chart also pins OpenClaw default model to `openai/gpt-5.4`, injects `OPENAI_API_KEY` from `persai-openclaw-secrets`, and raises `OPENCLAW_ADAPTER_TIMEOUT_MS` to `15000` for stable web streaming. Deeper workspace→session hydration = ongoing; see [ADR-048](ADR/048-native-openclaw-runtime-from-persai-apply-chat.md).

## Step 12 Admin-Driven Runtime Control Plane

- [x] H1 — platform-admin runtime provider profile baseline (`OpenAI + Anthropic`, assistant-scoped primary/fallback model refs, provider credential refs, no raw secrets in PersAI state, first mutation surface via admin platform rollouts; see `ADR-050`)
- [ ] H2 — tool credential refs baseline (managed tool-provider secret refs without runtime/tool-policy duplication)
- [ ] H3 — runtime hydration depth for persona, memory, tasks/reminders, and tool policy on the native OpenClaw path (continue ADR-048 `P2`)
- [ ] H4 — Telegram runtime readiness alignment against admin-driven runtime profile + managed secret refs
- [ ] H5 — WhatsApp/MAX follow-up readiness and secret-ref parity before later delivery slices
