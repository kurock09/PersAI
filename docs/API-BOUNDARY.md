# API Boundary

This document describes the current active PersAI request boundaries.

For exact request and response schemas, use `packages/contracts/openapi.yaml` and the generated client/types in `packages/contracts/src/generated`.

ADR-072 is closed for the active migration baseline through Step 18. Current follow-through after that native-path baseline is tracked in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Public product APIs

Primary public API surface:

- web and admin routes through `apps/api`
- authenticated assistant routes under `/api/v1/assistant/*`
- Voice DNA assistant read route: `GET /api/v1/assistant/persona-archetypes`
- admin routes under `/api/v1/admin/*`
- Voice DNA admin routes: `GET /api/v1/admin/persona-archetypes`, `PATCH /api/v1/admin/persona-archetypes/:key`, `POST /api/v1/admin/persona-archetypes/:key/reset-to-default`
- admin knowledge routes under `/api/v1/admin/knowledge-sources*`
- admin runtime-provider settings expose both the legacy chat-model alias `availableModelsByProvider` and the capability-aware `availableModelCatalogByProvider` (`chat`, `image`, `video` per provider). Plan admin payloads may select `primaryModelKey`, `imageGenerateModelKey`, `imageEditModelKey`, and `videoGenerateModelKey`; media model keys are validated against the runtime-provider catalog during plan writes and materialized into runtime tool credential refs.
- single-batch web bootstrap: `GET /api/v1/app/bootstrap` (ADR-076 Slice 3) — bearer-protected, fans out to assistant lifecycle, web chats, telegram integration, notification preference, user plan visibility, and admin plan visibility via `Promise.allSettled`; each section is `{ ok: true, data } | { ok: false, error }` so partial failures don't block the rest. Called once during SSR by `apps/web/app/app/layout.tsx`; mutations still use the per-endpoint refresh paths
- Telegram webhook under `/telegram-webhook/*`

### Avatar pipeline (ADR-076 Slice 4)

- upload (public): `POST /api/v1/assistant/avatar` — bearer, multipart; returns `{ avatarUrl: "/api/avatar/<hash>.<ext>" }` where `<hash>` is a 16-char SHA-256 prefix of the bytes
- read (internal): `GET /api/v1/assistant/avatar/:hash` — bearer-only, called server-side by the `apps/web` BFF route handler; validates `:hash` against the assistant's current `draftAvatarUrl` and returns 404 on mismatch (no stale-content leak)
- web BFF (cookie-auth): `apps/web/app/api/avatar/[hash]/route.ts` — Clerk cookie session → server-side `auth().getToken()` → upstream fetch → streams bytes with `Cache-Control: private, max-age=31536000, immutable` and `ETag: "<hash>"`. Browsers/CDNs cache by URL, so a new upload (new hash → new URL) is automatically cache-busted.
- lifecycle envelope: `assistant.draft.avatarUrl` and `assistant.published.avatarUrl` always emit the content-addressed form `/api/avatar/<hash>.<ext>`. Legacy absolute URLs persisted in dev databases are sanitised to `null` so the UI falls back to the emoji avatar until re-uploaded — no transitional dual-mode shape.

## Runtime-related boundaries

### Runtime preflight

- public API route: `GET /api/v1/assistant/runtime/preflight`
- owner: `apps/api`
- current behavior: checks PersAI-native runtime `/health` and `/ready` through `PERSAI_RUNTIME_BASE_URL`

### Web chat

- sync route: `POST /api/v1/assistant/chat/web`
- stream route: `POST /api/v1/assistant/chat/web/stream`
- stream reattach route: `GET /api/v1/assistant/chat/web/turns/:clientTurnId/stream`
- hard-stop route: `POST /api/v1/assistant/chat/web/stop` (body: `{ "clientTurnId": string }`, response: 204)
- turn-status route: `GET /api/v1/assistant/chat/web/turns/:clientTurnId` returns the durable logical-turn state (`unknown`, `accepted`, `running`, `completed`, `failed`, `interrupted`) plus committed user/assistant payloads where available; web/Capacitor clients use it before retrying ambiguous sends
- web chat list/bootstrap rows expose compact `activeTurn` state, and `GET /api/v1/assistant/chats/web/:chatId/messages` returns committed history plus full `activeTurn`; clients render this server projection as continuity truth before falling back to local recovery hints
- current active mode: native-only
- `apps/api` owns canonical message persistence, replay semantics, quota/media bookkeeping, and user-facing response shaping
- `apps/runtime` owns request-time execution
- SSE socket close on the stream route does **not** abort the runtime turn. Only an explicit POST to the hard-stop route flips the runtime's abort signal. A passive disconnect (tab background, screen lock, network drop) lets the runtime finish, persists the full assistant message, and is recoverable on next history fetch — see ADR-073 § "Slice 1.2 — server-side soft-detach" for rationale.
- The web client performs a best-effort latest-history refresh on `focus`, `visibilitychange` back to visible, and `pageshow`, so a passive disconnect that already committed server-side is reconciled without requiring a manual page reload.
- the hard-stop route is idempotent and returns 204 whether or not a matching in-flight turn exists; the client treats it as fire-and-forget
- attachment staging under `POST /api/v1/assistant/chat/web/stage-attachment` accepts `clientTurnId` and `clientAttachmentId`; repeated staging for the same logical attachment returns the existing canonical staged attachment instead of creating a duplicate bubble

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

### Internal runtime → API back-channel

Current active internal `runtime → api` endpoints (served by `apps/api` on the dedicated `API_INTERNAL_PORT=3002` listener, gated by `PERSAI_INTERNAL_API_TOKEN`):

- `POST /api/v1/internal/runtime/memory/hydrate-for-turn` — returns the always-on `core` durable memory plus a relevance-retrieved `contextual` tail for the current turn (ADR-074 M1) and bumps `last_used_at` on every hydrated entry.
- `GET /api/v1/internal/smoke/turn-receipts` — read-only smoke harness receipt query (ADR-074 S0).

Other internal `runtime ↔ api` boundaries (bundle resolution, attachment hydration, etc.) are separate runtime-bundle endpoints and are not part of this back-channel.

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
3. `apps/provider-gateway` prewarms text-generation providers from `persai-runtime-secrets` env vars when present, and falls back to PersAI-managed runtime provider keys stored by the admin runtime-provider settings flow through `POST /api/v1/internal/runtime/provider-secrets/resolve`
4. tool credentials continue to resolve through the same internal secret resolver when tool calls need per-provider keys

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
