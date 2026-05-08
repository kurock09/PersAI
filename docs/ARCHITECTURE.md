# Architecture

## System shape

PersAI is a modular monolith control plane plus three internal execution services:

- `apps/api` - public HTTP API, control plane, ingress-facing orchestration
- `apps/web` - product and admin UI
- `apps/runtime` - PersAI-native execution runtime
- `apps/provider-gateway` - internal provider transport boundary
- `apps/sandbox` - isolated file/process execution boundary for the native `files` / `exec` / `shell` path

OpenClaw is not part of the active architecture. Historical migration traces remain only in archival documents and old migrations.

ADR-072 remains the historical migration ADR through the native-path closeout. ADR-078 is completed and archived as the consolidated follow-through program. ADR-080 is the active target-state decision for admin-controlled Knowledge authoring and Skill curation. ADR-081 is the active target-state decision for the unified user Files architecture. ADR-087 defines the active target-state decision for unified quota advisories and paid light mode. ADR-088 defines the active target-state decision for the unified notification platform, control plane, and delivery architecture.

## Core boundaries

### Control plane

`apps/api` owns:

- assistants, publish/apply lifecycle, and runtime bundle materialization
- Voice DNA archetype seed/edit flows, prompt-template defaults, and published Voice DNA snapshot materialization
- canonical chat/message persistence
- unified user-visible Files over the canonical `AssistantFile` registry
- assistant/global knowledge indexing, retrieval policy, and admin knowledge governance
- admin-authored Skill knowledge cards, Product KB text entries, and assistant-assisted admin knowledge drafts
- durable retrieval observability and workspace-scoped operator surfaces for knowledge quality
- governance, quota, admin, and audit boundaries
- Telegram webhook ingress
- durable quota-advisory threshold evaluation, assistant-authored active-surface follow-up delivery, quiet paid light-mode state, and advisory dedupe
- durable source-neutral assistant notification outbox and delivery from user reminders, background tasks, idle reengagement, billing lifecycle assistant push, and future system events through `Assistant.preferredNotificationChannel`
- PersAI-owned billing lifecycle state, trusted provider/admin billing event snapshots, append-only lifecycle events, admin-owned billing lifecycle notification policy, and durable billing notification jobs for required email and optional assistant push
- unified notification-platform convergence across conversational, transactional, operational, and administrative notifications, with `Admin > Notifications` as the canonical operator control plane for policy, routing, rendering, channel health, history, and dead letters

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
3. ordinary text and blocked media requests may still run request-time through `apps/runtime`, but accepted generated `image` / `audio` / `video` requests now enqueue durable `assistant_media_jobs` and return quickly from the webhook
4. the shared backend media-job worker later calls `apps/runtime` through `POST /api/v1/internal/runtime/media-jobs/run`
5. before final delivery, backend completion processing can call `POST /api/v1/internal/runtime/media-jobs/complete` with current canonical chat history to get optional fresh-history framing text
6. `apps/api` owns canonical persistence plus backend-owned async delivery back into Telegram

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
- Admin Runtime owns provider/model profile rows with token quota weights; plans own quota limits and model-role selections, not provider/model economic weights. Completed native turns charge the user-facing Credits quota from provider/runtime `usageAccounting.entries` weighted by those profiles, with estimator-based accounting only as a marked fallback when runtime usage is missing. Plans also own monthly media generation/editing unit allowances for `image_generate`, `image_edit`, and `video_generate`; the monthly counter truth is subscription-period scoped, delivery-confirmed, and separate from day-keyed safety counters. Runtime reserves monthly media units before expensive provider work; API delivery settles only successfully delivered artifacts and records provider-output/no-delivery cases as reconciliation-required rather than settled user quota. ADR-087 adds unified finite-limit advisories: 90%-crossing warnings are assistant-authored follow-up messages in the current active surface, free/zero-price plans may receive warnings but not paid light mode, and paid token-budget exhaustion degrades ordinary text turns into the safe `cost_driving_restricted` light-mode path until the current quota period resets rather than surfacing budget-driven slowdown/rate-limit UX as the primary product truth. The follow-up text is grounded from post-turn `quota_status` facts plus workspace-owned `quota_advisory` policy instruction, not from static surface copy. ADR-084 Slice 3 adds PersAI-owned `workspace_payment_intents` before any provider checkout/session call, so checkout starts from persisted PersAI intent truth rather than raw client state. ADR-083 lifecycle policy is PersAI-owned: trusted provider/admin payment inputs are first recorded as billing event snapshots, then they update `WorkspaceSubscription`, after which effective plan resolution, quota/materialization visibility, and lifecycle-derived notifications read the new PersAI state. Trial fallback is plan-owned through `lifecyclePolicy.trialFallbackPlanCode`, paid grace fallback is plan-owned through optional `lifecyclePolicy.paidFallbackPlanCode` with persisted global fallback as the fallback-of-last-resort, and grace duration is persisted in billing lifecycle settings. Effective subscription resolution materializes missing workspace subscriptions from the active default registration plan, assigns real trial/current-period windows for trial registrations, keeps paid access active during grace, and persists fallback/recovery before quota/materialization visibility reads the effective plan.
- Skill, Product KB, and platform/global Knowledge sources are platform/admin-managed shared KBs, not tenant workspace-owned rows. Assistant workspace remains consumer context for private assistant knowledge, assignment validation, memory/chat/files, quota, and retrieval telemetry.
- admin-authored Knowledge entries are Knowledge sources, not Files; ADR-080 defines their draft/review/apply lifecycle before ADR-079 indexing and runtime retrieval
- historical compatibility/migration traces do not define current request-time behavior

## Files truth

ADR-081 defines the active Files target state:

- `AssistantFile` is the canonical durable registry for every user-visible or assistant-reusable file.
- `fileRef` is the canonical PersAI/API file identity for reusable files, but the normal model-visible chat/tool prompt surface uses server-owned human aliases that resolve to `fileRef` inside the runtime.
- chat `attachmentId`, runtime `artifactId`, object-storage `objectKey`, storage path, raw sandbox path, knowledge source id, and retrieval reference id are not primary model-facing file selectors. Raw `fileRef` also must not be injected into normal conversational history text.
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
