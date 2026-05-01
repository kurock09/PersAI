# API Boundary

This document describes the current active PersAI request boundaries.

For exact request and response schemas, use `packages/contracts/openapi.yaml` and the generated client/types in `packages/contracts/src/generated`.

ADR-072 is closed as the historical native migration ADR. Current continuation work is tracked in `docs/ADR/078-consolidated-follow-through-program.md`.

## Public product APIs

Primary public API surface:

- web and admin routes through `apps/api`
- authenticated assistant routes under `/api/v1/assistant/*`
- Voice DNA assistant read route: `GET /api/v1/assistant/persona-archetypes`
- admin routes under `/api/v1/admin/*`
- Voice DNA admin routes: `GET /api/v1/admin/persona-archetypes`, `PATCH /api/v1/admin/persona-archetypes/:key`, `POST /api/v1/admin/persona-archetypes/:key/reset-to-default`
- admin knowledge routes under `/api/v1/admin/knowledge-sources*`
- admin Skill routes under `/api/v1/admin/skills*`
- admin document-processing provider settings under `/api/v1/admin/tools/document-processing*`
- admin runtime-provider settings expose both the legacy chat-model alias `availableModelsByProvider` and the capability-aware `availableModelCatalogByProvider` (`chat`, `image`, `video` per provider). Plan admin payloads may select `primaryModelKey`, `imageGenerateModelKey`, `imageGenerateFallbackModelKey`, `imageEditModelKey`, `imageEditFallbackModelKey`, `videoGenerateModelKey`, and `videoGenerateFallbackModelKey`; media model keys are validated against the runtime-provider catalog during plan writes and materialized into runtime tool credential refs with optional fallback chains.
- single-batch web bootstrap: `GET /api/v1/app/bootstrap` — bearer-protected, fans out to assistant lifecycle, web chats, telegram integration, notification preference, user plan visibility, and admin plan visibility via `Promise.allSettled`; each section is `{ ok: true, data } | { ok: false, error }` so partial failures don't block the rest. Called once during SSR by `apps/web/app/app/layout.tsx`; mutations still use the per-endpoint refresh paths
- Telegram webhook under `/telegram-webhook/*`

### Avatar pipeline

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
- SSE socket close on the stream route does **not** abort the runtime turn. Only an explicit POST to the hard-stop route flips the runtime's abort signal. A passive disconnect (tab background, screen lock, network drop) lets the runtime finish, persists the full assistant message, and is recoverable on next history fetch.
- The web client performs a best-effort latest-history refresh on `focus`, `visibilitychange` back to visible, and `pageshow`, so a passive disconnect that already committed server-side is reconciled without requiring a manual page reload.
- the hard-stop route is idempotent and returns 204 whether or not a matching in-flight turn exists; the client treats it as fire-and-forget
- attachment staging under `POST /api/v1/assistant/chat/web/stage-attachment` accepts `clientTurnId` and `clientAttachmentId`; repeated staging for the same logical attachment returns the existing canonical staged attachment instead of creating a duplicate bubble

## Knowledge boundaries

### Assistant knowledge

- assistant-owned uploaded knowledge stays under `/api/v1/assistant/knowledge-sources/*`
- upload/reindex returns quickly with `processing` status by creating a DB-backed indexing job; the API indexing worker owns extraction/chunking/embedding/vector writes and terminal `ready` / `failed` / `needs_review` state
- request-time `knowledge_search` / `knowledge_fetch` execute through the native runtime knowledge contract
- current active runtime contract publishes `ragMode: "hybrid"` with bounded reference-first fetch semantics

### Admin global knowledge

Current admin knowledge routes are served by `apps/api`:

- `GET /api/v1/admin/knowledge-sources?scope=product`
- `GET /api/v1/admin/knowledge-sources/observability`
- `GET /api/v1/admin/knowledge-sources/connectors?scope=product`
- `POST /api/v1/admin/knowledge-sources/:scope`
- `DELETE /api/v1/admin/knowledge-sources/:sourceId`
- `POST /api/v1/admin/knowledge-sources/:sourceId/reindex`
- `GET /api/v1/admin/knowledge-indexing/jobs`
- `GET /api/v1/assistant/knowledge-indexing/jobs`

Active boundary rules:

- admin global-knowledge writes are workspace-scoped and require explicit admin authorization
- workspace knowledge-storage quota is enforced for admin global-knowledge uploads/deletes
- upload/reindex creates DB-backed indexing jobs for Product sources; processing is source-agnostic and shares the ADR-079 worker path with assistant knowledge and Skill documents
- retrieval observability is a durable API surface, not a process-local debug cache

### Admin document processing

Current admin document-processing settings routes are served by `apps/api`:

- `GET /api/v1/admin/tools/document-processing`
- `PUT /api/v1/admin/tools/document-processing`
- `POST /api/v1/admin/tools/document-processing/test-connection`

Active boundary rules:

- admins configure provider policy under `/admin/tools`, not per upload
- Mistral OCR and LlamaParse keys use PersAI-managed encrypted provider-secret storage
- test connection currently verifies local parser availability or remote key decryptability; live OCR/provider pings belong with provider adapter execution

### Admin Skills

Current admin Skill routes are served by `apps/api`:

- `GET /api/v1/admin/skills`
- `POST /api/v1/admin/skills`
- `GET /api/v1/admin/skills/:skillId`
- `PATCH /api/v1/admin/skills/:skillId`
- `DELETE /api/v1/admin/skills/:skillId`
- `POST /api/v1/admin/skills/:skillId/documents`
- `DELETE /api/v1/admin/skills/:skillId/documents/:documentId`
- `POST /api/v1/admin/skills/:skillId/documents/:documentId/reindex`

Active boundary rules:

- Skills are an admin-managed platform catalog, not admin global knowledge `scope=skill`; `Skill.workspaceId` is creation/audit provenance
- `Skill.category` is the current group key shown in admin/user UI (`work`, `engineering`, `personal`, `education`)
- delete archives a Skill and disables active assignments rather than hard-deleting the product concept
- Skill document upload/reindex creates pending DB indexing jobs; the API indexing worker processes Skill documents through the same normalized source/chunk/vector boundary as assistant and Product knowledge
- `/admin/skills` is the admin UI owner for Skill list/create/edit/archive and Skill document upload/delete/reindex/status management; `/admin/knowledge` remains Product KB and must not expose the old Skill library scope

### Assistant Skills

Current assistant Skill routes are served by `apps/api`:

- `GET /api/v1/assistant/skills`
- `PUT /api/v1/assistant/skills`

Active boundary rules:

- only the user can replace enabled Skill assignments for their assistant
- assignment accepts active platform-catalog Skills only
- configured plan limits cap enabled Skill count
- the web setup/recreate flow and `Assistant Settings -> Skills` are the current user-facing clients for these routes
- enabling Skills now changes prompt materialization through the Prompt Constructor-managed `Enabled Skills` block and contributes compact summaries to the runtime router's `retrievalPlan`; orchestrated retrieval/context injection and calm source-aware activity are active on the runtime web path

### Internal runtime

Current active internal service endpoints are served by `apps/runtime`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/turns/create`
- `POST /api/v1/turns/stream`

These are internal runtime-service boundaries, not a public legacy gateway surface.

Runtime turn results may include compact `turnRouting.retrievalPlan` diagnostics. On the active runtime path, the router plan feeds the internal API retrieval boundary when Skill, user, Product, or web grounding is requested.

ADR-079 Steps 11-12 add an internal runtime-to-API retrieval execution boundary: `POST /api/v1/internal/runtime/knowledge/orchestrate`. The runtime sends the current query and validated router plan, and the API returns a bounded source-aware `Retrieved Knowledge Context` block for executable Skill/user/Product sources. The API owns source policy, Skill assignment revalidation, ready-document enforcement, context shaping, and durable source-level retrieval observability. Web grounding is not fabricated by orchestration; `useWeb` is recorded honestly when not executed and real web work remains on the `web_search` / `web_fetch` tool path. Runtime web streams may emit compact retrieval activity events for source classes that actually contributed context; users do not see the internal plan. This endpoint is internal only and does not expose old admin `scope=skill` or a public `skill` knowledge-search source.

### Internal runtime → API back-channel

Current active internal `runtime → api` endpoints (served by `apps/api` on the dedicated `API_INTERNAL_PORT=3002` listener, gated by `PERSAI_INTERNAL_API_TOKEN`):

- `POST /api/v1/internal/runtime/memory/hydrate-for-turn` — returns the always-on `core` durable memory plus a relevance-retrieved `contextual` tail for the current turn and bumps `last_used_at` on every hydrated entry.
- `GET /api/v1/internal/smoke/turn-receipts` — read-only smoke harness receipt query.

Other internal `runtime ↔ api` boundaries (bundle resolution, attachment hydration, etc.) are separate runtime-bundle endpoints and are not part of this back-channel.

### Sandbox

Current active internal sandbox endpoints are served by `apps/sandbox`:

- `GET /health`
- `GET /ready`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs/:jobId`

These are internal runtime-to-sandbox boundaries for isolated `files` / `exec` / `shell` work, not public product APIs.

### Files

ADR-081 defines the active target-state file boundary.

The public/product file surface should expose assistant-scoped Files through canonical `fileRef` handles backed by `AssistantFile`. Chat `attachmentId`, runtime `artifactId`, object-storage `objectKey`, storage paths, raw sandbox paths, knowledge source ids, and retrieval references are internal or plane-specific implementation identifiers, not primary model-facing file selectors.

Sandbox and media delivery may continue to use their internal endpoints and storage paths, but those details must be hidden behind the single Files product/runtime contract. Knowledge remains a separate API/product plane and must not be folded into Files.

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
