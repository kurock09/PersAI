# Architecture

## System shape

PersAI is a modular monolith control plane plus three internal execution services:

- `apps/api` - public HTTP API, control plane, ingress-facing orchestration
- `apps/web` - product and admin UI
- `apps/runtime` - PersAI-native execution runtime
- `apps/provider-gateway` - internal provider transport boundary
- `apps/sandbox` - isolated file/process execution boundary for the native `files` / `exec` / `shell` path

OpenClaw is not part of the active architecture. Historical migration traces remain only in archival documents and old migrations.

ADR-072 remains the historical migration ADR through the native-path closeout. The active continuation backlog now lives in `docs/ADR/078-consolidated-follow-through-program.md`. ADR-081 is the active target-state decision for the unified user Files architecture.

## Core boundaries

### Control plane

`apps/api` owns:

- assistants, publish/apply lifecycle, and runtime bundle materialization
- Voice DNA archetype seed/edit flows, prompt-template defaults, and published Voice DNA snapshot materialization
- canonical chat/message persistence
- unified user-visible Files over the canonical `AssistantFile` registry
- assistant/global knowledge indexing, retrieval policy, and admin knowledge governance
- durable retrieval observability and workspace-scoped operator surfaces for knowledge quality
- governance, quota, admin, and audit boundaries
- Telegram webhook ingress
- durable source-neutral assistant notification outbox and delivery from user reminders, background tasks, idle reengagement, and future system events through `Assistant.preferredNotificationChannel`

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

### Sandbox plane

`apps/sandbox` owns:

- isolated file/process job execution
- assistant-workspace materialization and persistence through canonical `AssistantFile` rows
- sandbox job health/readiness and job polling surfaces used by `apps/runtime`

## Active request path

### Web

1. Browser calls `apps/api`
2. `apps/api` persists canonical state and forwards request-time execution to `apps/runtime`
3. `apps/runtime` calls back into `apps/api` over the dedicated internal listener for turn-time data hydration and retrieval orchestration (for example durable memory hydration through `POST /api/v1/internal/runtime/memory/hydrate-for-turn` and bounded knowledge context through `POST /api/v1/internal/runtime/knowledge/orchestrate`)
4. `apps/runtime` calls `apps/provider-gateway`
5. when a turn uses file/process tools, `apps/runtime` also calls `apps/sandbox`
6. result returns through `apps/api`
7. `apps/api` finalizes canonical message/media/quota state

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
- `sandbox`

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
- `RUNTIME_SANDBOX_BASE_URL=http://sandbox:3013`

## Data / contract truth

- authoritative API contract: `packages/contracts/openapi.yaml`
- generated contract artifacts: `packages/contracts/src/generated/*`
- runtime bundle is the active materialized execution artifact
- `assistant_files` is the canonical persisted assistant-workspace/file authority on the active path
- runtime knowledge access now publishes the active bounded `hybrid` retrieval contract
- historical compatibility/migration traces do not define current request-time behavior

## Files truth

ADR-081 defines the active Files target state:

- `AssistantFile` is the canonical durable registry for every user-visible or assistant-reusable file.
- `fileRef` is the only stable model/product selector for reusable files.
- chat `attachmentId`, runtime `artifactId`, object-storage `objectKey`, storage path, raw sandbox path, knowledge source id, and retrieval reference id are not primary model-facing file selectors.
- product open/download links use the canonical Files route by `fileRef`; the old attachment download route is not active target-state UI/API truth.
- media storage and sandbox storage are implementation details behind one user Files model.
- Knowledge remains a separate product plane and is not merged into Files.

## Historical material

Historical OpenClaw references may still exist in:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old migrations

Those traces are not part of the active architecture unless a current code/config/deploy path still depends on them.
