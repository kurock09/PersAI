# API Boundary

This document describes the current active PersAI request boundaries.

For exact request and response schemas, use `packages/contracts/openapi.yaml` and the generated client/types in `packages/contracts/src/generated`.

ADR-072 is closed for the active migration baseline through Step 18. Current follow-through after that native-path baseline is tracked in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Public product APIs

Primary public API surface:

- web and admin routes through `apps/api`
- authenticated assistant routes under `/api/v1/assistant/*`
- admin routes under `/api/v1/admin/*`
- admin knowledge routes under `/api/v1/admin/knowledge-sources*`
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

## Knowledge boundaries

### Assistant knowledge

- assistant-owned uploaded knowledge stays under `/api/v1/assistant/knowledge-sources/*`
- request-time `knowledge_search` / `knowledge_fetch` execute through the native runtime knowledge contract
- current active runtime contract publishes `ragMode: "hybrid"` with bounded reference-first fetch semantics

### Admin global knowledge

Current admin knowledge routes are served by `apps/api`:

- `GET /api/v1/admin/knowledge-sources?scope=product|skill`
- `GET /api/v1/admin/knowledge-sources/observability`
- `GET /api/v1/admin/knowledge-sources/connectors?scope=product|skill`
- `POST /api/v1/admin/knowledge-sources/:scope`
- `DELETE /api/v1/admin/knowledge-sources/:sourceId`
- `POST /api/v1/admin/knowledge-sources/:sourceId/reindex`

Active boundary rules:

- admin global-knowledge writes are workspace-scoped and require explicit admin authorization
- workspace knowledge-storage quota is enforced for admin global-knowledge uploads/deletes
- retrieval observability is a durable API surface, not a process-local debug cache

### Internal runtime

Current active internal service endpoints are served by `apps/runtime`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/turns/create`
- `POST /api/v1/turns/stream`

These are internal runtime-service boundaries, not a public legacy gateway surface.

### Sandbox

Current active internal sandbox endpoints are served by `apps/sandbox`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs/:jobId`

These are internal runtime-to-sandbox boundaries for isolated `files` / `exec` / `shell` work, not public product APIs.

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
- `sandbox`

Current ingress truth:

- `persai.dev` -> `web`
- `api.persai.dev` -> `api`
- `bot.persai.dev` `/telegram-webhook` -> `api`

## Historical traces

Historical OpenClaw bridge contracts may still appear in ADRs, changelog entries, session handoff logs, or migrations. They are not active boundary truth unless the current code, chart, or cluster still routes through them.
