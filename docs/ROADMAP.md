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
- [ ] B6 — assistant activity/update markers

## Step 5 Web Chat Core

- [ ] C1 — chat domain model
- [ ] C2 — web chat backend transport
- [ ] C3 — streaming web chat
- [ ] C4 — chat list and chat actions
- [ ] C5 — active web chats cap
- [ ] C6 — chat error/degradation UX

## Step 6 Memory and Tasks Control

- [ ] D1 — memory control domain
- [ ] D2 — memory center MVP
- [ ] D3 — memory source policy enforcement
- [ ] D4 — tasks control domain
- [ ] D5 — tasks center MVP

## Step 7 Tools, Channels, and Integrations

- [ ] E1 — tool catalog and capability groups
- [ ] E2 — tool policy and quota envelope
- [ ] E3 — channel and surface binding model
- [ ] E4 — Telegram delivery surface
- [ ] E5 — integration binding baseline
- [ ] E6 — provider and fallback baseline

## Step 8 Admin, Audit, and Operations

- [ ] F1 — append-only audit log
- [ ] F2 — admin RBAC baseline
- [ ] F3 — ops cockpit baseline
- [ ] F4 — business cockpit baseline
- [ ] F5 — system notifications for admins
- [ ] F6 — progressive rollout and rollback controls

## Step 9 Hardening and Recovery

- [ ] G1 — secret lifecycle hardening
- [ ] G2 — abuse and rate limit enforcement
- [ ] G3 — recovery and ownership transfer flows
- [ ] G4 — retention/delete/compliance baseline
- [ ] G5 — WhatsApp-ready channel hardening
- [ ] G6 — MAX-ready surface hardening
