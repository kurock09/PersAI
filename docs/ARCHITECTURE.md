# Architecture

## System shape

PersAI is a modular monolith control plane plus two internal execution services:

- `apps/api` - public HTTP API, control plane, ingress-facing orchestration
- `apps/web` - product and admin UI
- `apps/runtime` - PersAI-native execution runtime
- `apps/provider-gateway` - internal provider transport boundary

OpenClaw is not part of the active architecture. Historical migration traces remain only in archival documents and old migrations.

## Core boundaries

### Control plane

`apps/api` owns:

- assistants, publish/apply lifecycle, and runtime bundle materialization
- canonical chat/message persistence
- governance, quota, admin, and audit boundaries
- Telegram webhook ingress

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

## Active request path

### Web

1. Browser calls `apps/api`
2. `apps/api` persists canonical state and forwards request-time execution to `apps/runtime`
3. `apps/runtime` calls `apps/provider-gateway`
4. result returns through `apps/api`
5. `apps/api` finalizes canonical message/media/quota state

### Telegram

1. Telegram webhook hits `apps/api`
2. `apps/api` resolves assistant/runtime context
3. request-time execution runs through `apps/runtime`
4. `apps/api` owns delivery and persistence boundaries

## Deploy topology

The active dev namespace `persai-dev` should contain only:

- `api`
- `web`
- `runtime`
- `provider-gateway`

Ingress truth:

- `persai.dev` -> `web`
- `api.persai.dev` -> `api`
- `bot.persai.dev` `/telegram-webhook` -> `api`

## Runtime truth

Current active config expectations:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`

## Data / contract truth

- authoritative API contract: `packages/contracts/openapi.yaml`
- generated contract artifacts: `packages/contracts/src/generated/*`
- runtime bundle is the active materialized execution artifact
- historical compatibility/migration traces do not define current request-time behavior

## Historical material

Historical OpenClaw references may still exist in:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old migrations

Those traces are not part of the active architecture unless a current code/config/deploy path still depends on them.
