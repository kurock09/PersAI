# API Boundary

This document describes the current active PersAI request boundaries.

For exact request and response schemas, use `packages/contracts/openapi.yaml` and the generated client/types in `packages/contracts/src/generated`.

## Public product APIs

Primary public API surface:

- web and admin routes through `apps/api`
- authenticated assistant routes under `/api/v1/assistant/*`
- admin routes under `/api/v1/admin/*`
- Telegram webhook under `/telegram-webhook/*`

## Runtime-related boundaries

### Runtime preflight

- public API route: `GET /api/v1/assistant/runtime/preflight`
- owner: `apps/api`
- current behavior: checks PersAI-native runtime `/health` and `/ready` through `PERSAI_RUNTIME_BASE_URL`

### Web chat

- sync route: `POST /api/v1/assistant/chat/web`
- stream route: `POST /api/v1/assistant/chat/web/stream`
- current active mode: native-only
- `apps/api` owns canonical message persistence, replay semantics, quota/media bookkeeping, and user-facing response shaping
- `apps/runtime` owns request-time execution

### Internal runtime

Current active internal service endpoints are served by `apps/runtime`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/turns/create`
- `POST /api/v1/turns/stream`

These are internal runtime-service boundaries, not a public legacy gateway surface.

### Provider gateway

Current active internal service endpoints are served by `apps/provider-gateway`:

- `GET /health`
- `GET /ready`
- provider text generation/streaming endpoints consumed by `apps/runtime`

## Secret and credential flow

Current active secret split:

- `persai-api-secrets`: API/web/database/admin secrets
- `persai-runtime-secrets`: runtime/provider-gateway secrets and provider API keys

Current runtime/provider path:

1. `apps/api` resolves the active runtime bundle and forwards request-time execution to `apps/runtime`
2. `apps/runtime` uses `apps/provider-gateway` for provider calls
3. `apps/provider-gateway` uses platform-managed secret wiring from `persai-runtime-secrets`

## Deploy truth

Current active deploy surface in `persai-dev`:

- `api`
- `web`
- `runtime`
- `provider-gateway`

Current ingress truth:

- `persai.dev` -> `web`
- `api.persai.dev` -> `api`
- `bot.persai.dev` `/telegram-webhook` -> `api`

## Historical traces

Historical OpenClaw bridge contracts may still appear in ADRs, changelog entries, session handoff logs, or migrations. They are not active boundary truth unless the current code, chart, or cluster still routes through them.
