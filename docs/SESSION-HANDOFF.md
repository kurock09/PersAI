# SESSION-HANDOFF

## 2026-03-28 - Reminder time-resolution hardening

### What changed

- Added backend-supported `delayMs` to PersAI reminder-task control so relative one-shot reminders no longer depend on a model inventing a correct absolute `runAt`.
- PersAI web inbound turns now pass live `currentTimeIso` and `userTimezone` into the OpenClaw runtime request.
- OpenClaw PersAI web runtime now appends a dynamic scheduling context to the system prompt:
  - current UTC time
  - user timezone
  - formatted current local time in that timezone when it can be rendered
- The existing backend validation for `runAt in the past` remains, so invalid timestamps still stop at the PersAI boundary with a clear `400` instead of surfacing as a generic `500`.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/control-internal-assistant-reminder-task.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`

### Tests run

- `corepack pnpm run typecheck` in `apps/api`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts src/gateway/persai-runtime/persai-runtime-http.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. Relative one-shot reminders are now deterministic via `delayMs`, but absolute local-time reminder resolution still depends on model/tool argument quality; the new runtime time context is meant to reduce that failure mode rather than fully replace semantic parsing.
2. Full-repo `openclaw` `tsc --noEmit` still reports unrelated pre-existing errors outside the touched reminder/runtime files.

## 2026-03-28 - H12 reminder_task control-plane ownership follow-up

### What changed

- Moved `reminder_task` write actions off the direct runtime-side `cron.add/update/remove` path.
- Added PersAI internal control endpoint:
  - `POST /api/v1/internal/runtime/tasks/control`
- Added PersAI application service that:
  - validates `create/pause/resume/cancel` requests from the runtime tool
  - calls OpenClaw `POST /api/v1/runtime/cron/control` from the backend as an internal driver
  - writes PersAI task registry state after successful backend-driven cron mutations
- `reminder_task` now behaves like this:
  - `list` reads PersAI registry state
  - `create/pause/resume/cancel` call PersAI internal control-plane first
  - only PersAI backend now invokes internal `cron` writes
- The backend now derives the cron callback base URL from the authenticated internal request host instead of trusting a runtime-provided base URL.
- `cancel` now soft-reconciles stale runtime jobs: if the cron id is already gone, the PersAI registry row is still deleted.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/application/control-internal-assistant-reminder-task.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-task-registry.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/ROADMAP.md`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/server-http.ts`
- `docs/PERSAI-FORK-PATCHES.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. Scheduler execution still relies on OpenClaw native `cron` under the hood; this step removes product write-path dependence from the runtime tool, but it is not yet a fully PersAI-owned scheduler engine.
2. `cancel` now goes through backend-driven internal `cron.remove`; if a runtime job was manually deleted out-of-band, we currently treat that as a runtime failure instead of silently reconciling the stale row.

## 2026-03-28 - H12 product-facing reminder_task tool + plan policy

### What changed

- Added a new user-facing OpenClaw tool `reminder_task` for PersAI assistants.
- The tool now handles reminder/task semantics directly:
  - `create`
  - `list`
  - `pause`
  - `resume`
  - `cancel`
- `reminder_task` uses the existing cron/webhook bridge under the hood, but the model no longer needs raw native cron semantics for normal product behavior.
- Added PersAI internal endpoint:
  - `GET /api/v1/internal/runtime/tasks/items`
- That internal endpoint lets runtime-side tools resolve current tasks through PersAI task registry state, including registry ids and underlying `externalRef`, so pause/resume/cancel can work without exposing native cron ids as the primary UX.
- Updated tool catalog / plan seed policy:
  - added `reminder_task` to the governed tool catalog
  - disabled user-facing `cron` across seeded plan activations
  - enabled `reminder_task` across seeded plan activations

### Files touched

**PersAI API:**

- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/src/modules/workspace-management/application/list-internal-assistant-task-items.service.ts`
- `apps/api/src/modules/workspace-management/application/seed-tool-catalog.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-task-registry.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/agents/tools/cron-tool.ts`
- `src/agents/openclaw-tools.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts src/agents/tools/cron-tool.ts src/agents/openclaw-tools.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. `reminder_task` is now the product-facing scheduling tool, but under the hood it still uses the existing OpenClaw cron scheduler bridge. This is the intended intermediate step, not the final PersAI-owned scheduler.
2. The global seed policy now forces `cron` inactive and `reminder_task` active for plan activations. If later we want per-plan exceptions, that should become an explicit product rule rather than startup defaulting.
3. The tool currently resolves pause/resume/cancel targets from PersAI registry state by `taskId` or `titleMatch`; ambiguous title matches intentionally return an error instead of guessing.

## 2026-03-28 - H12 Telegram reminder outbound bridge

### What changed

- Extended the current H12 cron callback slice from `web-only fallback` to real Telegram outbound delivery.
- Added PersAI internal runtime ingress:
  - `POST /api/v1/internal/runtime/telegram/chat-target`
- Added PersAI service logic that:
  - stores the latest inbound Telegram chat target on the assistant's active Telegram binding metadata
  - reads the PersAI-managed bot token from the secret store
  - sends reminder summaries through Telegram Bot API when `preferredNotificationChannel=telegram` and a delivery chat is known
  - falls back to the existing web reminders chat if Telegram target/token is unavailable or send fails
- Added minimal OpenClaw bridge change:
  - `persai-runtime-telegram.ts` now POSTs the latest inbound Telegram chat target back to PersAI before executing the assistant turn

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- `apps/api/src/modules/workspace-management/application/sync-telegram-chat-target.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-cron-fire.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. Telegram reminder outbound starts only after the assistant has received at least one inbound Telegram message, because that is when PersAI learns the concrete `telegramChatId` to send into.
2. WhatsApp and other non-web channels still degrade to `web` fallback for reminder delivery.
3. `cron-fire` currently sends the reminder summary text directly; full "re-enter agent turn on reminder fire" behavior is still follow-up work if we decide the callback should trigger a richer assistant action instead of message fanout only.

## 2026-03-28 - H12g memory lifecycle bridge

### What changed

- Implemented assistant memory lifecycle reset on both assistant creation and assistant reset.
- Added a minimal OpenClaw PersAI-runtime endpoint:
  - `POST /api/v1/runtime/workspace/memory/reset`
  - `POST /api/v1/runtime/workspace/reset`
- Added runtime-side memory workspace helper that:
  - ensures assistant workspace exists
  - recreates clean `MEMORY.md`
  - recreates empty `memory/`
  - removes legacy lowercase `memory.md` fallback file if present
- Wired PersAI backend calls:
  - `CreateAssistantService` now triggers memory workspace reset right after baseline assistant creation
  - `ResetAssistantService` now uses the combined runtime workspace reset path instead of two best-effort calls
- `edit/update/reapply` flows are intentionally untouched, so memory is not cleared outside create/reset.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-workspace.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/server-http.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm lint -- src/gateway/persai-runtime/persai-runtime-workspace.ts src/gateway/persai-runtime/persai-runtime-http.ts src/gateway/server-http.ts`

### Risks

1. This satisfies the product behavior, but no longer matches the earlier "zero OpenClaw changes" hope. The implementation uses a minimal `persai-runtime` bridge because PersAI API does not directly own the workspace filesystem.
2. `CreateAssistantService` still treats memory initialization as best-effort. `ResetAssistantService` is now strict and will fail the request if runtime workspace reset fails after the DB-side destructive reset has already committed.

## 2026-03-28 - H12 task registry + cron callback delivery slice

### What changed

- Added PersAI internal reminder/task control-plane ingress:
  - `POST /api/v1/internal/runtime/tasks/sync`
  - `POST /api/v1/internal/cron-fire`
- Added `assistantId + externalRef` uniqueness for `assistant_task_registry_items`, so recurring reminders can keep single-row semantics keyed by the OpenClaw cron job id.
- Added PersAI service logic that:
  - upserts/deletes current task rows from OpenClaw `cron.add` / `cron.update` / `cron.remove`
  - updates/removes those rows again when cron finished webhooks arrive
  - removes one-shot rows after successful completion
  - advances recurring rows by updating `nextRunAt`
- Added real web reminder delivery:
  - cron callbacks now create/find a dedicated web chat thread `system:reminders`
  - successful reminder summaries are stored there as assistant messages
  - preferred external channels currently degrade to `web` fallback instead of silently dropping the reminder
- Added minimal OpenClaw runtime bridge changes:
  - `persai-runtime-context.ts` now carries `assistantId` and `cronWebhookUrl`
  - PersAI runtime web/telegram turns populate those fields
  - `cron-tool.ts` auto-injects webhook delivery when PersAI runtime provides a callback URL
  - `cron-tool.ts` mirrors create/update/remove events to PersAI task registry sync endpoint
- Assistant reset now hard-deletes `assistant_task_registry_items` in the same destructive reset flow as chats/memory/materialized specs.

### Files touched

**PersAI API:**

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260402123000_step12_h12_task_registry_external_ref_unique/migration.sql`
- `apps/api/src/modules/workspace-management/application/sync-assistant-task-registry.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-task-registry.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-cron-fire.controller.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**OpenClaw:**

- `src/agents/persai-runtime-context.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `src/agents/tools/cron-tool.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm lint -- src/agents/persai-runtime-context.ts src/gateway/persai-runtime/persai-runtime-agent-turn.ts src/gateway/persai-runtime/persai-runtime-http.ts src/agents/tools/cron-tool.ts`
- `ReadLints` on touched PersAI/OpenClaw files: 0 diagnostics

### Risks

1. `cron-fire` currently delivers reminders only into the in-product web chat. If preferred channel is `telegram` / `whatsapp`, the current behavior is explicit fallback to `web`, not true outbound messenger send yet.
2. The new task registry sync depends on OpenClaw reaching PersAI at `cfg.secrets.providers["persai-runtime"].baseUrl` and authenticating with `OPENCLAW_GATEWAY_TOKEN`.
3. The OpenClaw file `src/gateway/persai-runtime/persai-runtime-telegram.ts` still carries pre-existing `curly` style lint noise outside this slice; I did not expand this task into a full style-only refactor there.

## 2026-03-28 - H12 preferred notification channel slice

### What changed

- Added PersAI-side reminder delivery preference persistence:
  - Prisma enum `AssistantPreferredNotificationChannel`
  - new `assistants.preferred_notification_channel` column with default `web`
- Added authenticated assistant preference endpoints:
  - `GET /api/v1/assistant/notification-preference`
  - `PATCH /api/v1/assistant/notification-preference`
- Added backend services that:
  - resolve only currently available delivery channels from active assistant bindings
  - always keep `web` available as the safe default
  - reject choosing disconnected external channels
  - append an assistant audit event when the reminder delivery preference changes
- Added settings UI under Channels:
  - real "Reminder delivery" selector backed by PersAI API
  - only available channels are shown
  - current behavior text matches the agreed semantics: preferred channel first, fallback when unavailable
- Updated `ROADMAP`, `DATA-MODEL`, and `CHANGELOG` to reflect that H12a and H12e are now implemented.

### Files touched

**PersAI API:**

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260402110000_step12_h12_preferred_notification_channel/migration.sql`
- `apps/api/src/modules/workspace-management/application/assistant-notification-preference.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-notification-preference.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-notification-preference.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`

**PersAI Web:**

- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/_components/use-app-data.ts`
- `apps/web/app/app/_components/assistant-settings.tsx`

**Docs:**

- `docs/ROADMAP.md`
- `docs/DATA-MODEL.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `ReadLints` on touched API/Web files: 0 linter diagnostics

### Risks

1. This slice persists and exposes channel preference, but it does not yet execute reminder delivery through that preference. `cron-fire`, actual channel fanout, and fallback delivery still need the next H12 slice.
2. Availability currently derives from assistant channel bindings plus implicit `web`; WhatsApp is structurally supported in the enum/API but remains product-inactive until its integration exists.
3. The existing memory lifecycle blocker remains unchanged: true create/reset initialization of `MEMORY.md` / `memory/` is still not feasible as "PersAI API only, zero OpenClaw changes" under the current runtime boundary.

## 2026-03-28 - H12/H13 foundation: unified inbound turn + code-first web/task UX

### What changed

- **Doc-first architecture freeze:** added `ADR-056` and aligned `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, and `TEST-PLAN` around the new direction:
  - PersAI becomes the unified inbound turn gateway for `web`, Telegram, reminder callbacks, and future messengers
  - PersAI-owned reminders/tasks replace product dependence on native OpenClaw cron over time
  - stable backend error codes become the UX contract across surfaces
- **Canonical API error envelope actually enforced:** added a global Nest exception filter (`ApiExceptionFilter`) and `ApiErrorHttpException` helper so API failures now consistently return:
  - `requestId`
  - `error.code`
  - `error.category`
  - `error.message`
- **Shared inbound turn foundation for web:** extracted `PrepareAssistantInboundTurnService` and moved the duplicated web prepare logic out of `SendWebChatTurnService` / `StreamWebChatTurnService`. Web sync and web stream now share the same assistant/live-state/chat-create/enforcement/abuse/active-chat-refresh path.
- **Code-first enforcement errors:** `EnforceAssistantCapabilityAndQuotaService` and `EnforceAbuseRateLimitService` now emit stable codes instead of plain conflict strings for the key chat gateway cases:
  - `assistant_not_live`
  - `plan_feature_unavailable`
  - `active_chat_cap_reached`
  - `quota_limit_reached`
  - `rate_limited`
- **Runtime errors normalized:** runtime adapter failures are normalized into stable frontend-consumable codes (`runtime_unreachable`, `runtime_timeout`, `runtime_degraded`, `runtime_auth_failure`, `runtime_invalid_response`) for both sync HTTP failures and streaming `failed` SSE events.
- **Web client updated to use backend codes first:** `assistant-api-client.ts` and `custom-fetch.ts` now read `error.code` from the canonical envelope / SSE payload and only fall back to string heuristics when no stable code is available.
- **Tasks UI aligned with agreed semantics:** both task surfaces now show only the current active reminders/tasks:
  - `assistant-settings.tsx` Tasks section
  - `app-flow.client.tsx` task center
    Paused/stopped items are no longer rendered as a separate “history-like” section.

### Files touched

**Docs / architecture:**

- `docs/ADR/056-unified-inbound-turn-gateway-and-persai-owned-reminders-h12-h13.md` — new ADR
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

**PersAI API:**

- `apps/api/src/main.ts` — registers global API exception filter
- `apps/api/src/modules/platform-core/interface/http/api-error.ts` — canonical API error helper
- `apps/api/src/modules/platform-core/interface/http/api-exception.filter.ts` — canonical error envelope filter
- `apps/api/src/modules/workspace-management/application/assistant-inbound-error.ts` — shared inbound/runtime error normalization
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts` — shared web prepare path
- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/enforce-abuse-rate-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforcement-points.test.ts`

**Contracts / Web:**

- `packages/contracts/src/mutator/custom-fetch.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `ReadLints` on touched API/Web files: 0 linter diagnostics

### Risks

1. This is the **foundation slice**, not the full H12/H13 delivery. Telegram ingress, reminder callbacks, preferred notification channel persistence, and PersAI-owned task/reminder writers are still follow-up work.
2. Existing backend endpoints outside the chat path still benefit from the new canonical error envelope, but only the chat gateway path has been explicitly normalized to stable product error codes in this slice.
3. Tasks UI now hides inactive items by design. Backend control endpoints for disable/enable/cancel still exist and remain valid, but the current product view intentionally shows only current active tasks/reminders.

### Next recommended step

- Implement the next H12/H13 product slice on top of this foundation:
  - add PersAI-owned reminder/task write path and preferred notification channel persistence
  - move Telegram ingress onto the shared PersAI inbound turn path
  - add internal callback ingress for reminder firing / cron webhook compatibility
  - extend stable error-code formatting from web to messenger/callback surfaces

## 2026-03-27 - Streaming Quality Hardening

### What changed

- **`res.flush()` on every SSE write:** `assistant.controller.ts` `sendSse` helper now merges event+data into one `res.write()` call and immediately calls `res.flush()` (with runtime check for availability). This eliminates TCP/Node output buffering that delayed token delivery to the client.
- **Removed `accumulated` from delta events:** Backend `onDelta` callback now sends only `{ delta }` instead of `{ delta, accumulated }`. The `accumulated` field was redundant for delta events (client rebuilds text from deltas) and caused each SSE payload to grow linearly with response length. `accumulated` is still sent for `thinking` events where the client needs the full thought text.
- **`requestAnimationFrame` batching:** Frontend `onDelta` and `onThinking` callbacks in `use-chat.ts` now buffer incoming tokens and flush to React state once per animation frame (~16ms / 60fps). Previous behavior was one `setMessages` per token (30-50 calls/sec). Pending deltas are synchronously flushed on `onRuntimeDone` and `onCompleted` to prevent text loss.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — `sendSse` merges writes + `flush()`, delta event sends only `{ delta }`

**PersAI Web:**

- `apps/web/app/app/assistant-api-client.ts` — `WebChatStreamEvent` delta type updated to `{ delta: string }`, parser no longer requires `accumulated` for delta events
- `apps/web/app/app/_components/use-chat.ts` — `requestAnimationFrame` batching for `onDelta` and `onThinking`, synchronous flush on `onRuntimeDone`/`onCompleted`

**Docs:**

- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors
- Prettier: all files pass

### Risks

1. If any other consumer of the SSE stream expects `accumulated` in delta events, it will break. Currently only the web frontend consumes this stream, and it never used `accumulated` for deltas.
2. `res.flush()` is cast via `(res as any).flush` — safe because Express/Node HTTP response always has it when not behind compression middleware. If compression is added later, ensure it supports `flush()`.
3. `requestAnimationFrame` is browser-only — fine since `use-chat.ts` is a client-only React hook (`"use client"`).

### Next recommended step

- Deploy and verify streaming is smooth (tokens appear per-frame, not in batches).
- Consider separating API onto `api.persai.dev` domain to eliminate the Next.js rewrite proxy layer for SSE.
- H11 — WhatsApp/MAX readiness and secret-ref parity.

## 2026-03-27 - Telegram Group Deduplication (supergroup migration fix)

### What changed

- **Backend joined-event dedup:** When a `joined` event arrives, `internal-runtime-config-generation.controller.ts` now runs `updateMany` to mark any existing active records with the same `title` but a different `telegramChatId` as "left" before upserting the new record. This handles the Telegram group→supergroup migration where `chat_id` changes.
- **Backend GET dedup:** `assistant.controller.ts` GET groups endpoint now deduplicates results by `title` (case-insensitive), keeping only the most recently updated record per title. Ordered by `updatedAt desc`.
- **Frontend filter:** `telegram-connect.tsx` groups list now shows only `status === "active"` groups. Counter badge already counted active-only; the list rendering now matches.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts` — stale-title deactivation before upsert
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — dedup-by-title in GET groups, order by `updatedAt`

**PersAI Web:**

- `apps/web/app/app/_components/telegram-connect.tsx` — filter to active-only in groups list

**Docs:**

- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors
- Prettier: all files pass

### Risks

1. Title-based dedup assumes groups don't share the same name. In practice Telegram group names are unique per bot context, so this is safe. If a user intentionally has two groups named "Bots" they would see only one — acceptable edge case.
2. The `updateMany` that marks old same-title entries as "left" uses `title` equality. If a group is renamed before migration, both old and new entries will remain — the GET dedup handles this at display time.

### Next recommended step

- Deploy and verify: add bot to a group, verify it shows once. If the group migrates to supergroup, the old entry should auto-deactivate.
- Clean existing duplicates in DB (optional): `UPDATE assistant_telegram_groups SET status='left' WHERE ...` for known stale entries.
- H11 — WhatsApp/MAX readiness and secret-ref parity.

## 2026-03-27 - Quota UX and Avatar Consistency Hardening

### What changed

- **Quota error UX:** `toWebChatUxIssue` in `assistant-api-client.ts` now classifies 409 quota errors into `quota_limit_reached` (budget/token/tool limits) and `feature_unavailable` (disabled capability) with user-friendly messages and guidance. Two new entries added to `WebChatUxIssueClass` union type.
- **Reapply HTTP code fix:** `POST /assistant/publish` and `POST /assistant/reapply` now decorated with `@HttpCode(200)` in `assistant.controller.ts`. Frontend `postAssistantReapply` uses `isSuccessStatus` + full object guard.
- **Shared AssistantAvatar component:** New `assistant-avatar.tsx` with sizes `sm` (28px), `md` (40px), `lg` (80px). Renders avatar image > emoji > Sparkles fallback. Used in chat header, message bubbles, empty state, home dashboard, sidebar, Telegram settings. Includes minute-granularity cache-busting `?v=` param on avatar URLs.
- **Avatar cache headers:** Backend avatar endpoint `Cache-Control` changed from `public, max-age=300` to `no-cache, must-revalidate`.
- **Telegram metadata sync:** After publish+apply, `PublishAssistantDraftService` patches the Telegram binding's `metadata.displayName` and `metadata.avatarUrl` with the assistant's draft values. New `patchMetadata` method in `AssistantChannelSurfaceBindingRepository`.
- **Telegram settings UI:** `ConnectedView` now receives `assistantAvatarUrl`, `assistantAvatarEmoji`, `assistantDisplayName` from `app-shell.tsx` and prefers them over stale `bot.*` metadata.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — `@HttpCode(200)` on publish/reapply, `Cache-Control` fix
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts` — `syncTelegramBindingMetadata` after apply
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.repository.ts` — `patchMetadata` interface
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-channel-surface-binding.repository.ts` — `patchMetadata` implementation

**PersAI Web:**

- `apps/web/app/app/_components/assistant-avatar.tsx` — new shared component
- `apps/web/app/app/_components/chat-area.tsx` — uses `AssistantAvatar`, passes avatar props through
- `apps/web/app/app/_components/chat-message.tsx` — uses `AssistantAvatar` for assistant messages
- `apps/web/app/app/_components/home-dashboard.tsx` — uses `AssistantAvatar` in hero
- `apps/web/app/app/_components/sidebar.tsx` — uses `AssistantAvatar` in assistant card
- `apps/web/app/app/_components/telegram-connect.tsx` — uses `AssistantAvatar`, accepts assistant draft props
- `apps/web/app/app/_components/app-shell.tsx` — passes assistant draft props to TelegramConnect
- `apps/web/app/app/chat/page.tsx` — passes avatar props to ChatArea
- `apps/web/app/app/assistant-api-client.ts` — quota UX classifiers, reapply guard fix, new issue class types

**Docs:**

- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors

### Risks

1. `patchMetadata` does read-then-write (not atomic JSON merge) — acceptable for low-concurrency publish flow.
2. Cache-busting `?v=` changes every minute, which means avatar images refetch once per minute on navigation. Acceptable trade-off for immediate consistency after avatar change.
3. Telegram metadata sync is non-fatal (try/catch). If it fails, UI falls back to assistant draft props anyway.

### Next recommended step

- Test full flow: change avatar in settings → publish → verify avatar consistency across chat, sidebar, home, Telegram settings.
- Deploy and verify quota errors for `kurock09@gmail.com` show clear messages.
- H11 — WhatsApp/MAX readiness and secret-ref parity.

## 2026-03-27 - UI Polish: chat scroll, sidebar, avatar upload, Telegram sync

### What changed

- **Chat loading optimization:** Backend `listChatMessages` now uses reverse pagination (newest-first, cursor-before semantics). Frontend `useChat` loads a single page of 20 messages; `loadOlderMessages()` fetches earlier pages. `ChatArea` uses IntersectionObserver sentinel at top with scroll position preservation via `useLayoutEffect`.
- **New chat in sidebar:** `ChatPageInner` watches `chat.chatId` and calls `appData.reloadChats()` when a new chat is created during streaming.
- **Avatar file upload:** Full upload pipeline: `POST /api/v1/assistant/avatar` (NestJS multipart, 2MB limit) → OpenClaw `POST /api/v1/runtime/workspace/avatar` (writes `avatar.{ext}` to workspace dir). Readback via `GET /api/v1/assistant/avatar` → OpenClaw `GET /api/v1/runtime/workspace/avatar`. Frontend shows spinner during upload, stores permanent URL instead of `blob:`.
- **Telegram bot sync:** `syncBotProfile(bot, workspace, assistantId)` helper in `persai-runtime-telegram.ts` calls `setMyName`, `setMyDescription`, `setMyProfilePhoto` from workspace persona after bot initialization. Non-fatal (try/catch with warnings).

### Files touched

**OpenClaw fork (lower-risk PersAI bridge files):**

- `src/gateway/persai-runtime/persai-runtime-http.ts` — avatar POST/GET handler
- `src/gateway/persai-runtime/persai-runtime-telegram.ts` — syncBotProfile helper
- `src/gateway/server-http.ts` — avatar request stage registration
- `docs/PERSAI-FORK-PATCHES.md` — patches #8, #9
- `scripts/verify-persai-patches.mjs` — checks #8, #9, #10

**PersAI:**

- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/_components/chat-area.tsx`
- `apps/web/app/app/chat/page.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors
- `tsc --noEmit` OpenClaw: 0 new errors (only pre-existing test/extension issues)
- Prettier: all touched files unchanged
- `verify-persai-patches.mjs`: 30/30 passed

### Risks / follow-up

- Avatar upload is synchronous and capped at 2MB; larger files or videos would need a streaming upload approach.
- Telegram `setMyProfilePhoto` may fail if the bot doesn't have admin permissions in the channel; errors are logged as warnings and don't block bot startup.
- Scroll position preservation uses `useLayoutEffect` which may cause minor visual jitter on very slow devices.

---

## 2026-03-27 - H10 Thinking/Reasoning UX + Telegram groups auth fix

### What changed

- **H10 stream plumbing:** OpenClaw PersAI runtime stream now emits `thinking` NDJSON chunks, and PersAI API forwards them as SSE `thinking` events to the web app.
- **H10 web UX:** assistant messages can now carry ephemeral streamed thought text, rendered as a collapsible `Thought for Xs` panel with a fade-out collapsed preview above the final assistant answer.
- **Reasoning enabled for web runtime:** PersAI web chat turns now request `reasoning=stream` from OpenClaw, so reasoning-capable models can surface live thought text during streaming without persisting it into the final assistant message.
- **Telegram groups fix:** added `GET /api/v1/assistant/integrations/telegram/groups` to `ClerkAuthMiddleware` route registration, fixing the `401` that prevented the Groups section from loading even when `assistant_telegram_groups` rows already existed.

### Why changed

- H10 was the next roadmap slice after H9 and closes the last major chat UX gap: users can now see live model reasoning separately from the final answer instead of waiting on a silent stream.
- The Telegram UI issue turned out to be an auth-routing omission, not runtime delivery: group join/leave callbacks were already reaching the API and updating the database, but the listing endpoint itself was not behind the same auth middleware as the other Telegram routes.

### Files touched

**OpenClaw fork:**

- `src/agents/command/types.ts`
- `src/agents/agent-command.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`

**PersAI:**

- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/_components/chat-message.tsx`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- IDE diagnostics (`ReadLints`) on all touched OpenClaw and PersAI files: 0 errors
- Runtime audit in GKE:
  - confirmed `openclaw` on new image
  - confirmed Telegram `group-update` callbacks returning `200`
  - identified repeated `401` on `/api/v1/assistant/integrations/telegram/groups` before the auth-route fix

### Risks / follow-up

- Thought text is intentionally ephemeral in the web client and is not persisted into chat history or backend message records.
- Models without reasoning support will continue streaming only normal assistant deltas; the Thought panel simply will not appear.

### Next recommended step

- Deploy both repos, wait for new `openclaw` and `api` pods, then verify:
  - one streaming web chat shows the Thought panel
  - Telegram Groups section loads without `401`
  - existing tracked groups appear without re-adding the bot

## 2026-03-27 - H9 Per-Request Tool Credential Isolation

### What changed

- **Eliminated `process.env` race for tool credentials:** Replaced global `process.env` mutation (`injectToolCredentials`/`cleanupInjectedEnv`) with per-request `AsyncLocalStorage` context in all three agent turn entry points (sync, telegram, stream).
- **Extended `PersaiRuntimeRequestCtx`:** Added `toolCredentials?: Map<string, string>` field. Credentials now flow through `persaiRuntimeRequestContext.run()` alongside `toolDenyList` and `workspaceDir`.
- **New `getPersaiToolCredential` helper:** Reads per-request credential by env var name. Exposed via new `openclaw/plugin-sdk/persai-credential` subpath so extensions can import it without violating lint boundaries.
- **Patched 3 credential readers:** Tavily config (`extensions/tavily/src/config.ts`), Firecrawl config (`extensions/firecrawl/src/config.ts`), web-fetch tool (`src/agents/tools/web-fetch.ts`) — all check `getPersaiToolCredential(…)` before `process.env` fallback.
- **Removed dead code:** `injectToolCredentials()`, `cleanupInjectedEnv()`, `PERSAI_AGENT_WORKSPACE_DIR` save/restore constants.
- **Audit finding:** 3 of 5 `TOOL_CREDENTIAL_ENV_MAP` entries (`OPENAI_IMAGE_GEN_API_KEY`, `OPENAI_TTS_API_KEY`, `OPENAI_EMBEDDINGS_API_KEY`) are dead injections — no OpenClaw tool reads them today. Kept in the map for future wiring.

### Why changed

At 1000+ concurrent users, `process.env` mutation creates race conditions where different assistants' API keys overwrite each other. This produces credential cross-leak (security), incorrect billing (financial), and random tool failures (reliability). The `AsyncLocalStorage` pattern was already proven by H7b for `PERSAI_TOOL_DENY` — H9 extends it to cover all tool credentials.

### Files touched

**OpenClaw fork:**

- `src/agents/persai-runtime-context.ts` — added `toolCredentials` to interface, added `getPersaiToolCredential` helper
- `src/plugin-sdk/persai-credential.ts` — **new**, re-exports `getPersaiToolCredential`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — removed `process.env` mutation, pass credentials through context
- `extensions/tavily/src/config.ts` — read from context before `process.env`
- `extensions/firecrawl/src/config.ts` — read from context before `process.env`
- `src/agents/tools/web-fetch.ts` — read from context before `process.env`
- `package.json` — added `./plugin-sdk/persai-credential` export
- `scripts/lib/plugin-sdk-entrypoints.json` — registered new subpath

**PersAI:**

- `docs/ADR/055-per-request-tool-credential-isolation-h9.md` — **new**
- `docs/ROADMAP.md` — marked H9 complete
- `docs/CHANGELOG.md` — H9 entry
- `docs/SESSION-HANDOFF.md` — this entry

### Tests run

- TypeScript typecheck (`tsc --noEmit`): 0 new errors (all errors pre-existing in unrelated files)
- IDE linter: 0 errors on all changed files
- `plugin-sdk:check-exports`: pass
- `lint:plugins:plugin-sdk-subpaths-exported`: pass

### Risks

- **Low:** Extensions that resolve credentials at tool-creation time (not call time) may still read a stale `process.env` value if the tool is created outside a `persaiRuntimeRequestContext.run()` scope. Currently Tavily and Firecrawl resolve API keys inside `createWebSearchTool`/`createWebFetchTool` which are called within `createOpenClawTools` during the agent turn — inside the context scope. No issue today.
- **None for CLI users:** `process.env` fallback is preserved — non-PersAI CLI still works.

### Next recommended step

- H10 — thinking/reasoning UX (stream thinking tokens, collapsible "Thought for Xs" block)
- Or: wire the 3 dead credential refs (`OPENAI_IMAGE_GEN_API_KEY`, `OPENAI_TTS_API_KEY`, `OPENAI_EMBEDDINGS_API_KEY`) to actual OpenClaw tools so PersAI-managed keys for image generation, TTS, and embeddings are consumed at runtime.

---

## 2026-03-27 - H8 Telegram Runtime Readiness

### What changed

- **Encrypted bot token storage:** `ConnectTelegramIntegrationService` now stores the actual bot token encrypted (AES-256-GCM) via `PlatformRuntimeProviderSecretStoreService` under key `telegram_bot:{assistantId}`. `RevokeTelegramIntegrationSecretService` deletes it on revoke.
- **Materialize Telegram config:** `resolveTelegramChannelConfig()` in `materialize-assistant-published-version.service.ts` builds `openclawBootstrap.channels.telegram` with resolved `botToken`, `webhookUrl`, HMAC `webhookSecret`, `groupReplyMode`, `parseMode`, inbound/outbound policy.
- **OpenClaw Telegram bridge:** New `persai-runtime-telegram.ts` dynamically starts/stops Grammy bots per assistant on `spec/apply`. Handles `message:text` (with group mention/reply filtering) and `my_chat_member` (group join/leave → PersAI callback). Webhook handler at `POST /telegram-webhook/:assistantId`. Bots reinitialize from Redis store on pod restart.
- **GKE Ingress:** `openclaw-ingress.yaml` for `bot.persai.dev/telegram-webhook/*` with Google-managed TLS certificate.
- **Groups data model:** Prisma `assistant_telegram_groups` table. Internal callback `POST /api/v1/internal/runtime/telegram/group-update`. Public `GET /api/v1/assistant/integrations/telegram/groups`.
- **UI:** Groups section in Telegram config panel (auto-populated, name/members/status badge). Group reply mode toggle (Mention/Reply vs All). `groupReplyMode` added to config update flow.

### Files touched

**PersAI:**

- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-secret-store.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326300000_add_assistant_telegram_groups/migration.sql`
- `apps/web/app/app/_components/telegram-connect.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `packages/config/src/api-config.ts`
- `infra/helm/templates/openclaw-ingress.yaml`
- `infra/helm/values.yaml`, `infra/helm/values-dev.yaml`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-telegram.ts` (new)
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts`
- `src/gateway/server-http.ts`

### H8j–H8k workspace isolation fixes

- **H8j — `workspaceDir` race (`process.env` → `commandInput`):** Telegram and web agent turns now pass `workspaceDir` directly in `commandInput` to `agentCommandFromIngress`, removing reliance on `process.env.PERSAI_AGENT_WORKSPACE_DIR`.
- **H8k — session `cwd` drift + memory tools:** Existing sessions stored stale `cwd` from creation time. Memory tools (`readAgentMemoryFile`, manager, backend-config, QMD) always used `resolveAgentWorkspaceDir(cfg, agentId)` → static `workspace-persai` path, ignoring runtime override. Fix: extracted `persaiRuntimeRequestContext` to `persai-runtime-context.ts`; `session-manager-init.ts` now syncs `header.cwd` on every turn; memory modules check `persaiRuntimeRequestContext.getStore()?.workspaceDir` first.
- **H8l — group callback URL fix:** `notifyPersaiGroupUpdate` tried to read nonexistent top-level `persaiSecretResolverBaseUrl` (strict schema rejects unknown keys → CrashLoopBackOff). Fixed to read `cfg.secrets.providers["persai-runtime"].baseUrl` instead — same provider already configured for secret resolution.

OpenClaw files touched:

- `src/agents/persai-runtime-context.ts` (new)
- `src/agents/openclaw-tools.ts` (re-export from new module)
- `src/agents/pi-embedded-runner/session-manager-init.ts`
- `src/memory/read-file.ts`, `src/memory/manager.ts`, `src/memory/backend-config.ts`, `src/memory/qmd-manager.ts`

OpenClaw commit: `6bcff3d2f4b13483b03fac259462c01b9a0ccec0`

### Deploy notes

1. Create K8s Secret entries: `TELEGRAM_WEBHOOK_HMAC_SECRET` in `persai-api-secrets`
2. Run Prisma migration for `assistant_telegram_groups` table
3. Set up DNS: `bot.persai.dev` → GKE Ingress IP
4. Create Google-managed certificate `persai-bot-cert` for `bot.persai.dev`
5. Deploy PersAI API first (new migration + config vars), then OpenClaw (new Grammy bridge)
6. Connect a Telegram bot in UI → publish/apply → bot should respond to DMs and group @mentions
7. Verify `openclaw.json` configmap has `secrets.providers.persai-runtime` with correct `baseUrl` (used by group update callbacks)

---

## 2026-03-26 - Force Reapply fix + null-plan backfill

### What changed

- **Force Reapply bumps configGeneration:** `ForceReapplyAllService` now calls `bumpConfigGenerationService.execute()` before the re-materialization loop. New specs get a higher generation, so OpenClaw's freshness check reliably detects the update.
- **Null-plan governance backfill:** `SeedToolCatalogService.onModuleInit()` now runs `backfillNullPlanGovernances()` — any `assistantGovernance` row with `quotaPlanCode=null` is updated to the active default plan. This fixes legacy assistants created before the plan catalog, which had empty `toolQuotaPolicy` and therefore empty deny lists.

### Why changed

- 5 of 6 assistants had no plan assigned → `resolveToolQuotaPolicy(null)` returned `[]` → no inactive tools → deny list empty. Only the 1 assistant created after plan system had a proper deny list.
- Force Reapply didn't increment `configGeneration`, so OpenClaw's in-memory cache could consider specs "fresh" even after mass re-materialization.

### Files touched

- `apps/api/src/modules/workspace-management/application/force-reapply-all.service.ts`
- `apps/api/src/modules/workspace-management/application/seed-tool-catalog.service.ts`

### Deploy notes

- After deploy: API auto-backfills null plans at startup → press Force Reapply All → all assistants get correct deny lists.

---

## 2026-03-26 - H3.4 runtime integration hardening

### What changed

- **Credential refs parsing (OpenClaw):** `extractToolCredentialRefs` in `persai-runtime-tool-policy.ts` now handles both Array and Object (Record) formats. PersAI materializes `toolCredentialRefs` as `Record<toolCode, {refKey, secretRef, configured}>`, but OpenClaw previously only accepted `Array<{toolCode, secretRef, configured}>`. Shared parsing logic extracted into `parseCredentialRefRow`.
- **process.env race condition (OpenClaw):** `PERSAI_TOOL_DENY` global env var replaced with `AsyncLocalStorage`-based `persaiRuntimeRequestContext` (defined in `persai-runtime-context.ts`, re-exported from `openclaw-tools.ts`). Each `agentCommandFromIngress` call runs inside `persaiRuntimeRequestContext.run()` with its own `toolDenyList` and `workspaceDir`. Fallback to `process.env.PERSAI_TOOL_DENY` preserved for non-PersAI CLI usage.
- **Tool catalog rename (PersAI):** `memory_center_read` → `memory_get`, `tasks_center_control` → `cron` in `tool-catalog-data.ts`, tests, and SQL data migration `20260326200000`. Migration also updates `workspace_tool_usage_daily_counters`. `PlanCatalogToolActivation` safe (references by UUID FK).
- **Auto-seed at startup (PersAI):** `SeedToolCatalogService` (`OnModuleInit`) syncs tool catalog, ensures default `starter_trial` plan with entitlement + tool activations, seeds bootstrap presets if empty. Eliminates need for manual `seed.ts` / `seed-catalog.ts` for new deployments.

### Why changed

- Credential refs were silently empty — API keys for search/images/TTS never reached OpenClaw tools.
- Concurrent web chat requests could corrupt each other's tool deny lists via shared `process.env`.
- Tool codes `memory_center_read` / `tasks_center_control` didn't match OpenClaw tool names (`memory_get` / `cron`), causing deny list mismatches.
- New user registration on clean DB required manual seed script execution.

### Slice boundary

- OpenClaw: 4 files (`persai-runtime-tool-policy.ts`, `persai-runtime-agent-turn.ts`, `openclaw-tools.ts`, `persai-runtime-context.ts`)
- PersAI: `tool-catalog-data.ts`, `seed-tool-catalog.service.ts`, `workspace-management.module.ts`, 2 test files, 1 SQL migration, docs

### Deploy notes

- After deploy: run `prisma migrate deploy` → API auto-seeds at startup → Force Reapply All to re-materialize existing specs with correct tool names.

---

## 2026-03-26 - H3.3 post-deploy fixes: user data, avatar editing, emoji picker

### What changed

- **Setup wizard user profile upsert:** removed `if (onboarding.status === "pending")` gate — `postOnboarding` is now always called in `handleCreate`. After reset, user-edited fields (name, birthday, gender, timezone) are persisted to DB before materialization, so USER.md and other bootstrap files reflect current data.
- **Avatar editing in settings:** added emoji picker (inline grid — avoids `overflow` clipping by `SlideOver`'s scroll container) + file upload button; selecting emoji clears URL and vice versa; `avatarUrl` now sent to API on save.
- **Sidebar avatar rendering:** sidebar assistant card now shows custom `avatarUrl` image when present, with emoji and default icon fallbacks.
- **Edit personality button:** restyled from text link to `ActionButton` component; placed in same row as "Save and apply".
- **Dead code cleanup:** removed unused `router` from `handleCreate` dependency array in setup wizard.

### Why changed

- After H3.3 deploy, live testing revealed: (1) USER.md preserved old data after reset+recreate because `postOnboarding` was skipped; (2) emoji picker was visually broken inside the slide-over panel due to `overflow` clipping; (3) no way to change avatar or upload image in edit flow; (4) sidebar showed default icon even when avatar was set.

### Slice boundary

- PersAI web only (no backend or OpenClaw changes)

### Files touched

- `apps/web/app/app/setup/page.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/sidebar.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/UI-SPEC.md`

### Tests run

- Lint, format, typecheck (full workspace gate per AGENTS.md)

### Risks

- `postOnboarding` upsert is safe for repeated calls (backend handles existing records). No side effects.
- File upload creates `blob:` URL (local-only preview). No server-side file upload API exists yet — custom avatar images do not persist across sessions. Tracked as known limitation.

### Next recommended step

- **Server-side avatar upload:** add file upload endpoint for persistent avatar URL storage (GCS or equivalent)
- **H4 — Telegram runtime readiness** alignment against admin-driven runtime profile + managed secret refs
- **AI model routing investigation:** `gpt-5.1` selected in plan not applied after reapply (paused, needs debugging)

### Ready commit message

- `fix(web): always upsert user profile on recreate, add avatar editing and file upload in settings`

---

## 2026-03-26 - H2 cleanup: tool/plan/limits consolidation and dead-code removal

### What changed

- **Tool catalog consolidation:** extracted all 8 tool definitions + `STARTER_TRIAL_TOOL_POLICY` into `apps/api/prisma/tool-catalog-data.ts`; both `seed.ts` and `seed-catalog.ts` now import from this single source of truth.
- **Dead capability flags removed:** `assistantLifecycle`, `memoryCenter`, `tasksCenter`, `viewLimitPercentages`, `tasksExcludedFromCommercialQuotas` — removed from `EffectiveCapabilityState`, `resolve-effective-capability-state.service.ts`, `resolve-plan-visibility.service.ts`, `resolve-openclaw-capability-envelope.service.ts`, `resolve-openclaw-channel-surface-bindings.service.ts`, `track-workspace-quota-usage.service.ts`, `admin-plan-management.types.ts`, OpenAPI contracts, admin plans UI, and all affected test files.
- **Per-plan quota limits:** `tokenBudgetLimit` and `costToolUnitsLimit` now stored in `billingProviderHints.quotaAccounting`; admin plans UI has dedicated input fields; `billingProviderHints` overwrite bug fixed (merge instead of replace).
- **Per-plan model selection:** `primaryModelKey` stored in `billingProviderHints`; resolved during materialization and passed to `ResolveRuntimeProviderRoutingService`.
- **Daily call limit enforcement:** `WorkspaceToolDailyUsageRepository` interface + Prisma implementation; `checkToolDailyLimit` / `incrementToolDailyUsage` on `TrackWorkspaceQuotaUsageService`; wired into module DI.
- **Admin Runtime UI completed:** fallback provider/model toggle, available models per provider editor, reapply summary display after save.
- **Docs aligned:** `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `UI-SPEC.md`, `TEST-PLAN.md`, `PRODUCT.md`, `ROADMAP.md`, `CHANGELOG.md`, `ADR-052` all updated to match current state.

### Why changed

- After H2 and H3 work, accumulated technical debt: duplicate tool definitions, unused capability flags still in types/UI/contracts, missing quota controls in admin UI, incomplete runtime admin page. This cleanup brings docs and code into alignment.

### Slice boundary

- PersAI only (no OpenClaw changes in this session)
- Backend: types, services, repository, module wiring, API contracts
- Frontend: admin plans page, admin runtime page, app-flow client
- Docs: 8 doc files updated

### Next recommended step

- **Deploy and seed:** run `seed-catalog` on GKE to ensure the consolidated tool catalog is applied
- **dailyCallLimit runtime integration:** wire OpenClaw `before_tool_call` hook to PersAI `incrementToolDailyUsage` callback
- **H4 — Telegram runtime readiness:** align Telegram against admin-driven runtime profile + managed secret refs

### Ready commit message

- `refactor(admin): consolidate tool catalog, remove dead capabilities, add per-plan quotas/model/daily-limit enforcement`

### Affected files

- `apps/api/prisma/tool-catalog-data.ts` (new)
- `apps/api/prisma/seed.ts`
- `apps/api/prisma/seed-catalog.ts`
- `apps/api/package.json`
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/effective-capability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-capability-state.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/application/plan-visibility.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-tool-daily-usage.repository.ts` (new)
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-tool-daily-usage.repository.ts` (new)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `packages/contracts/openapi.yaml`
- `apps/web/app/admin/plans/page.tsx`
- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/api/test/quota-accounting.test.ts`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/UI-SPEC.md`, `docs/TEST-PLAN.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/ADR/052-*`

---

## 2026-03-26 - Plans per-tool management + OpenClaw tool policy integration

### What changed

- Redesigned `/admin/plans` page: compact collapsible cards with inline summary (caps/channels/tools/activations on one line), expandable detail view, dense 3-column entitlements grid in edit mode, tool activation table with toggles and daily limit inputs.
- Extended backend admin plans API to accept/return `toolActivations[]` with per-tool `active` status and `dailyCallLimit`.
- Updated `syncToolActivationsForPlan` in Prisma repository to apply explicit per-tool overrides with class-derived fallback.
- Added PersAI contract types: `AdminPlanToolActivation`, `AdminPlanToolActivationInput`.
- Created OpenClaw `persai-runtime-tool-policy.ts` module: parses `toolCredentialRefs`/`toolQuotaPolicy` from bootstrap, resolves credentials via `resolvePersaiRefs`, builds tool deny list.
- Integrated tool policy validation on `POST /spec/apply` in OpenClaw.
- On chat turns, resolved tool credentials are injected as env vars (`TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, etc.) with cleanup.
- `createOpenClawTools()` now filters out tools listed in `PERSAI_TOOL_DENY` env var.

### Why changed

- H2 laid the foundation (encrypted tool credential store, materialization of toolCredentialRefs/toolQuotaPolicy into bootstrap), but OpenClaw was not consuming these values. This slice completes the integration loop so PersAI controls which tools are active and OpenClaw executes accordingly.

### Slice boundary

- PersAI admin UI + API: per-tool activation management at plan level
- OpenClaw: credential resolution + tool filtering from bootstrap
- Credential mapping: `tool/web_search/api-key` → `TAVILY_API_KEY`, `tool/web_fetch/api-key` → `FIRECRAWL_API_KEY`, etc.
- Still deferred:
  - per-provider web search key selection
  - AsyncLocalStorage for concurrency-safe credential injection
  - persona / memory hydration (H3)

### Next recommended step

- **H3 runtime hydration depth** — consume materialized persona, memory, tasks envelopes deeper in OpenClaw

### Ready commit message

- `feat(admin+openclaw): per-tool plan management + OpenClaw tool policy integration`

### Affected files (PersAI)

- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `packages/contracts/src/generated/model/adminPlanToolActivation.ts` (new)
- `packages/contracts/src/generated/model/adminPlanToolActivationInput.ts` (new)
- `packages/contracts/src/generated/model/adminPlanState.ts`
- `packages/contracts/src/generated/model/adminPlanInputBase.ts`
- `packages/contracts/src/generated/model/index.ts`
- `apps/web/app/admin/plans/page.tsx`

### Affected files (OpenClaw)

- `src/gateway/persai-runtime/persai-runtime-tool-policy.ts` (new)
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/agents/openclaw-tools.ts`

## 2026-03-26 - H2 tool credential refs and tool quota limits baseline shipped

### What changed

- Added [ADR-052](ADR/052-tool-credential-refs-and-tool-quota-limits-h2.md) defining the H2 scope.
- Expanded tool catalog from 3 to 8 entries (`web_search`, `web_fetch`, `image_generate`, `tts`, `browser`, `memory_search`, `memory_get`, `cron`).
- Extended `PlanCatalogToolActivation` with `dailyCallLimit` for per-tool daily call limits.
- Added `WorkspaceToolUsageDailyCounter` table for tracking daily tool usage per workspace.
- Widened `PlatformRuntimeProviderSecret.providerKey` column from `VarChar(32)` to `VarChar(64)` to accommodate tool credential keys.
- Extended `PlatformRuntimeProviderSecretStoreService` to handle generic credential keys (both provider and tool), added `loadKeyMetadataByKeys` and extended `resolveSecretValueById` for tool secret IDs.
- Created `ManageAdminToolCredentialsService` and `AdminToolCredentialsController` for `GET`/`PUT /api/v1/admin/runtime/tool-credentials`.
- Added `admin.tool_credentials.update` step-up action in `AdminAuthorizationService`.
- Updated materialization to include `toolCredentialRefs` and `toolQuotaPolicy` in `openclawBootstrap`.
- Created admin UI page `/admin/tools` for tool credential management.
- Updated seed.ts with 8 tools and starter trial daily limits.
- Marked `docs/ROADMAP.md` Step 12 `H2` complete.

### Why changed

- H1b proved the encrypted secret store and internal resolve pattern for provider keys. H2 extends the same infrastructure to tool-specific credentials, giving platform admins centralized control over tool API keys without Kubernetes-level secret management.
- Per-tool daily call limits provide fine-grained cost control per plan, complementing the existing global `token_budget`.

### Slice boundary

- platform-admin only
- tool credentials managed globally (not per-assistant)
- 5 tool credential slots: `tool_web_search`, `tool_web_fetch`, `tool_image_generate`, `tool_tts`, `tool_memory_search`
- per-tool `dailyCallLimit` in plan activation (null = unlimited)
- OpenClaw resolves tool credentials through existing `POST /api/v1/internal/runtime/provider-secrets/resolve`
- still deferred:
  - runtime tool execution changes in OpenClaw fork
  - per-tool daily counter enforcement in OpenClaw runtime
  - assistant-level limit communication (system prompt hints at 80%+ usage)
  - Telegram / WhatsApp / MAX channel credential management

### Next recommended step

- **H3 — runtime hydration depth**
  - consume materialized persona, memory, tasks/reminders, tool policy, and related capability envelopes deeper in OpenClaw session/runtime policy
  - continue ADR-048 `P2` work

### Ready commit message

- `feat(admin): add tool credential refs + tool quota limits baseline (H2)`

## 2026-03-25 - H1a runtime provider admin UI shipped

### What changed

- Added a structured `H1a` editor to the existing admin rollout controls in `apps/web/app/app/app-flow.client.tsx`.
- Added `apps/web/app/app/runtime-provider-profile-admin.ts` to hydrate current runtime-provider governance state and generate safe rollout patches.
- Marked `docs/ROADMAP.md` Step 12 `H1a` complete and aligned changelog/ADR notes.

### Why changed

- `H1` proved the backend/materialization/runtime path, but changing provider refs still depended on raw JSON rollout editing. `H1a` gives platform admins a real control-plane UI without inventing a new backend mutation surface or storing raw secrets in PersAI.

### Slice boundary

- mutation path remains `POST /api/v1/admin/platform-rollouts`
- scope remains platform-admin only
- supports `OpenAI + Anthropic`
- edits:
  - primary/fallback provider + model
  - provider credential refs (`source`, `provider`, `id`, optional `refKey`)
- guardrail:
  - preserve unrelated `policyEnvelope` and `secretRefs.refs.*` branches because rollout updates replace whole governance envelopes

### Next recommended step

- **H2 — tool credential refs baseline**
  - move managed tool-provider secret refs onto the same control-plane pattern
  - keep runtime/tool execution in OpenClaw
  - avoid mixing this with Telegram/MAX/WhatsApp delivery follow-up yet

### Ready commit message

- `feat(admin): add runtime provider profile rollout UI`

## 2026-03-25 - H1 runtime provider profile baseline shipped

### What changed

- Added [ADR-050](ADR/050-runtime-provider-profile-baseline-h1.md) to lock the concrete H1 implementation shape.
- Marked `docs/ROADMAP.md` Step 12 `H1` complete.
- Aligned `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, and `docs/API-BOUNDARY.md` around one exact control-plane path:
  - `assistant_governance.policyEnvelope.runtimeProviderProfile`
  - `assistant_governance.secret_refs.refs.runtime_provider_credentials`
  - materialized `openclawBootstrap.governance.runtimeProviderProfile`

### Why changed

- The north-star from ADR-049 was already agreed, but the code slice still needed one precise production-grade contract before implementation. H1 now has an explicit boundary that reuses governance, rollout/reapply, and native OpenClaw apply/chat seams instead of introducing a parallel admin/runtime system.

### Slice boundary

- Mutation surface in H1: existing `POST /api/v1/admin/platform-rollouts`
- First supported providers: `OpenAI + Anthropic`
- Runtime behavior:
  - if materialized admin-managed runtime profile is present, OpenClaw validates and uses it
  - if absent, OpenClaw keeps legacy configured default model path
- Still deferred:
  - tool credential refs
  - deeper persona/memory/tasks/tool-policy hydration
  - Telegram/MAX/WhatsApp delivery/readiness follow-up

### Next recommended step

- **H1a — admin UI for runtime provider profile + provider credential refs**
  - platform-admin only
  - uses the already-shipped H1 backend/materialization/apply path
  - lands before `H2` so provider refs stop depending on rollout-only mutation UX
  - exact UI shape:
    - structured editor in existing admin rollout controls
    - current values hydrated from assistant governance state
    - generated rollout patch for `runtimeProviderProfile` + `runtime_provider_credentials`
    - no raw secret storage and no new backend mutation surface

### Ready commit message

- `feat(runtime): add admin-managed provider profile baseline`

## 2026-03-25 - ADR-049 north-star for admin-driven runtime control plane

### What changed

- Added [ADR-049](ADR/049-platform-admin-runtime-control-plane-phasing.md) to lock the long-term PersAI + OpenClaw direction into one canonical phased plan.
- Added `docs/ROADMAP.md` Step 12 so future sessions can follow the same ordered slices instead of rebuilding the sequence ad hoc.
- Updated `docs/ARCHITECTURE.md` to point future runtime-profile work at ADR-049 without changing the current runtime boundary.
- Fixed the stale compat-echo sentence in `docs/API-BOUNDARY.md` so docs match the current native fork behavior (`503` without prior apply).

### Why changed

- The next phase is no longer "make basic native runtime work" but "turn PersAI into the real control plane for runtime configuration without duplicating OpenClaw internals". That needs one written north-star and slice ladder so sessions do not drift or try to do everything at once.

### First recommended coding slice

- **H1 — platform-admin runtime provider profile baseline**
  - first providers: `OpenAI + Anthropic`
  - move assistant-scoped primary/fallback model refs into PersAI control plane
  - add provider credential refs without storing raw secret values in PersAI
  - keep OpenClaw as runtime executor + secret resolver
  - keep the first runtime consumption on the applied web path only

### Guardrails

- Reuse `assistant_governance.policyEnvelope.runtimeProviderRouting` and `assistant_governance.secret_refs` before inventing new control-plane objects.
- Do not widen into tool credential refs, Telegram runtime delivery, or WhatsApp/MAX delivery in the first slice.
- If H1 needs architecture/API/data-model changes beyond ADR-049, update docs first before code.

### Ready commit message

- `docs(adr): define phased runtime control-plane north-star`

## 2026-03-25 - OpenClaw pin advance for honest missing-apply failures

### What changed

- **Fork** (`kurock09/openclaw`): commit `f74bb8c23286f4b2452897035489dd1cc41931d6` changes `src/gateway/persai-runtime/persai-runtime-http.ts` so missing applied runtime specs return explicit `503` JSON errors for sync and stream chat instead of `[openclaw-compat]*` fallback replies.
- **PersAI pin wiring**: `infra/dev/gitops/openclaw-approved-sha.txt` now points to that fork commit, and `infra/dev/gitops/README.md` reflects the new approved SHA so the next `main` push builds and repins the correct OpenClaw image.

### Why changed

- Compat echo on missing apply masked a real runtime/state problem and could let PersAI store fake assistant replies in chat history. Bumping the approved SHA is required so auto-build/deploy picks up the honest `503` behavior instead of continuing to ship the older fork revision.

### Blocker

- **Push order matters:** push `openclaw` first so GitHub contains `f74bb8c23286f4b2452897035489dd1cc41931d6`, then push `PersAI` so the OpenClaw image-publish workflow can fetch that SHA.

### Next recommended step

- After both pushes, let the OpenClaw image workflow repin `infra/helm/values-dev.yaml`, then run hybrid smoke: API preflight, direct `healthz/readyz`, and one web streaming turn in `/app`.

### Ready commit message

- `chore(openclaw): pin fork f74bb8c23 for honest missing-apply failures`

## 2026-03-25 - Docs aligned with current live dev OpenClaw profile

### What changed

- Updated `README.md`, `docs/API-BOUNDARY.md`, `docs/LIVE-TEST-HYBRID.md`, `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`, and `docs/ROADMAP.md` to match the current dev runtime profile declared in `infra/helm/values-dev.yaml`.

### Why changed

- The live dev stack now runs with Redis-backed apply state, OpenAI as the default OpenClaw model, `OPENAI_API_KEY` secret wiring, and a raised API adapter timeout for stable streaming. Several docs still described the older pre-fix or generic state and needed drift cleanup.

### Next recommended step

- Keep future OpenClaw ops/doc updates anchored to the actual `values-dev.yaml` profile so live-test instructions, roadmap, and ADR notes do not drift after runtime changes.

### Ready commit message

- `docs(dev): align runtime docs with current openclaw profile`

## 2026-03-25 - Dev API timeout raised for OpenClaw web stream

### What changed

- `infra/helm/values-dev.yaml` now sets `OPENCLAW_ADAPTER_TIMEOUT_MS=15000` for the dev `api` deployment.

### Why changed

- Live `POST /api/v1/assistant/chat/web/stream` requests were failing around `3116-3156 ms` even though OpenClaw was already generating valid text. The `api` container had no explicit timeout env, so it was using the config default `3000 ms` and aborting the upstream runtime call too early.

### Next recommended step

- Let GitOps reconcile this `api` env, then re-run the same web chat thread and verify the UI receives `completed` instead of surfacing a timeout issue.

### Ready commit message

- `fix(dev): raise openclaw adapter timeout for web streaming`

## 2026-03-25 - Dev OpenClaw default model switched to OpenAI

### What changed

- `infra/helm/templates/openclaw-configmap.yaml` now writes `agents.defaults.model.primary` from Helm values, and `infra/helm/values-dev.yaml` sets that dev default to `openai/gpt-5.4`.

### Why changed

- Runtime state in Redis was working, but live chat still failed because OpenClaw booted with Anthropic default model while only `OPENAI_API_KEY` was configured in the cluster.

### Next recommended step

- Apply the updated ConfigMap/deployment via GitOps, verify startup logs show `agent model: openai/gpt-5.4`, then rerun chat + restart-safe smoke.

### Ready commit message

- `chore(dev): default openclaw runtime model to openai in values-dev`

## 2026-03-25 - Dev values switch OpenClaw to managed Redis

### What changed

- `infra/helm/values-dev.yaml` now sets `PERSAI_RUNTIME_SPEC_STORE=redis` for OpenClaw and sources `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL` from `persai-openclaw-secrets`.

### Why changed

- Manual live patching was being reverted by GitOps because the repo still declared `memory`. The cluster can only stay on managed Redis if the desired state in Git also says `redis`.

### Next recommended step

- Push PersAI, let Argo reconcile, then verify in the pod that `STORE=redis` before running restart and multi-replica smoke.

### Ready commit message

- `chore(dev): switch openclaw runtime spec store to redis in values-dev`

## 2026-03-25 - AGENTS rule: OpenClaw fork push-prep workflow

### What changed

- `AGENTS.md` now has an explicit **OpenClaw fork change workflow**: if a session changes `C:\Users\alex\Documents\openclaw`, agents must prepare both repos before saying "ready to push" (`openclaw` commit, PersAI SHA/tag update, digest clear, docs update, explicit push order).

### Why changed

- This repo regularly lands runtime changes in the fork while PersAI owns the pin/build/deploy boundary. Without a written workflow, agents can forget the second half of the delivery and leave CI/deploy in a broken or misleading state.

### Next recommended step

- Follow this rule on every future OpenClaw slice: push **OpenClaw first**, then push **PersAI**, then pull the CI repin commit back into the local PersAI checkout.

### Ready commit message

- `docs(agents): require dual-repo openclaw push preparation`

## 2026-03-25 - ADR-048 P0: Redis-backed apply store wiring (fork + PersAI ops docs)

### What changed

- **Fork** (`kurock09/openclaw`): commit `6ea3b32535d38e0884d8770e74483260caaf1a53` implements `redis` backend for `src/gateway/persai-runtime/persai-runtime-spec-store.ts` with lazy connect, key prefix, optional TTL, and unit coverage in `persai-runtime-spec-store.test.ts`; `memory` remains the single-replica default.
- **PersAI docs / pin wiring**: documented fork runtime envs (`PERSAI_RUNTIME_SPEC_STORE`, `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`, optional prefix/TTL) in `docs/API-BOUNDARY.md`, `docs/ADR/048-*`, `docs/ROADMAP.md`, `docs/LIVE-TEST-HYBRID.md`, `docs/CHANGELOG.md`; updated `infra/dev/gitops/openclaw-approved-sha.txt`; moved `infra/helm/values-dev.yaml` OpenClaw tag to the new fork SHA and cleared digest for workflow repin.

### Why changed

- Compat fallback after OpenClaw restarts is not a PersAI API problem; the root cause is process-local apply state in the runtime. Redis-backed storage closes that gap at the correct boundary and is the prerequisite for multi-replica OpenClaw.

### Next recommended step

- In the **fork repo**: commit/push the Redis store change, then bump `infra/dev/gitops/openclaw-approved-sha.txt` in PersAI and repin the OpenClaw image/digest.
- In **cluster ops**: provide a real Redis URL (managed Redis preferred for non-dev), set `PERSAI_RUNTIME_SPEC_STORE=redis`, deploy, then verify apply survives OpenClaw pod restart before increasing replicas above `1`.

### Ready commit message

- `chore(openclaw): pin redis-backed apply-store fork sha and document runtime store wiring`

## 2026-03-25 - ADR-048 P3: `agentCommandFromIngress` for PersAI web runtime (fork)

### What changed

- **Fork** (`kurock09/openclaw`): commit `baf61e8675b97ce5c31f768e732304c58d526e34` — new `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`; `persai-runtime-http.ts` calls embedded agent for sync + NDJSON stream when `store.get` hits (after apply); no-apply path unchanged (`[openclaw-compat]*` echo).
- **PersAI:** `openclaw-approved-sha.txt` → above SHA; `values-dev.yaml` OpenClaw `tag` + cleared `digest` for CI repin; `validate-openclaw-persai-runtime.sh` checks agent bridge; docs ADR-048 / API-BOUNDARY / ROADMAP / LIVE-TEST / gitops README / CHANGELOG.

### Why changed

- Close ADR-048 **P3**: real agent output on web when governance materialization was applied; align with OpenAI-compat gateway ingress path.

### Blocker

- **Push fork first**, then PersAI `main`, so CI can fetch `baf61e8675b97ce5c31f768e732304c58d526e34`.

### Next recommended step

- OpenClaw Dev Image Publish → digest repin commit; Argo sync; live test apply → chat (expect model output if provider keys exist).

### Ready commit message

- `chore(openclaw): pin fork baf61e8675 for ADR-048 P3 agent ingress`

## 2026-03-25 - ADR-048 docs + deploy runbook; baseline vs completion

### What changed

- **ADR-048**: status clarifies **baseline shipped** (P0–P2 + PersAI-side native build) vs **remaining P3** (full agent turn) and fork P4 (drop echo); consequences updated (no “dual compat patch” wording).
- **infra/dev/gitops/README.md**: new **push order** section (fork before PersAI pin); removed stale “compat patch not configured” / “remaining blocker” lines; merged secret prerequisite into O3 assumptions; P3/echo called out explicitly.
- **docs/API-BOUNDARY.md**: subsection renamed to “Fork build (native runtime)”; authentication line no longer references removed compat patch; echo until P3 stated explicitly.
- **docs/LIVE-TEST-HYBRID.md**, **infra/dev/gke/RUNBOOK.md**, **README.md**, **docs/CHANGELOG.md**: aligned with same deploy and verification story.

### Why changed

- Operators hit **`not our ref`** when PersAI `main` ran before the fork push; docs contradicted reality on compat patch and “first pod blocker.” ADR-048 “completion” is ambiguous without separating **baseline milestone** from **P3**.

### Next recommended step

- **Fork-only session:** ADR-048 **P3** spike — call embedded agent path from `persai-runtime-http` for sync+stream; bump `openclaw-approved-sha.txt`; shared Redis store if HPA >1 OpenClaw replica.

### Ready commit message

- `docs(adr-048): align status, deploy order, and API-BOUNDARY with native baseline`

## 2026-03-25 - ADR-048 executed: native PersAI runtime in OpenClaw fork (P0–P2)

### What changed

- **Fork** (`kurock09/openclaw`): commit `8e61e0ba5eba49fccc2c0ae362e07b242c7e1d15` — added `src/gateway/persai-runtime/` (`persai-runtime-spec-store.ts`, `persai-runtime-session.ts`, `persai-runtime-http.ts`); wired `server-http.ts` + `server-runtime-state.ts` so apply persists, chat/stream read store, emit `X-Persai-Runtime-Session-Key`, echo prefixes `openclaw-persai-runtime*` when apply+persona present else legacy compat prefix.
- **PersAI**: `openclaw-approved-sha.txt` → above SHA; removed compat patch file + `validate-openclaw-compat-patch.sh`; added `validate-openclaw-persai-runtime.sh`; dropped patch step from `openclaw-dev-image-publish.yml`; `ci.yml` uses new validator; `values-dev.yaml` OpenClaw tag updated, digest cleared for CI repin; docs/ADR/API-BOUNDARY/README/gitops/ROADMAP Step 11 updated.

### Why changed

- Execute ADR-048 by shipping native routes in fork instead of CI patch; lay P0 multi-replica–ready store interface and P1/P2 hooks without rewriting embedded agent core (P3 next).

### Verification (post-push / post-deploy)

- Fork pushed to `origin`; PersAI OpenClaw workflow green; `values-dev` repinned digest; live: apply → chat shows `openclaw-persai-runtime*` + `X-Persai-Runtime-Session-Key` (see LIVE-TEST-HYBRID Phase B).

### Files touched (high level)

- OpenClaw: `src/gateway/persai-runtime/*`, `server-http.ts`, `server-runtime-state.ts`
- PersAI: workflows, `infra/dev/gitops/*`, `infra/helm/values-dev.yaml`, `docs/*`, `README.md`

### Tests run / result

- OpenClaw: local `pnpm`/tsc not available in agent shell; rely on fork CI after push.
- PersAI: not run (doc + infra edits).

### Ready commit message

- `feat(openclaw): native persai runtime p0-p2; drop compat patch and repin sha`

## 2026-03-25 - ADR-048: native OpenClaw runtime plan (fork-owned code)

### What changed

- Added [docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md](ADR/048-native-openclaw-runtime-from-persai-apply-chat.md): phased fork-side plan (persist apply, session mapping, hydrate persona/memory/tools from `openclawWorkspace` / bootstrap, delegate chat to native agent pipeline, retire compat echo), pointers to fork files (`agent-command`, hooks/cron turn, sessions store), materialization reference in `apps/api`.
- Linked ADR-048 from `docs/API-BOUNDARY.md` (PersAI→OpenClaw contract section).
- `docs/CHANGELOG.md` updated.

### Why changed

- User asked for plan + code for full OpenClaw features with PersAI settings; implementation cannot live in `apps/api` per ADR-012 — ADR records architecture and fork integration phases; executable bridge belongs in the OpenClaw fork PR.

### Files touched (high level)

- `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`, `docs/API-BOUNDARY.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only.

### Next recommended step

- Spike in fork: call `runCronIsolatedAgentTurn` or `agentCommandFromIngress` from runtime HTTP handlers after loading stored apply payload; open PR on `kurock09/openclaw`, then bump `openclaw-approved-sha.txt`.

### Ready commit message

- `docs(adr): add 048 native openclaw runtime from persai apply chat plan`

## 2026-03-25 - Phase B: OpenClaw runtime smoke in LIVE-TEST-HYBRID

### What changed

- Extended [docs/LIVE-TEST-HYBRID.md](LIVE-TEST-HYBRID.md) with **Phase B: OpenClaw runtime smoke**: authenticated `GET /api/v1/assistant/runtime/preflight` through hybrid proxy, optional `kubectl port-forward` to `svc/openclaw:18789` for `healthz`/`readyz`, streaming chat check in `/app`, contract link and GitOps pin note.
- Logged in [docs/CHANGELOG.md](CHANGELOG.md).

### Why changed

- After Phase A contract freeze, operators need a single runbook step for “does OpenClaw work after deploy” without rereading adapter code.

### Files touched (high level)

- `docs/LIVE-TEST-HYBRID.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only.

### Next recommended step

- Run Phase B checks after your deploy; then fork/native runtime parity or Telegram/MAX delivery slices as separate ADR-backed work.

### Ready commit message

- `docs: add phase b openclaw runtime smoke to live-test hybrid`

## 2026-03-25 - Phase A: PersAI to OpenClaw HTTP runtime contract (v1)

### What changed

- Added design-freeze subsection **PersAI to OpenClaw HTTP runtime contract (v1)** to `docs/API-BOUNDARY.md`: normative contract (paths, JSON bodies, NDJSON stream records, auth header, env config keys, adapter error mapping, retry scope), explicit out-of-scope surfaces (Telegram/WhatsApp/MAX on this HTTP API), and compat patch reference behavior for drift checks against `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch` and [ADR-012](ADR/012-openclaw-fork-source-and-deploy-boundary.md).
- Linked the contract from `docs/ARCHITECTURE.md` under OpenClaw boundary.
- Recorded the slice in `docs/CHANGELOG.md`.

### Why changed

- Phase A requires a single documentation anchor so fork/runtime implementers can match PersAI’s adapter without reading Nest code.

### Files touched (high level)

- `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only; no automated tests required.

### Known risks / intentional limits

- Contract documents current adapter + patch behavior; native fork parity remains a later slice.

### Next recommended step

- Phase B/C: deploy validation and/or native runtime parity in fork; extend contract only via explicit doc + ADR if the HTTP surface changes.

### Ready commit message

- `docs: add phase a persai-to-openclaw http runtime contract v1`

## 2026-03-25 - Prisma AbuseSurface enum mapping (web chat stream 500)

### What changed

- Added `@@map("abuse_surface")` to `enum AbuseSurface` in `apps/api/prisma/schema.prisma` so generated SQL uses the existing Postgres enum from Step 10 G2 migrations.
- Regenerated Prisma client (`pnpm --filter @persai/api run prisma:generate`).
- Restored `apps/web/next-env.d.ts` to reference `./.next/types/routes.d.ts` (avoid dev-only path).
- Dropped spurious working-tree noise via `git restore` on `app-flow.client.tsx`, `app-flow.client.test.tsx`, and `assistant-governance.entity.ts` where diffs were empty.

### Why changed

- Live `POST .../assistant/chat/web/stream` returned 500: Prisma referenced non-existent type `public.AbuseSurface` while the DB defines `abuse_surface`.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/web/next-env.d.ts`
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed

### Known risks / intentional limits

- Deploy `api` required for production; no DB migration change (schema already matched DB naming).

### Next recommended step

- Deploy API and re-verify web chat streaming end-to-end.

### Ready commit message

- `fix(api): map AbuseSurface prisma enum to abuse_surface for stream abuse upserts`

## 2026-03-24 - Step 10 G5 WhatsApp and MAX readiness hardening

### What changed

- Hardened OpenClaw provider/surface readiness projection so configured state now resolves from canonical provider binding repository for:
  - `telegram`
  - `whatsapp`
  - `max`
- Removed remaining Telegram-only configured-state assumption for future providers:
  - `whatsapp` and `max` are no longer hardcoded as unconfigured in projection
- Preserved explicit non-flat surface model:
  - WhatsApp surface remains `whatsapp_business`
  - MAX remains split into `max_bot` and `max_mini_app`
- Kept Telegram managed SecretRef lifecycle usability gate intact on top of binding readiness.
- Added targeted G5 test coverage for provider-configured readiness and MAX split-surface behavior.
- Added ADR-047 and updated roadmap/docs for G5.

### Why changed

- G5 requires architecture-only hardening so WhatsApp and MAX can be implemented later without redesign, while preserving existing web/Telegram/system-notification behavior.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/test/openclaw-channel-surface-bindings-g5.test.ts`
- `docs/ADR/047-whatsapp-max-readiness-hardening-g5.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings-g5.test.ts` — passed

### Known risks / intentional limits

- G5 does not implement WhatsApp runtime delivery flow yet.
- G5 does not implement MAX bot or MAX mini-app runtime delivery flow yet.
- Non-Telegram secret lifecycle policies for WhatsApp/MAX remain future work.

### Next recommended step

- Step 11 **H1** design language and product shell alignment.

### Ready commit message

- `refactor(api): harden step 10 g5 provider-surface readiness for whatsapp and max without delivery rollout`

## 2026-03-24 - Step 10 G4 retention/delete/compliance baseline

### What changed

- Finalized explicit MVP legal acceptance behavior:
  - onboarding now requires `acceptTermsOfService=true` and `acceptPrivacyPolicy=true`
  - persisted acceptance version/timestamp fields on `app_users`
- Extended `GET /api/v1/me` read model with explicit `compliance` state:
  - required/accepted ToS and Privacy versions
  - acceptance timestamps
  - retention/delete/audit baseline mode summary
- Tightened onboarding completion semantics:
  - `completed` now requires workspace presence + required legal acceptance
  - `pending` is returned when either workspace or legal acceptance is missing
- Finalized MVP retention/delete baseline as explicit platform behavior:
  - no hidden TTL auto-purge behavior
  - delete remains explicit action-only
  - reset and ownership transfer/recovery stay non-delete actions
- Added ADR-046 and updated roadmap/docs for G4.
- Applied minimal corrective middleware route coverage for existing protected endpoints added in previous slices (Telegram secret lifecycle, admin abuse unblock, admin ownership transfer/recovery).

### Why changed

- G4 requires unambiguous real-platform retention/delete/compliance behavior with explicit user trust boundaries and no hidden retention surprises.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260329130000_step10_g4_retention_delete_compliance_baseline/migration.sql`
- `apps/api/src/modules/identity-access/application/compliance-baseline.ts`
- `apps/api/src/modules/identity-access/application/current-user-state.types.ts`
- `apps/api/src/modules/identity-access/application/get-current-user-state.service.ts`
- `apps/api/src/modules/identity-access/application/upsert-onboarding.service.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/api/test/step2-auth-foundation.e2e.test.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/046-retention-delete-compliance-baseline-g4.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/step2-auth-foundation.e2e.test.ts` — passed
- `corepack pnpm --filter @persai/web run test -- --run app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- G4 does not introduce enterprise retention scheduler/legal hold/regional retention matrix.
- G4 does not add full account/workspace erasure orchestration endpoint.
- Retention remains explicit user/action-driven in MVP; no silent background purge jobs.

### Next recommended step

- Step 10 **G5** WhatsApp and MAX readiness hardening.

### Ready commit message

- `feat(api-web-contracts): add step 10 g4 explicit retention-delete-compliance baseline with legal acceptance state`

## 2026-03-24 - Step 10 G3 recovery and ownership transfer baseline

### What changed

- Added admin-governed ownership flow service and API surfaces:
  - `POST /api/v1/admin/assistants/ownership/transfer`
  - `POST /api/v1/admin/assistants/ownership/recover`
- Added dedicated admin controller/service wiring for ownership transfer and ownership recovery with explicit guarded parsing and conflict checks.
- Extended dangerous admin action scope and step-up action parsing with:
  - `admin.assistant.transfer_ownership`
  - `admin.assistant.recover_ownership`
- Implemented ownership guardrails:
  - assistant must be in admin workspace scope
  - transfer flow requires `currentOwnerUserId` match
  - target owner must be member of assistant workspace
  - target owner must not already own another assistant (MVP one-user-one-assistant rule)
- Defined and returned explicit consequences for attached resources:
  - `resetTriggered=false`
  - `deletionTriggered=false`
  - lifecycle versions preserved
  - memory/chat/task ownership links rebound via assistant owner relation
  - bindings + SecretRef lifecycle metadata preserved
  - prior audit history preserved
- Added ownership-flow audit events:
  - `assistant.ownership_transferred`
  - `assistant.ownership_recovered`
- Added ADR-045 and updated roadmap/docs for G3.

### Why changed

- G3 requires explicit recovery and ownership transfer flows that remain separate from reset/delete semantics, enforce ownership boundaries through governed rules, and preserve audit/RBAC assumptions.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/manage-admin-assistant-ownership.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-assistant-ownership.controller.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/manage-admin-assistant-ownership.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/045-recovery-and-ownership-transfer-g3.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-assistant-ownership.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts` — passed

### Known risks / intentional limits

- No end-user self-service ownership transfer path in G3 (admin-governed flows only).
- No cross-workspace ownership migration in G3.
- Ownership transfer/recovery does not introduce automatic publish/reset/delete behavior and does not broaden into retention/compliance deletion workflows.

### Next recommended step

- Step 10 **G4** retention/delete/compliance baseline.

### Ready commit message

- `feat(api-contracts): add step 10 g3 admin ownership recovery and transfer flows with explicit resource consequences`

## 2026-03-24 - Step 10 G2 abuse and rate-limit enforcement baseline

### What changed

- Added canonical abuse/rate-limit persistence model:
  - `assistant_abuse_guard_states`
  - `assistant_abuse_assistant_states`
- Added centralized abuse protection service for web chat transport boundaries with explicit layered controls:
  - per-user-per-assistant throttle window
  - per-assistant aggregate throttle window
  - surface-aware anti-flood hooks (`web_chat` active baseline)
  - quota-pressure-aware slowdown and temporary block behavior
- Hardened web chat boundaries to enforce G2 abuse decisions and return 429 when active:
  - `POST /api/v1/assistant/chat/web`
  - `POST /api/v1/assistant/chat/web/stream` (prepare path)
- Added admin abuse override/unblock endpoint:
  - `POST /api/v1/admin/abuse-controls/unblock`
  - role gate: `ops_admin|security_admin|super_admin` (+ narrow owner fallback)
  - clears active abuse blocks/slowdowns and applies temporary override window
- Added audit event:
  - `admin.abuse_unblock_applied`
- Added ADR-044 and updated roadmap/docs for G2.

### Why changed

- G2 requires finalized multi-layer abuse/rate-limit protection that goes beyond one rule, preserves normal user flows, aligns with quotas, and gives operators explicit audited unblock recovery controls.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260329100000_step10_g2_abuse_rate_limit_enforcement/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-abuse-guard.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-abuse-guard.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-abuse-guard.repository.ts`
- `apps/api/src/modules/workspace-management/application/enforce-abuse-rate-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-abuse-controls.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-abuse-controls.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforce-abuse-rate-limit.test.ts`
- `apps/api/test/manage-admin-abuse-controls.test.ts`
- `packages/config/src/api-config.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/044-abuse-and-rate-limit-enforcement-g2.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/enforcement-points.test.ts` — passed

### Known risks / intentional limits

- G2 activates abuse enforcement on web chat boundaries only; Telegram/WhatsApp/MAX transport-path activation remains future slice work.
- Slowdown is implemented as temporary 429 response window (explicit retry friction), not delayed queue execution.
- G2 intentionally does not add content-moderation or semantic abuse classification systems.

### Next recommended step

- Step 10 **G3** recovery and ownership transfer flows.

### Ready commit message

- `feat(api-contracts): add step 10 g2 multi-layer abuse and rate-limit enforcement with admin unblock override`

## 2026-03-24 - Step 10 G1 secret lifecycle hardening baseline

### What changed

- Added canonical managed SecretRef lifecycle hardening in assistant governance `secret_refs` (`persai.secretRefs.v1`) with Telegram baseline entry `refs.telegram_bot_token`.
- Added Telegram secret lifecycle APIs:
  - `POST /api/v1/assistant/integrations/telegram/rotate`
  - `POST /api/v1/assistant/integrations/telegram/revoke`
  - `POST /api/v1/assistant/integrations/telegram/emergency-revoke`
- Extended Telegram connect payload to accept optional `ttlDays` (`1..365`) and rotate SecretRef lifecycle metadata during connect/rotate.
- Extended Telegram integration state response with non-sensitive `secretLifecycle` metadata:
  - lifecycle status (`active|revoked|emergency_revoked|expired|legacy_unmanaged`)
  - ref key / manager / version
  - rotate/revoke/expiration timestamps and legacy fallback marker
- Hardened OpenClaw channel/surface projection so Telegram provider readiness now checks binding + SecretRef lifecycle usability (with narrow legacy compatibility fallback for pre-G1 active bindings).
- Added secret lifecycle audit events:
  - `assistant.secret_ref_rotated`
  - `assistant.secret_ref_revoked`
  - `assistant.secret_ref_emergency_revoked`
- Added ADR-043 and updated roadmap/docs for G1.

### Why changed

- Product baseline requires managed secret lifecycle properties (rotation, revoke, TTL, audit, emergency revoke) while preserving SecretRef delivery discipline and avoiding secret-value exposure across UI/domain surfaces.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/assistant-secret-refs-lifecycle.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/test/assistant-secret-refs-lifecycle.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/043-secret-lifecycle-hardening-g1.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/assistant-secret-refs-lifecycle.test.ts` — passed

### Known risks / intentional limits

- G1 lifecycle hardening is implemented for assistant managed SecretRefs (Telegram baseline); broad provider matrix expansion is deferred.
- TTL is enforced at read/evaluation time (computed `expired` status); no background scheduler is added in this slice.
- Existing admin notification webhook `signingSecret` storage model is unchanged in G1.

### Next recommended step

- Step 10 **G2** abuse and rate limit enforcement.

### Ready commit message

- `feat(api-contracts): add step 10 g1 managed secret lifecycle rotation revoke ttl and emergency revoke for telegram secret refs`

## 2026-03-24 - Step 9 F6 progressive rollout and rollback controls baseline

### What changed

- Added platform rollout persistence model:
  - `assistant_platform_rollouts`
  - `assistant_platform_rollout_items`
- Added admin rollout APIs:
  - `GET /api/v1/admin/platform-rollouts`
  - `POST /api/v1/admin/platform-rollouts`
  - `POST /api/v1/admin/platform-rollouts/{rolloutId}/rollback`
- Added rollout service behavior for platform-managed layers:
  - validates bounded rollout patch payload
  - selects targeted assistants by rollout percentage
  - captures per-assistant pre-update governance snapshot
  - updates only platform-managed governance fields
  - triggers soft reapply against latest published version where available
  - stores per-assistant apply outcomes (`succeeded|degraded|failed|skipped`)
- Added explicit rollback behavior:
  - restores captured governance snapshots
  - reapply after restore to align runtime
  - records rollback outcomes and marks rollout operation as `rolled_back`
- Extended dangerous admin step-up action set:
  - `admin.rollout.apply`
  - `admin.rollout.rollback`
- Hardened dangerous role model to be action-scoped:
  - plan dangerous actions stay `business_admin|super_admin`
  - rollout dangerous actions require `ops_admin|super_admin`
  - legacy owner fallback remains compatibility path
- Added audit events for rollout operations:
  - `admin.platform_rollout_applied`
  - `admin.platform_rollout_rolled_back`
- Added `/app` owner section "Platform rollout controls" with:
  - rollout percent + target patch JSON form
  - rollback selector
  - recent rollout operation summary
- Added ADR-042 and updated roadmap/docs for F6.

### Why changed

- F6 requires real operator controls for progressive platform-managed updates with rollback support, while preserving immutable user-owned assistant version truth and keeping soft update behavior.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328220000_step9_f6_rollout_rollback_controls/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-platform-rollouts.service.ts`
- `apps/api/src/modules/workspace-management/application/platform-rollout.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-platform-rollouts.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/042-progressive-rollout-and-rollback-controls-f6.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F6 rollout targeting is percentage-based single-wave execution per request; no automatic staged scheduler is added.
- No automatic rollback-by-threshold policy in this slice.
- Rollout UI uses JSON patch input for platform-managed fields and intentionally does not add a full policy editor.

### Next recommended step

- Step 10 **G1** secret lifecycle hardening.

### Ready commit message

- `feat(api-web): add step 9 f6 progressive rollout and rollback controls for platform-managed updates`

## 2026-03-24 - Step 9 F5 admin system notifications baseline

### What changed

- Added admin system-notification channel persistence model:
  - `workspace_admin_notification_channels`
  - baseline channel type: `webhook`
- Added admin notification delivery log model:
  - `admin_notification_deliveries`
- Added admin notifications API surface:
  - `GET /api/v1/admin/notifications/channels`
  - `PATCH /api/v1/admin/notifications/channels/webhook`
- Added bounded admin notification channel RBAC rules:
  - read/list uses existing admin read surface authorization
  - webhook channel write/manage requires `ops_admin|security_admin|super_admin` (legacy owner fallback preserved)
- Added best-effort non-blocking webhook delivery integration on selected high-signal audit events:
  - `assistant.runtime.apply_failed`
  - `assistant.runtime.apply_degraded`
  - `assistant.runtime.apply_succeeded`
  - `admin.plan_created`
  - `admin.plan_updated`
- Added `/app` admin system-notifications section:
  - webhook channel enable/config form
  - channel state list with latest delivery summary
- Added ADR-041 and updated roadmap/docs for F5.

### Why changed

- F5 requires a mandatory admin notification channel so critical system signals can reach admins outside web UI while preserving web as the primary admin workspace.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328190000_step9_f5_admin_system_notifications/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-system-notification.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-notification-channels.service.ts`
- `apps/api/src/modules/workspace-management/application/deliver-admin-system-notification.service.ts`
- `apps/api/src/modules/workspace-management/application/append-assistant-audit-event.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-notifications.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/041-admin-system-notifications-f5.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F5 supports webhook channel baseline only; no provider matrix, escalation policies, or digest scheduling.
- Delivery is best-effort and non-blocking; retries/backoff orchestration is intentionally out of scope.
- Signal set is intentionally bounded to selected high-signal events in this slice.

### Next recommended step

- Step 9 **F6** progressive rollout and rollback controls baseline.

### Ready commit message

- `feat(api-web): add step 9 f5 admin system-notification channel baseline with webhook delivery`

## 2026-03-24 - Step 9 F4 business cockpit baseline

### What changed

- Added role-gated admin business cockpit endpoint:
  - `GET /api/v1/admin/business/cockpit`
- Added centralized business cockpit read-model service:
  - `ResolveAdminBusinessCockpitService`
  - returns bounded business views for:
    - active assistants
    - active chats
    - channel split
    - publish/apply success (last 7 days snapshot)
    - quota pressure
    - plan usage snapshot
- Added dedicated admin business cockpit UI section in `/app`:
  - serious, scanable read-only business view
  - separate from ops cockpit section
- Kept operational control surfaces in ops cockpit only; business cockpit remains visibility-only.
- Added ADR-040 and updated roadmap/docs for F4.

### Why changed

- F4 requires a compact business cockpit baseline so platform operators can track commercial/product health signals without turning admin UI into a heavy BI dashboard.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/business-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-business-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-business.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/040-business-cockpit-baseline-f4.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- F4 is a baseline snapshot and does not provide long-range BI analytics, trend charts, or export tooling.
- Channel split is bounded to available control-plane signals and currently reflects MVP channel reality.
- Business cockpit intentionally does not add lifecycle/runtime action controls.

### Next recommended step

- Step 9 **F5** admin system notifications baseline.

### Ready commit message

- `feat(api-web): add step 9 f4 business cockpit baseline with bounded commercial and product views`

## 2026-03-24 - Step 9 F3 ops cockpit baseline

### What changed

- Added role-gated admin ops cockpit read endpoint:
  - `GET /api/v1/admin/ops/cockpit`
- Added centralized ops cockpit read-model service:
  - `ResolveAdminOpsCockpitService`
  - returns bounded operator snapshot for:
    - assistant presence and latest published version
    - runtime apply status and error pointer
    - runtime preflight (`live|ready|checkedAt`)
    - topology awareness (`adapterEnabled`, OpenClaw host)
    - high-signal incident projections
- Added bounded incident signal model in cockpit payload:
  - `assistant_absent`
  - `assistant_not_published`
  - `runtime_preflight_unhealthy`
  - `runtime_apply_failed`
  - `runtime_apply_degraded`
  - `runtime_apply_in_progress`
- Added cockpit control visibility model:
  - `reapplySupported` surfaced when latest published version exists
  - `restartSupported` surfaced as `false` in F3 by design
- Added `/app` ops cockpit section (admin/owner surface) with:
  - assistant/runtime status summary
  - publish/apply truth
  - incident signal list
  - runtime topology line
  - `Reapply latest published version` button wired to existing `POST /api/v1/assistant/reapply`
- Added ADR-039 and updated roadmap/docs for Step 9 F3.

### Why changed

- F3 requires a serious and readable operational cockpit baseline so operators can understand assistant/runtime health and lifecycle truth without relying on raw logs or manual DB inspection.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/ops-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-ops.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `apps/web/app/globals.css`
- `docs/ADR/039-ops-cockpit-baseline-f3.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- F3 does not add restart/redeploy orchestration controls.
- F3 does not add historical BI, trends, or dense metrics dashboards.
- Cockpit is intentionally a bounded high-signal snapshot, not an incident timeline/explorer.

### Next recommended step

- Step 9 **F4** business cockpit baseline, reusing F3 operational truth and F1/F2 governance constraints.

### Ready commit message

- `feat(api-web): add step 9 f3 ops cockpit baseline with status signals and reapply control`

## 2026-03-24 - Step 9 F2 admin RBAC and dangerous-action step-up

### What changed

- Added explicit admin RBAC persistence model:
  - `app_user_admin_roles`
  - roles:
    - `ops_admin`
    - `business_admin`
    - `security_admin`
    - `super_admin`
- Added centralized admin authorization/step-up service:
  - `AdminAuthorizationService`
  - role-gated admin read access
  - dangerous admin action enforcement with signed short-lived step-up tokens
- Added admin step-up challenge endpoint:
  - `POST /api/v1/admin/step-up/challenge`
  - action-scoped challenge for:
    - `admin.plan.create`
    - `admin.plan.update`
- Hardened dangerous admin writes:
  - `POST /api/v1/admin/plans` requires `x-persai-step-up-token` for `admin.plan.create`
  - `PATCH /api/v1/admin/plans/{code}` requires `x-persai-step-up-token` for `admin.plan.update`
- Upgraded admin read auth checks from owner-only to role-based (with narrow owner fallback compatibility):
  - `GET /api/v1/admin/plans`
  - `GET /api/v1/admin/plans/visibility`
- Added audit role/actor context for admin actions:
  - new event: `admin.step_up_challenge_issued`
  - enriched events: `admin.plan_created`, `admin.plan_updated` with actor roles + step-up verified flags
- Contracts/OpenAPI updated for:
  - `POST /admin/step-up/challenge`
  - required step-up header on dangerous plan write operations
- Docs updated: ADR-038, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- F2 requires explicit non-collapsed admin role model and hardened dangerous-action confirmation flow so privileged admin operations are role-scoped and step-up protected.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328140000_step9_f2_admin_rbac_stepup/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/ADR/038-admin-rbac-and-stepup-f2.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed

### Known risks / intentional limits

- F2 does not add admin-role management API/UI (assignment/revocation workflows remain future scope).
- Step-up currently protects agreed dangerous plan write actions only; broader privileged-action matrix is future scope.
- Compatibility fallback (`workspace owner` -> implicit `business_admin`) remains intentionally narrow and transitional.

### Next recommended step

- Step 9 **F3** ops cockpit baseline using the F1/F2 audit + RBAC model as authorization and visibility foundation.

### Ready commit message

- `feat(api-web): add step 9 f2 admin rbac model and dangerous-action step-up enforcement`

## 2026-03-24 - Step 9 F1 append-only audit log hardening

### What changed

- Added canonical append-only audit persistence model:
  - `assistant_audit_events`
- Enforced append-only behavior at DB level for audit rows:
  - reject `UPDATE`
  - reject `DELETE`
- Added centralized audit append service in `workspace-management`:
  - `AppendAssistantAuditEventService`
- Wired critical high-signal audit coverage into existing control-plane flows:
  - assistant lifecycle:
    - `assistant.created`
    - `assistant.draft_updated`
    - `assistant.published`
    - `assistant.rollback_published`
    - `assistant.reset_published`
    - `assistant.reapply_requested`
  - runtime apply transitions:
    - `assistant.runtime.apply_in_progress`
    - `assistant.runtime.apply_succeeded`
    - `assistant.runtime.apply_failed`
    - `assistant.runtime.apply_degraded`
  - admin actions:
    - `admin.plan_created`
    - `admin.plan_updated`
  - policy/control:
    - `assistant.memory_forget_marker_appended`
  - channel binding and secret-adjacent token fingerprint change:
    - `assistant.telegram_connected`
    - `assistant.telegram_config_updated`
    - `assistant.telegram_token_fingerprint_updated`
- Docs updated: ADR-037, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- F1 requires critical control-plane and runtime-transition truth to be explicitly traceable in an append-only audit layer without turning audit into a noisy raw event dump.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328120000_step9_f1_append_only_audit_log_hardening/migration.sql`
- `apps/api/src/modules/workspace-management/application/append-assistant-audit-event.service.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/do-not-remember-assistant-memory.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `docs/ADR/037-append-only-audit-log-hardening-f1.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F1 does not add audit read/query APIs yet.
- F1 does not introduce broad chat-turn/event-stream raw dumping by design.
- There is still no dedicated secret management API in this slice; secret-adjacent coverage is limited to Telegram token fingerprint updates on connect.

### Next recommended step

- Step 9 **F2** admin RBAC and step-up actions, with audit events attached to privileged authorization transitions.

### Ready commit message

- `feat(api): add step 9 f1 append-only audit log hardening for lifecycle admin policy and runtime transitions`

## 2026-03-24 - Step 8 E6 provider and fallback baseline

### What changed

- Added explicit runtime provider/fallback projection service:
  - `ResolveRuntimeProviderRoutingService`
  - schema `persai.runtimeProviderRouting.v1`
- Added runtime routing model type:
  - `runtime-provider-routing.types.ts`
- Materialization now resolves provider routing baseline from:
  - effective capabilities
  - optional `policyEnvelope.runtimeProviderRouting` overrides
- Embedded `runtimeProviderRouting` into:
  - `openclawCapabilityEnvelope`
  - OpenClaw-facing materialization payloads (via existing envelope integration path)
- Added API validation script and test coverage:
  - `test:runtime-provider-routing`
  - updated envelope test fixture wiring for `runtimeProviderRouting`
- Docs updated: ADR-036, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- E6 requires explicit, resilient runtime primary/fallback behavior while keeping user-facing complexity minimal and aligned with existing entitlement/governance truth.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/runtime-provider-routing.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/runtime-provider-routing.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/036-provider-and-fallback-baseline-e6.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:runtime-provider-routing` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed

### Known risks / intentional limits

- E6 remains runtime-managed and provider-agnostic at execution level; it does not introduce vendor-level orchestration.
- No user-facing provider picker is added.
- No provider marketplace/plan-commerce provider packaging logic is added.

### Next recommended step

- Step 9 **F1** append-only audit log hardening.

### Ready commit message

- `feat(api): add step 8 e6 runtime provider fallback baseline routing`

## 2026-03-24 - Step 8 E5 integrations panel messenger presentation

### What changed

- Hardened `/app` user desktop integrations area into a messenger panel with three explicit cards:
  - Telegram
  - MAX
  - WhatsApp
- Telegram card now reflects real integration truth from E4:
  - `connected` state when binding exists
  - connectable state when allowed but not connected
  - not-allowed state when plan capability denies Telegram
- Preserved Telegram connect flow + post-connect configuration panel in the same card.
- MAX and WhatsApp are intentionally non-active in E5:
  - visually muted cards
  - explicit `Coming soon` labels
  - no connect action wired
- Added lightweight premium/warm card styling for uncluttered messenger presentation.
- Updated web app-flow tests to assert coming-soon state rendering.
- Docs updated: ADR-035, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E5 requires an honest user-facing integrations panel that matches messenger strategy and real binding truth without faking unsupported integrations.

### Files touched (high level)

- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `apps/web/app/globals.css`
- `docs/ADR/035-integrations-panel-messenger-presentation-e5.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- MAX and WhatsApp remain presentation-only in E5; connection and delivery are intentionally unsupported.
- Telegram card styling is premium baseline only; deeper polish belongs to later UX polish steps.

### Next recommended step

- Step 8 **E6** provider and fallback baseline over E1-E5 integration truths.

### Ready commit message

- `feat(web): add step 8 e5 messenger integrations panel with truthful states`

## 2026-03-24 - Step 8 E4 Telegram connection and delivery surface

### What changed

- Added canonical assistant-scoped channel binding persistence:
  - `assistant_channel_surface_bindings`
  - stores provider/surface state, policy/config, token fingerprint hint, and Telegram metadata
- Added Telegram integration control-plane endpoints:
  - `GET /assistant/integrations/telegram`
  - `POST /assistant/integrations/telegram/connect`
  - `PATCH /assistant/integrations/telegram/config`
- Implemented Telegram connect flow:
  - short token entry payload (`botToken`)
  - token verification via Telegram `getMe`
  - persisted `telegram` + `telegram_bot` active binding state
  - connected-state response payload (`persai.telegramIntegration.v1`) for UI
- Added web integrations-area UX for Telegram:
  - simple connect instruction flow + token input
  - connected state rendering
  - post-connect Telegram configuration panel
  - web remains primary control-plane surface
- Added best-effort bot profile sync:
  - display name and username from Telegram `getMe`
  - derived avatar URL when username is available
- Hardened E3 binding projection to read active Telegram binding truth from persistence (instead of static unconfigured assumption).
- Docs updated: ADR-034, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E4 requires real Telegram connection UX + persisted binding truth so Telegram can act as interaction/delivery surface without moving assistant control-plane ownership out of web.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260327120000_step8_e4_telegram_connection_surface/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-channel-surface-binding.repository.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/package.json`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/034-telegram-connection-and-delivery-surface-e4.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- E4 does not implement Telegram webhook ingestion or runtime delivery transport wiring; this slice is connect/config + binding truth.
- Raw Telegram bot token is not persisted in domain read model; connect flow uses verification and stores fingerprint/hint metadata for control-plane traceability.
- WhatsApp/MAX connection and delivery remain out of scope.

### Next recommended step

- Step 8 **E5** integrations panel and messenger binding UX expansion over the E4 Telegram connect baseline.

### Ready commit message

- `feat(api-web): add step 8 e4 telegram connect flow and binding surface`

## 2026-03-24 - Step 8 E3 channel and surface binding model hardening

### What changed

- Added explicit channel/surface binding projection resolver:
  - `ResolveOpenClawChannelSurfaceBindingsService`
  - schema `persai.openclawChannelSurfaceBindings.v1`
- Binding projection now models non-flat structure:
  - providers: `web_internal`, `telegram`, `whatsapp`, `max`, `system_notifications`
  - surfaces: `web_chat`, `telegram_bot`, `whatsapp_business`, `max_bot`, `max_mini_app`, `system_notification`
  - assistant-binding status/state at provider level
  - policy/config split at provider and surface levels
- Integrated `openclawChannelSurfaceBindings` into `openclawCapabilityEnvelope` and materialization outputs consumed by OpenClaw.
- Applied corrective hardening for prior channel assumptions:
  - preserved existing `channelsAndSurfaces.max` entitlement gate for compatibility
  - projected that gate into two distinct surfaces (`max_bot`, `max_mini_app`) to avoid flattening
- Added explicit unavailable-surface suppression list (`deniedSurfaceTypes` + `declaredSurfaceTypes`).
- Added API test script `test:openclaw-channel-surface-bindings` and updated envelope test to validate embedded channel/surface binding payload.
- Docs updated: ADR-033, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E3 requires provider+surface binding truth to be explicit and runtime-safe so OpenClaw can distinguish available, unavailable, and non-existent surfaces without Telegram-specific or flat-surface assumptions.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/openclaw-channel-surface-bindings.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/033-channel-surface-binding-model-e3.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed

### Known risks / intentional limits

- E3 is projection hardening only; no Telegram/WhatsApp/MAX delivery execution is implemented.
- Provider config refs are modeled as control-plane references and not connected to runtime channel provisioning in this slice.
- Existing plan entitlement source for MAX remains one coarse gate; split commercial/package controls for `max_bot` vs `max_mini_app` are deferred.

### Next recommended step

- Step 8 **E4** Telegram connection and delivery surface over the E3 binding baseline.

### Ready commit message

- `feat(api): add step 8 e3 channel-surface binding envelope hardening`

## 2026-03-24 - Step 8 E2 OpenClaw capability envelope hardening

### What changed

- Added explicit OpenClaw-facing capability envelope resolver:
  - `ResolveOpenClawCapabilityEnvelopeService`
  - schema `persai.openclawCapabilityEnvelope.v1`
- Materialization now projects `openclawCapabilityEnvelope` into:
  - governance layer snapshot
  - `openclawBootstrap`
  - `openclawWorkspace`
- Envelope now contains explicit runtime truth:
  - per-tool allow/deny + deny reason
  - per-group allow/deny lists
  - canonical declared tool set (`catalog.declaredToolCodes`) for exists/non-exists truth
  - per-surface allowances (`webChat|telegram|whatsapp|max`)
  - quota-related class restrictions for utility/cost-driving classes
  - explicit unavailable-tool suppression list (`deniedToolCodes`)
- Preserved tasks/reminders as non-commercial quota class in envelope restrictions:
  - `tasksAndRemindersExcludedFromCommercialQuotas`
- Added API test script `test:openclaw-capability-envelope`.
- Docs updated: ADR-032, `ARCHITECTURE`, `API-BOUNDARY`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E2 requires one explicit OpenClaw-facing capability envelope so runtime knows what exists, what is denied, and what is unavailable without relying on implied defaults.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/032-openclaw-capability-envelope-e2.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed

### Known risks / intentional limits

- E2 is projection hardening only; no backend runtime routing or tool execution framework is added.
- No per-tool admin UI control surface is added in E2.
- E2 does not introduce endpoint-by-endpoint per-tool enforcement expansion beyond existing control-plane gates.

### Next recommended step

- Step 8 **E3** channel/surface binding model hardening over the E1/E2 governance baseline.

### Ready commit message

- `feat(api): add step 8 e2 openclaw capability envelope with explicit suppression truth`

## 2026-03-24 - Step 8 E1 tool catalog and activation model

### What changed

- Added canonical governed tool catalog persistence:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- Added explicit tool model dimensions for control-plane governance:
  - capability group (`knowledge|automation|communication|workspace_ops`)
  - tool class (`cost_driving|utility`)
  - plan-scoped activation status (`active|inactive`)
- Hardened plan catalog create/update persistence flow:
  - plan tool-activation rows are synchronized from existing tool-class entitlement toggles
- Added centralized per-tool availability resolver:
  - `ResolveEffectiveToolAvailabilityService`
  - projects catalog + plan activation + effective class guardrail into materialization-safe truth
- Upgraded materialized tool-availability schema from class-only to per-tool model:
  - `persai.effectiveToolAvailability.v2`
- Added deterministic seed baseline tool catalog rows and default-plan activation rows.
- Docs updated: ADR-031, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E1 requires tools to be treated as a governed mini-system with explicit catalog and activation truth, while preserving the backend control-plane vs OpenClaw runtime boundary.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260327100000_step8_e1_tool_catalog_activation/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/application/effective-tool-availability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-tool-availability.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/tool-catalog-activation.test.ts`
- `apps/api/package.json`
- `docs/ADR/031-tool-catalog-and-activation-model-e1.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- E1 introduces persistence + materialization truth only; no per-tool admin/web UI controls are added in this slice.
- E1 does not add backend tool execution/routing logic; OpenClaw remains runtime execution owner.
- Class-level enforcement points from P6 remain active; endpoint-by-endpoint per-tool enforcement is not expanded in E1.

### Next recommended step

- Step 8 **E2** tool policy and OpenClaw capability envelope alignment over the E1 catalog/activation baseline.

### Ready commit message

- `feat(api): add step 8 e1 governed tool catalog and plan activation model`

## 2026-03-23 - Step 7 P1-P7 post-deploy live validation + hotfixes

### What changed

- Completed live validation on dev GKE for Step 7 P1-P7 user/admin flows after deploy.
- Verified deployed images aligned to the current release commit for both `api` and `web`.
- Confirmed live route availability and successful auth-gated responses for:
  - `GET /api/v1/admin/plans`
  - `GET /api/v1/admin/plans/visibility`
  - `GET /api/v1/assistant/plan-visibility`
- Confirmed admin plan creation and editing in UI and API:
  - `POST /api/v1/admin/plans` returns success (`201`)
  - `PATCH /api/v1/admin/plans/:code` returns success (`200`)
- Confirmed chat streaming happy path after entitlement correction:
  - stream completes
  - response persists
  - "Do not remember this" action remains available on committed assistant turns.
- Fixed two post-deploy regressions discovered during validation:
  - contracts path regression: `postAdminPlanCreate` was erroneously attached to `/admin/plans/visibility` in OpenAPI and was restored to `/admin/plans`
  - web client response guard: admin create path now accepts `201` and `200` as success for `POST /admin/plans`
- Regenerated contracts and revalidated web typecheck/tests.

### Why changed

- Deployment initially surfaced false 404 and false non-success errors caused by contract/client mismatch, not by backend route availability.
- This live pass was required to confirm P1-P7 product behavior end-to-end under real runtime conditions.

### Files touched (high level)

- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test` — passed
- Live cluster verification (`kubectl` + runtime logs) — passed for the P1-P7 target flows

### Known risks / intentional limits

- `Plan state: unconfigured` remains expected when no explicit workspace subscription lifecycle row is present; effective plan can still resolve via fallback.
- Prisma OpenSSL warning remains visible in API logs; it is not a blocker for current functionality but should be hardened in base image later.

### Next recommended step

- Start Step 8 E1 (tool catalog and activation model) and extend visibility from class-level to per-tool level once catalog primitives are introduced.

### Ready commit message

- `fix(web-contracts): align admin plan create route and 201 handling; document step7 live validation`

## 2026-03-26 - Step 7 P7 plan visibility read models

### What changed

- Added user-facing plan visibility endpoint:
  - `GET /api/v1/assistant/plan-visibility`
  - returns effective plan state plus key commercial limits as percentages only
- Added admin-facing plan visibility endpoint:
  - `GET /api/v1/admin/plans/visibility`
  - returns plan catalog state snapshot, usage pressure percentages/level, and effective entitlement snapshot
- Added centralized read-model service:
  - `ResolvePlanVisibilityService`
  - resolves visibility from existing P1-P6 control-plane truth (plan catalog, subscription resolution, capability resolution, quota state)
- Updated web `/app` to surface:
  - user-facing "Plan and limits visibility" section
  - owner-only "Admin plan visibility" section
- Updated OpenAPI/contracts and web API client for the new endpoints/types.
- Docs updated: ADR-030, `API-BOUNDARY`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P7 requires plans/limits/entitlements to be visible in product-correct, calm UX language while preserving backend governance boundaries and avoiding a noisy billing dashboard.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/plan-visibility.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/030-plan-visibility-read-models-p7.md`
- `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test` — passed

### Known risks / intentional limits

- P7 provides snapshot visibility read models, not historical BI/reporting timelines.
- P7 keeps class-level tool visibility and does not introduce per-tool catalog UI.
- No billing-provider workflow UI (checkout/invoices/payment/tax) is added.

### Next recommended step

- Step 8 **E1** tool catalog and activation model, using P7 visibility as the baseline operator/user read surface.

### Ready commit message

- `feat(api-web): add step 7 p7 user and admin plan visibility read models`

## 2026-03-26 - Step 7 P6 enforcement points baseline

### What changed

- Added centralized enforcement layer service: `EnforceAssistantCapabilityAndQuotaService`.
- Activated P6 enforcement at agreed control-plane boundaries:
  - sync web chat send flow
  - streaming web chat prepare flow
- Enforcement checks now executed in one place:
  - capability checks:
    - web chat channel availability
    - text media class availability
    - utility tool-class availability
  - quota/cap checks:
    - active web chats cap for new-thread creation
    - token budget limit
    - cost/token-driving tool-class limit when quota-governed
- Added read access for workspace quota accounting state in repository boundary for enforcement.
- Materialization now includes explicit `toolAvailability` (`persai.effectiveToolAvailability.v1`) in:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document
- Added API test script: `test:enforcement-points`.
- Docs updated: ADR-029, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P6 turns P1-P5 plan/entitlement/capability/quota state into active product rules at explicit control-plane boundaries while keeping backend out of runtime behavior routing.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforcement-points.test.ts`
- `apps/api/package.json`
- `docs/ADR/029-enforcement-points-p6.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- P6 enforces at current agreed boundaries (web chat send/stream prepare); broader endpoint-by-endpoint enforcement remains future hardening scope.
- `toolAvailability` in P6 is class-level truth only; per-tool catalog activation remains Step 8 scope.
- Backend still does not route runtime tool behavior.

### Next recommended step

- Step 7 **P7** user/admin plan visibility over enforced limits/capabilities and percentage-oriented quota UX read models.

### Ready commit message

- `feat(api): add step 7 p6 centralized capability and quota enforcement points`

## 2026-03-26 - Step 7 P5 quota accounting baseline

### What changed

- Added canonical quota accounting persistence in API Prisma model:
  - `workspace_quota_accounting_state` (workspace latest counters/limits)
  - `workspace_quota_usage_events` (append-only usage/snapshot events)
- Added explicit quota dimensions enum:
  - `token_budget`
  - `cost_or_token_driving_tool_class`
  - `active_web_chats_cap`
- Added centralized `TrackWorkspaceQuotaUsageService` in `workspace-management` application layer to avoid scattered/runtime-hidden quota logic.
- Wired quota tracking into existing control-plane flows:
  - sync web chat turn (token + cost/token-driving usage)
  - stream web chat turn completed/partial outcomes (token + cost/token-driving usage)
  - active web chats snapshot refresh on prepare/archive/hard-delete paths
- Added workspace quota repository boundary + Prisma implementation.
- Added provider-agnostic quota default config values:
  - `QUOTA_TOKEN_BUDGET_DEFAULT`
  - `QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT`
  - with existing `WEB_ACTIVE_CHATS_CAP` for active chat cap limit
- Added `test:quota-accounting` API script.
- Docs updated: ADR-028, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P5 requires explicit quota accounting for commercially meaningful dimensions while keeping tasks/reminders outside commercial quota limits and preserving P1-P4 architecture boundaries.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326220000_step7_p5_quota_accounting/migration.sql`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.entity.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/quota-accounting.test.ts`
- `apps/api/package.json`
- `packages/config/src/api-config.ts`
- `apps/api/.env.local.example`, `apps/api/.env.dev.example`
- `infra/helm/values.yaml`, `infra/helm/values-dev.yaml`
- `docs/ADR/028-quota-accounting-baseline-p5.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- No billing provider integration, invoicing/tax flows, or BI/reporting expansion in P5.
- No new public quota API endpoints in this slice.
- Token budget in P5 uses deterministic estimator (`chars_div_4_ceil_v1`) until runtime token telemetry is formalized.
- Enforcement matrix is not added in P5 (next slice scope).
- Tasks/reminders remain intentionally excluded from commercial quota accounting.

### Next recommended step

- Step 7 **P6** enforcement points using P4 effective capability state + P5 accounting counters.

### Ready commit message

- `feat(api): add step 7 p5 quota accounting baseline for token toolclass and active-web-chat dimensions`

## 2026-03-26 - Step 7 P4 capability resolution engine

### What changed

- Added centralized capability resolution service `ResolveEffectiveCapabilityStateService` with output schema `persai.effectiveCapabilities.v1`.
- Resolution inputs are now unified in one place:
  - P3 effective subscription state
  - P1/P2 plan catalog entitlements
  - assistant governance capability envelope
- Resolution output includes explicit effective allowances for:
  - tool classes
  - channels/surfaces
  - media classes
  - governed features
- Materialization now embeds `effectiveCapabilities` into:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document
- Added API test `test:capability-resolution`.
- Applied minimal corrective hardening required by P4:
  - `findByCode` plan lookup now resolves by `code` regardless of plan status, so existing subscriptions pinned to inactive plans still resolve effective capability baseline.
- Docs updated: ADR-027, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P4 requires one explicit reusable capability truth source for enforcement layers and runtime projection without duplicating logic or turning backend into behavior routing.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/effective-capability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-capability-state.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts` (minimal corrective hardening)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/capability-resolution.test.ts`
- `apps/api/package.json`
- `docs/ADR/027-capability-resolution-engine-p4.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- P4 computes and propagates effective capability truth but does not yet enforce every endpoint/action.
- Media-class allowance baseline is conservative and governance-driven; richer plan-level media entitlements remain future scope.
- No billing-provider or quota-accounting expansion in this slice.

### Next recommended step

- Step 7 **P5** quota accounting baseline, consuming P4 effective capability outputs.

### Ready commit message

- `feat(api): add step 7 p4 centralized capability resolution engine and materialization projection`

## 2026-03-26 - Step 7 P3 subscription state and billing abstraction boundary

### What changed

- Added canonical subscription persistence model:
  - Prisma enum `WorkspaceSubscriptionStatus`
  - table/model `workspace_subscriptions` (workspace-scoped subscription state)
- Added provider-agnostic billing boundary:
  - `BillingProviderPort` + normalized snapshot contract
  - null/no-op adapter baseline (`NullBillingProviderAdapter`) with no vendor integration
- Added effective subscription resolution service:
  - `ResolveEffectiveSubscriptionStateService`
  - precedence: workspace subscription -> assistant `quotaPlanCode` -> catalog default -> none
  - fallback status `unconfigured` for unresolved non-provider states
- Added repository boundary for workspace subscriptions and Prisma implementation.
- Added API test script `test:subscription-state` covering precedence behavior.
- Seed baseline now includes workspace subscription state for seeded workspace (`starter_trial`, `trialing`).
- Docs updated: ADR-026, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P3 establishes provider-agnostic subscription truth and future billing integration hooks without redesigning P1/P2 plan structures.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- migration `20260326200000_step7_p3_subscription_state_and_billing_boundary`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-subscription.*`
- `apps/api/src/modules/workspace-management/application/billing-provider.port.ts`
- `apps/api/src/modules/workspace-management/application/effective-subscription.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-subscription-state.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/billing/null-billing-provider.adapter.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-subscription.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/subscription-state-resolve.test.ts`
- `apps/api/package.json`
- `docs/ADR/026-subscription-state-and-billing-abstraction-p3.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:subscription-state` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- No concrete billing provider integration, webhooks, invoice/tax/payment flows in P3.
- Subscription state is modeled and resolved in backend control plane; no new public subscription API surface in this slice.
- Entitlement/quota enforcement engine remains out of scope.

### Next recommended step

- Step 7 **P4** capability resolution engine using P1/P2 catalog + P3 effective subscription resolution.

### Ready commit message

- `feat(api): add step 7 p3 workspace subscription state and billing abstraction boundary`

## 2026-03-26 - Step 7 P2 admin plan management UI/API

### What changed

- Added owner-gated admin plan management API:
  - `GET /api/v1/admin/plans`
  - `POST /api/v1/admin/plans`
  - `PATCH /api/v1/admin/plans/{code}`
- Added centralized plan management application service (`ManageAdminPlansService`) and expanded plan catalog repository for list/create/update flows.
- Added `/app` owner-only admin section for plan create/edit with serious control-plane forms:
  - naming and metadata
  - default-on-registration
  - trial + duration
  - entitlement and limits controls
- Extended contracts/OpenAPI + generated client models for admin plan endpoints and payloads.
- Docs updated: ADR-025, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P2 requires direct admin-side plan packaging controls without coupling to a billing vendor or exposing raw DB internals.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `docs/ADR/025-admin-plan-management-p2.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- No billing provider console/workflow in P2 (checkout, subscription lifecycle, invoices/webhooks remain out of scope).
- Owner-gate uses workspace owner check; full admin RBAC expansion remains Step 9 scope.
- Entitlement enforcement runtime/quotas are not added in P2; this slice is plan management control surface only.

### Next recommended step

- Step 7 **P3** subscription state + billing abstraction, keeping P1/P2 provider-agnostic boundaries intact.

### Ready commit message

- `feat(api-web): add step 7 p2 owner-gated admin plan management ui and api`

## 2026-03-26 - Step 7 P1 plan catalog and entitlement model

### What changed

- Added canonical plan catalog persistence:
  - `plan_catalog_plans` (`code`, `status`, provider-agnostic metadata, `isDefaultFirstRegistrationPlan`, `isTrialPlan`, `trialDurationDays`)
  - `plan_catalog_entitlements` (1:1 by plan with grouped entitlement JSON arrays for capabilities, tool classes, channels/surfaces, limits permissions)
- Added DB integrity constraints:
  - partial unique index for single default first-registration plan
  - trial duration check (`is_trial_plan=false => null`, `is_trial_plan=true => >0`)
- Governance baseline creation now resolves `quotaPlanCode` from active default-first-registration plan in catalog (nullable fallback when catalog is empty).
- Seed baseline now inserts/updates provider-agnostic default trial plan `starter_trial` (14 days) and canonical entitlement payload.
- Docs updated: ADR-024, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P1 makes plan packaging and entitlement truth explicit in the control plane without coupling to a billing vendor or introducing subscription workflow scope.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326170000_step7_p1_plan_catalog_entitlements/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `docs/ADR/024-plan-catalog-and-entitlements-p1.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- No plan-management API/UI in P1.
- No billing provider workflows (checkout, subscription state machine, invoices/webhooks).
- No entitlement enforcement engine yet; P1 defines canonical storage and governance default assignment only.

### Next recommended step

- Step 7 **P2** admin plan management UI (or management API first) while keeping P1 provider-agnostic model unchanged.

### Ready commit message

- `feat(api): add step 7 p1 canonical plan catalog and entitlement model`

## 2026-03-26 - Step 6 D5 Tasks Center MVP

### What changed

- Added **`assistant_task_registry_items`** and APIs: list tasks, pause (`disable`), resume (`enable`), stop (`cancel`), with sorting and **409** when `tasks_control` denies an action.
- Web **Tasks** section in the assistant editor (after Memory): Active / Inactive groups, source pill, next-run messaging, warm copy; **EDITOR_SECTIONS** includes `Tasks`.
- OpenAPI/contracts + Clerk middleware routes; `globals.css` task-center styling; `test:tasks-user-controls`; web tests for Tasks nav + mocked list.
- Docs: ADR-023, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `DESIGN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D5 delivers the agreed Tasks Center MVP: inspect and control reminders/tasks without exposing raw runtime or building a workflow designer.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`, migration `20260326120000_step6_d5_tasks_center_registry`
- `apps/api/src/modules/workspace-management/**` (task domain, repo, services, controller, module, `tasks-user-controls.ts`)
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/web/app/app/app-flow.client.tsx`, `assistant-api-client.ts`, `app-flow.client.test.tsx`, `globals.css`
- `apps/api/test/tasks-user-controls.test.ts`, `apps/api/package.json`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `docs/ADR/023-tasks-center-mvp-d5.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/api run test:tasks-user-controls` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires Postgres)

### Known risks / intentional limits

- Registry may stay **empty** until OpenClaw/sync (or ops) inserts rows; UI explains that honestly.
- Control actions update **PersAI registry state only** in D5; runtime must consume/sync separately.
- Cancelled items cannot be re-enabled from the API.

### Next recommended step

- Step 7 **P1** plan catalog (per `docs/ROADMAP.md`) or wire task registry population from OpenClaw when contract-ready.

### Ready commit message

- `feat(api-web): add step 6 d5 tasks center registry and ui`

## 2026-03-25 - Step 6 D4 tasks control domain hardening

### What changed

- Added canonical **`tasks_control`** on `assistant_governance` with default **`persai.tasksControl.v1`**: ownership (`user_assistant_owner`), source/surface hooks (`knownSurfaces`, `requireSurfaceTag`), control lifecycle **labels** (`statusKinds` + `executionOwnedBy: openclaw_runtime`), enable/disable and cancel flags, **`commercialQuota.tasksExcludedFromPlanQuotas: true`**, audit delegation to governance `auditHook`.
- Resolution + materialization: **`openclawWorkspace.tasksControl`** uses column → `policyEnvelope.tasksControl` → defaults; governance layer snapshot includes raw `tasksControl`.
- API/OpenAPI/contracts: **`governance.tasksControl`** on assistant lifecycle reads.
- **PRODUCT.md** corrected: tasks/reminders are not a commercial quota dimension (aligned with envelope).
- Docs: ADR-022, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D4 hardens the hybrid model: PersAI owns control/visibility metadata; OpenClaw owns execution — without a backend scheduler or task router.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`, migration `20260325120000_step6_d4_tasks_control_domain`
- `apps/api/src/modules/workspace-management/domain/assistant-tasks-control.defaults.ts`, `tasks-control-resolve.ts`, `assistant-governance.entity.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`, `assistant-lifecycle.mapper.ts`, `assistant-lifecycle.types.ts`
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/api/test/tasks-control-resolve.test.ts`, `apps/api/package.json`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/022-tasks-control-domain-d4.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run test:tasks-control` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires Postgres)

### Known risks / intentional limits

- No task rows, list APIs, or UI (D5); envelope is control-plane only.
- OpenClaw must still interpret `openclawWorkspace.tasksControl` if/when runtime integration needs it.

### Next recommended step

- Step 7 **P1** plan catalog (per `docs/ROADMAP.md`) or OpenClaw task-registry population when ready.

### Ready commit message

- `feat(api): add step 6 d4 tasks control envelope and materialization`

## 2026-03-24 - Step 6 D3 memory source policy enforcement

### What changed

- Enforced global memory **read** policy on all Memory Center–related APIs (list, forget-by-id, do-not-remember) using `globalMemoryReadAllSurfaces` on the resolved `memory_control` envelope.
- Enforced global **registry write** policy after successful web chat turns: caller supplies explicit `memoryWriteContext` (`web` + `trusted_1to1`); denies `group` and non–trusted-1:1 classifications; requires surface in both allowed and trusted 1:1 write lists.
- Extended default `memory_control` with `trustedOneToOneGlobalWriteSurfaces` and `sourceClassification`; Prisma migration backfills existing JSON documents.
- Docs: ADR-021, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D3 requires the agreed memory source policy to be **evaluated in code**, not implied by JSON alone, with explicit trust/surface classification in the control model.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/domain/memory-source-policy.ts`, `memory-control-resolve.ts`, `assistant-memory-control.defaults.ts`
- `apps/api/src/modules/workspace-management/application/record-web-chat-memory-turn.service.ts`, `send-web-chat-turn.service.ts`, `stream-web-chat-turn.service.ts`, `list-assistant-memory-items.service.ts`, `forget-assistant-memory-item.service.ts`, `do-not-remember-assistant-memory.service.ts`, `materialize-assistant-published-version.service.ts`
- `apps/api/prisma/migrations/20260324160000_step6_d3_memory_source_policy_envelope/migration.sql`
- `apps/api/test/memory-source-policy.test.ts`, `apps/api/package.json`
- `docs/ADR/021-memory-source-policy-d3.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run test:memory-policy` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires local Postgres)

### Known risks / intentional limits

- Only **web** is a typed transport surface; channel/group ingest is intentionally unsupported—future surfaces must thread explicit `GlobalMemoryWriteAttemptContext`.
- Disabling `denyGroupSourcedGlobalWrites` still does not allow group → global registry (explicit not-supported path).
- Registry write denial **skips** registry insert only; chat completion remains successful.

### Next recommended step

- Step 6 **D5** Tasks Center MVP (per `docs/ROADMAP.md`).

### Ready commit message

- `feat(api): enforce step 6 d3 global memory source policy`

## 2026-03-23 - Step 6 D2 Memory Center MVP

### What changed

- Delivered Memory Center MVP (web): list of calm one-line summaries from completed web chat turns, source/type pill, forget-from-list, and “Do not remember this” on streamed assistant messages after IDs reconcile to server UUIDs.
- Backend: table `assistant_memory_registry_items`, record hook after successful `SendWebChatTurnService` / `StreamWebChatTurnService` completion, list/forget/do-not-remember endpoints, governance `forgetRequestMarkers` append on do-not-remember.
- Contracts/OpenAPI + Clerk middleware routes; minimal global CSS for memory cards and quiet buttons.
- Docs: ADR-020, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP` (D2 done), `CHANGELOG`, this handoff.

### Why changed

- D2 requires a trustworthy user-facing memory surface without raw OpenClaw internals or an admin console.

### Files touched (high level)

- `apps/api/prisma/*`, new migration `20260324140000_step6_d2_memory_center_registry`
- `apps/api/src/modules/workspace-management/**` (memory services, repos, controller, stream/send wiring)
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/web/app/app/app-flow.client.tsx`, `assistant-api-client.ts`, `app-flow.client.test.tsx`, `globals.css`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `docs/ADR/020-memory-center-mvp-d2.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm run prisma:migrate:check` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm --filter @persai/web run build` — passed

### Known risks / intentional limits

- Summaries are derived from web chat transcripts, not a live export of OpenClaw runtime memory.
- Interrupted/partial stream turns do not create registry rows.
- Do-not-remember appends control-plane markers; runtime application in OpenClaw is not implemented in this slice.

### Next recommended step

- Step 6 `D3` memory source policy enforcement (ingest/write gates) building on registry + `memory_control`.

### Ready commit message

- `feat(api-web): add step 6 d2 memory center and web chat do-not-remember`

## 2026-03-23 - Step 6 D1 memory control domain hardening

### What changed

- Hardened backend memory **control plane** while keeping OpenClaw as runtime memory behavior owner:
  - added Prisma column `assistant_governance.memory_control` and migration with backfill from `policyEnvelope.memoryControl` when set
  - seeded new assistants with default `persai.memoryControl.v1` envelope (`createDefaultMemoryControlEnvelope`)
  - materialization now resolves effective memory control from column → legacy nested key → default
  - included `memoryControl` in materialization governance layer snapshot for auditability
  - exposed `governance.memoryControl` on assistant lifecycle API + OpenAPI/contracts
- Documented boundary in `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, ADR-019; marked D1 complete in `docs/ROADMAP.md`.

### Why changed

- D1 requires explicit governable memory policy/hooks/markers in the control plane without moving runtime memory mechanics into `apps/api`.
- Prior code only read optional `policyEnvelope.memoryControl` during materialization; there was no canonical persisted baseline.

### Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260324120000_step6_d1_memory_control_domain/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-governance.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-memory-control.defaults.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts
- apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- apps/web/app/app/app-flow.client.test.tsx
- docs/ADR/019-memory-control-domain-d1.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm run prisma:migrate:check` — passed (local Postgres)
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks

- Existing materialized specs keep prior `content_hash` until republish/reapply path creates a new spec; new publishes pick up enriched governance layer including `memoryControl`.
- Clients must tolerate new `governance.memoryControl` field (nullable object).

### Next recommended step

- Step 6 `D2` Memory Center MVP (read-focused UX) using `governance.memoryControl` + future memory list APIs as designed.

### Ready commit message

- `feat(api): add step 6 d1 memory control envelope and materialization wiring`

## 2026-03-23 - OpenClaw patch protection hardening

### What changed

- Added deploy-safety protections around OpenClaw compatibility patch usage:
  - added `infra/dev/gitops/validate-openclaw-compat-patch.sh`
    - resolves pinned SHA from `infra/dev/gitops/openclaw-approved-sha.txt`
    - materializes OpenClaw at that exact SHA
    - runs `git apply --check` for `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`
  - wired the validator into `.github/workflows/ci.yml` so malformed patch files fail in CI before deployment workflows
  - strengthened `.github/workflows/openclaw-dev-image-publish.yml` patch step by adding an explicit `git apply --check` preflight before `git apply`

### Why changed

- Deploy failed with `error: corrupt patch at line 15` during patch apply.
- This adds an early deterministic gate so patch formatting or drift issues are caught before image publish/deploy path.

### Files touched

- infra/dev/gitops/validate-openclaw-compat-patch.sh
- .github/workflows/ci.yml
- .github/workflows/openclaw-dev-image-publish.yml
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- Not run locally in this slice (workflow and script hardening only).

### Known risks

- Validation depends on cloning `OPENCLAW_FORK_REPO`; transient GitHub/network outages can fail the guard even when patch is valid.
- Guard checks patch applicability against the pinned SHA only; patch may still fail if workflow target SHA is changed without updating the pin.

### Next recommended step

- Trigger CI once to confirm validator pass, then trigger `OpenClaw Dev Image Publish` to verify apply preflight and publish path end-to-end.

### Ready commit message

- `ci(gitops): add openclaw patch preflight validation guards`

## 2026-03-23 - Step 5 C6 chat error/degradation UX slice

### What changed

- Completed Step 5 slice `C6` only (human-friendly chat error/degradation UX):
  - added web chat UX error-classification layer in `apps/web` API client
  - mapped transport/runtime failures to user-facing classes with guidance:
    - auth/session
    - input validation
    - assistant-not-live lifecycle gate
    - active chat cap
    - runtime unreachable
    - runtime timeout
    - runtime degraded
    - runtime auth failure
    - provider/tool/channel-style failures
    - stream incomplete/partial outcomes
  - updated web chat UI to show friendly issue message + next-step guidance instead of raw error text
  - preserved honest streaming behavior:
    - partial outputs remain visible and preserved
    - failure/degradation guidance remains explicit but non-technical
  - updated docs:
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C6` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C6 requires user-facing clarity for chat degradation/error states without leaking runtime internals.
- Prior path could surface raw backend/runtime message text directly.
- New layer keeps messaging honest and actionable while preserving admin/support depth separation.

### Files touched

- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C6 classification is rule-based message/status mapping, not a dedicated centralized taxonomy service.
- Support/admin diagnostic depth remains intentionally outside normal user path and is not surfaced in this UI slice.

### Next recommended step

- Start Step 6 `D1` memory control domain while preserving C1-C6 chat boundary and UX behavior.

### Ready commit message

- `feat(web): add step 5 c6 human-friendly chat degradation and error UX classes`

## 2026-03-23 - Step 5 C5 active web chats cap slice

### What changed

- Completed Step 5 slice `C5` only (active web chats cap enforcement):
  - added backend cap enforcement for web chat transport paths:
    - synchronous path (`C2`) in `SendWebChatTurnService`
    - streaming path (`C3`) in `StreamWebChatTurnService`
  - cap is checked only when creating a **new** web chat thread (`surfaceThreadKey` not yet present)
  - existing thread turns continue to work even when cap is reached
  - cap counts active chats only (`archivedAt = null`)
  - added admin-configurable API config/env threshold:
    - `WEB_ACTIVE_CHATS_CAP` (default `20`)
  - wired cap env into examples and Helm values:
    - `apps/api/.env.local.example`
    - `apps/api/.env.dev.example`
    - `infra/helm/values.yaml`
    - `infra/helm/values-dev.yaml`
  - web `/app` now shows explicit user-facing guidance when cap is reached
  - updated docs:
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C5` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C5 requires a real, user-visible enforcement point for active web chat limits.
- The limit must block new chat creation explicitly without silent failure or destructive side effects.
- Cap must stay operationally tunable by admins without introducing billing implementation scope.

### Files touched

- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts
- apps/web/app/app/app-flow.client.tsx
- packages/config/src/api-config.ts
- apps/api/.env.local.example
- apps/api/.env.dev.example
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C5 currently enforces a single global per-assistant web active-chat cap value from API config; no plan/tier-specific limits yet.
- Cap enforcement is transport-path based (new-thread creation point), not a separate dedicated quota subsystem.
- C6 degradation/error UX refinements are not yet implemented.

### Next recommended step

- Proceed to Step 5 `C6` (chat error/degradation UX) while preserving explicit C5 cap guidance and non-destructive cap behavior.

### Ready commit message

- `feat(api-web): add step 5 c5 active web chats cap enforcement and guidance`

## 2026-03-23 - Step 5 C4 web chat list and actions slice

### What changed

- Completed Step 5 slice `C4` only (GPT-style web chat list and core chat actions):
  - added backend web chat list endpoint:
    - `GET /api/v1/assistant/chats/web`
  - added backend chat actions:
    - rename: `PATCH /api/v1/assistant/chats/web/:chatId`
    - archive: `POST /api/v1/assistant/chats/web/:chatId/archive`
    - hard delete: `DELETE /api/v1/assistant/chats/web/:chatId`
  - hard delete requires explicit confirmation payload:
    - `confirmText=DELETE`
  - implemented hard delete as true destructive delete:
    - removes chat row
    - removes related chat message rows
    - no soft-delete aliasing
  - added list metadata projection from canonical records:
    - `messageCount`
    - `lastMessagePreview`
    - timestamps and archive state
  - updated web `/app` with GPT-style chat list UI and actions:
    - open thread in composer
    - rename
    - archive
    - hard delete with explicit typed confirmation
  - updated contracts/docs:
    - OpenAPI + generated contract client/models
    - ADR `docs/ADR/018-web-chat-list-and-destructive-actions.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C4` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C4 requires user-facing chat management controls, not only transport/send UX.
- GPT-style chat list actions are now mapped to canonical backend records introduced in C1.
- Delete behavior is kept explicit and honest: destructive delete must not be masked as archive.

### Files touched

- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts
- apps/api/src/modules/workspace-management/application/web-chat.types.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- docs/ADR/018-web-chat-list-and-destructive-actions.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C4 list metadata preview is basic text projection (no rich excerpt formatting yet).
- Hard delete is irreversible by design and removes persisted history records.
- Telegram chat management remains out of scope.

### Next recommended step

- Proceed to Step 5 `C5` (active web chats cap) while preserving explicit archive/delete semantics from C4.

### Ready commit message

- `feat(web-api): add step 5 c4 web chat list with rename archive and hard delete`

## 2026-03-23 - Step 5 C3 streaming web chat slice

### What changed

- Completed Step 5 slice `C3` only (streaming-first web chat transport and UI path):
  - added backend streaming endpoint:
    - `POST /api/v1/assistant/chat/web/stream`
  - added streaming application service orchestration:
    - pre-stream lifecycle/apply gate enforcement
    - canonical user message persistence before stream starts
    - runtime stream delta handling
    - explicit completion/interruption/failure outcomes
  - added OpenClaw adapter streaming boundary method:
    - calls `POST /api/v1/runtime/chat/web/stream`
    - parses NDJSON runtime stream chunks (`delta|done`)
  - extended OpenClaw compatibility patch with streaming runtime endpoint:
    - `POST /api/v1/runtime/chat/web/stream`
  - kept C2 request/response transport endpoint in place for compatibility, but switched web UX to streaming-first path
  - updated web `/app` chat behavior:
    - primary send path is streaming (`Send message (stream)`)
    - live delta rendering
    - user-triggered interruption (`Stop streaming`)
    - honest partial-output state visibility
  - preserved canonical record truth during streaming:
    - on completion: assistant full message persisted
    - on interrupted/failed with partial text: partial assistant message persisted + system marker persisted
  - updated docs:
    - `docs/ADR/017-web-chat-streaming-first-transport.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C3` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C3 requirement is streaming-first web chat as the primary happy path.
- Streaming needed to preserve transparency for interruption/failure and avoid pretending full completion when runtime output is partial.
- Existing C1/C2 record-vs-runtime boundary is preserved by persisting records in backend while keeping runtime session truth in OpenClaw.

### Files touched

- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- docs/ADR/017-web-chat-streaming-first-transport.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- Streaming protocol is currently SSE from API and NDJSON from adapter/runtime; advanced resume/replay semantics are not implemented.
- Runtime streaming behavior in dev depends on OpenClaw compatibility patch path.
- C4 chat list/actions and persistence-backed chat history UX are not implemented yet.

### Next recommended step

- Proceed to Step 5 `C4` (chat list and chat actions) while keeping streaming-first path and record-vs-runtime split intact.

### Ready commit message

- `feat(web-api): add step 5 c3 streaming-first web chat transport and ui path`

## 2026-03-23 - Step 5 C2 web chat backend transport slice

### What changed

- Completed Step 5 slice `C2` only (web chat backend transport baseline):
  - added backend transport endpoint in `apps/api`:
    - `POST /api/v1/assistant/chat/web`
  - added application service for web chat turn transport:
    - parses/validates transport request payload
    - enforces assistant lifecycle/apply gate
    - resolves/creates canonical C1 chat record by `(assistantId, surface=web, surfaceThreadKey)`
    - appends user message record before runtime call
    - appends assistant message record after runtime call
  - extended OpenClaw runtime adapter boundary with web chat turn operation:
    - `POST /api/v1/runtime/chat/web`
  - updated auth middleware route protection for new endpoint
  - added OpenAPI contract for new endpoint and generated client updates in `packages/contracts`
  - extended OpenClaw source compatibility patch to include auth-protected `POST /api/v1/runtime/chat/web` endpoint for dev image workflow patching
  - updated docs:
    - `docs/ADR/016-web-chat-backend-transport-boundary.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C2` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C2 introduces minimal backend transport for web chat while preserving boundaries established in C1 and A8.
- Backend record/history truth remains canonical and runtime session/context truth remains in OpenClaw.
- Lifecycle/apply gate prevents transport from bypassing assistant publish/apply model.

### Files touched

- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/application/web-chat.types.ts
- apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- docs/ADR/016-web-chat-backend-transport-boundary.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C2 transport is synchronous request/response only (no streaming/backpressure semantics).
- OpenClaw web chat endpoint in this phase is compatibility-level and requires patched image path in dev workflow.
- Telegram and broader multi-surface transport handling remain intentionally out of scope.

### Next recommended step

- Proceed to Step 5 `C3` (streaming web chat transport) while preserving C1/C2 record-vs-runtime boundary.

### Ready commit message

- `feat(api): add step 5 c2 web chat backend transport through openclaw adapter`

## 2026-03-23 - Step 5 C1 chat domain model slice

### What changed

- Completed Step 5 slice `C1` only (backend chat record domain baseline):
  - added chat record persistence model in `apps/api` Prisma:
    - `assistant_chats`
    - `assistant_chat_messages`
  - added chat surface-awareness at identity level:
    - `assistant_chats` unique thread key `(assistant_id, surface, surface_thread_key)`
    - C1 surface baseline is `web`
  - added ownership/scope constraints for chat records:
    - assistant ownership tie via `(assistant_id, user_id) -> assistants(id, user_id)`
    - workspace scope tie via `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - added backend domain/repository wiring in `workspace-management`:
    - chat entity + message entity
    - chat repository contract
    - Prisma repository implementation
    - Nest provider registration
  - added ADR for C1 boundary decision:
    - `docs/ADR/015-chat-record-model-and-runtime-session-boundary.md`
  - updated docs:
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/DATA-MODEL.md`
    - `docs/ROADMAP.md` (`C1` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- Step 5 requires canonical backend chat/history records before transport and streaming slices.
- Product boundary requires preserving split ownership:
  - backend owns user-facing record/history truth
  - OpenClaw owns runtime session/context truth
- Surface-aware threading must be explicit now so future web and non-web surfaces do not collapse into one global thread model.

### Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323190000_step5_c1_chat_domain_model/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-chat.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-chat-message.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- docs/ADR/015-chat-record-model-and-runtime-session-boundary.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/api run typecheck` - passed
- `corepack pnpm run typecheck` - failed in existing `packages/contracts` (`src/mutator/custom-fetch.ts`: missing `process` type), unrelated to C1 chat-domain changes

### Known risks

- C1 introduces storage/repository baseline only; chat transport/API behavior is intentionally deferred.
- Message append ordering in C1 is timestamp-based (`created_at`) and does not yet include explicit streaming/event sequencing semantics.
- `surface` enum is intentionally `web`-only in C1; adding other surfaces requires explicit next-slice model extension.

### Next recommended step

- Proceed to Step 5 `C2` (web chat backend transport) using the C1 record model as persistence boundary.

### Ready commit message

- `feat(api): add step 5 c1 chat record domain model with surface-aware threading`

## 2026-03-23 - Step 4 closure stabilization slice

### What changed

- Closed Step 4 validation loop with a narrow web/docs stabilization slice:
  - hardened browser/runtime API base URL resolution in `packages/contracts/src/mutator/custom-fetch.ts`
  - normalized first-time assistant state handling in `apps/web/app/app/assistant-api-client.ts` (`GET /assistant` `404` -> `null`)
  - accepted `200|201` for onboarding/assistant create-publish-rollback-reset flows in web API clients
  - applied minimal visual baseline in `apps/web/app/globals.css` (cards, spacing, form/button states, typography)
  - aligned hybrid live-test config to same-origin API pathing in `apps/web/.env.local` (`/api/v1` + rewrite target)
- Updated docs for Step 4 closure and stabilization:
  - `docs/CHANGELOG.md`
  - `docs/ROADMAP.md`
  - `docs/SESSION-HANDOFF.md`
- Added agent-facing hybrid live-test runbook:
  - created `docs/LIVE-TEST-HYBRID.md` for `local web + GKE api` validation flow
  - linked this runbook from:
    - `AGENTS.md`
    - `README.md`

### Why changed

- Live validation across two accounts surfaced stability gaps after onboarding/assistant bootstrap:
  - false-fatal `404` handling for assistant-not-created state
  - browser-side fetch fallback that could bypass same-origin proxy and fail in hybrid mode
- A minimal style baseline was required to make Step 4 control surface usable without waiting for full design/polish phases.
- Goal: close Step 4 as functionally complete and operationally verifiable without backend/API scope expansion.

### Files touched

- packages/contracts/src/mutator/custom-fetch.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/me-api-client.ts
- apps/web/app/globals.css
- docs/LIVE-TEST-HYBRID.md
- AGENTS.md
- README.md
- docs/CHANGELOG.md
- docs/ROADMAP.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- Manual live checks in hybrid mode (`local web + GKE api port-forward`) - passed for onboarding/assistant create/publish/apply paths

### Known risks

- Hybrid mode remains dependent on a stable local `kubectl port-forward` session for `svc/api` on `localhost:3001`.
- Full visual polish/design-system scope is intentionally deferred; current styling is baseline-only.

### Next recommended step

- Start Step 5 `Web Chat Core` (`C1`) while preserving Step 4 closure behavior.
- Optionally define a dedicated `Step 4.5 UI polish` milestone if design polish should be tracked independently before Step 5 expansion.

### Ready commit message

- `docs: close step 4 with hybrid stability fixes and minimal web styling baseline`

## What changed

- Completed Step 4 slice `B6` only (assistant activity/update markers in `apps/web`):
  - added lightweight `Assistant activity and updates` block to the user control surface
  - added non-intrusive ordinary markers for meaningful user-facing lifecycle updates
  - added recovery-worthy markers for apply failure/degraded outcomes and recent rollback/reset actions
  - added quiet no-update branch (`No visible assistant updates right now.`) to avoid notification noise
  - kept markers read-only and aligned with control-plane truth (no draft/version mutation side effects)
  - kept admin/debug runtime internals hidden from marker UI
  - updated web tests for:
    - ordinary marker visibility
    - recovery-worthy marker visibility
    - no-meaningful-update branch
- Completed Step 4 slice `B5` only (rollback/reset UX in `apps/web`):
  - added `Lifecycle safety controls` block with user-facing rollback and reset actions
  - rollback UX:
    - target-version input
    - explicit rollback action wired to `POST /assistant/rollback`
    - human-readable feedback after request
  - reset UX:
    - explicit semantics copy (reset assistant content; not account deletion)
    - required confirmation checkbox
    - required `RESET` typed confirmation
    - reset action wired to `POST /assistant/reset`
  - preserved lifecycle semantics from backend model:
    - rollback creates a new latest published snapshot from selected version
    - reset creates a new blank assistant content baseline while preserving ownership/workspace scope
  - preserved B1-B4 dashboard/editor/publish-apply state behavior
  - updated web tests for rollback flow and reset confirmation/execution flow
- Completed Step 4 slice `B4` only (publish/apply UX state model in `apps/web`):
  - added explicit publish/apply state labels in global status area
  - publish-state labels surfaced:
    - `Draft has changes`
    - `Publishing`
    - `Published`
    - `Draft only`
  - apply-state labels surfaced:
    - `Applying`
    - `Live`
    - `Failed`
    - `Not requested`
  - added rollback-availability visibility (`yes|no`) based on published version history
  - added `Publish draft` UI action wired to `POST /assistant/publish`
  - kept publish/apply separated in UX copy and backend mapping (no fake merged state)
  - kept runtime diagnostics/details hidden; only coarse user-safe status and message are displayed
  - updated web tests for publish/apply state mapping and publish action transition behavior
- Completed Step 4 slice `B3` only (dual-path setup flow in `apps/web`):
  - added `Assistant setup paths` block with two explicit branches:
    - quick start path
    - advanced setup path
  - quick start path applies a guided baseline into draft fields
  - advanced setup path applies manual display name + instructions into draft fields
  - both paths now write through control-plane draft API only:
    - `PATCH /assistant/draft`
  - when assistant is absent, setup path auto-creates assistant first via:
    - `POST /assistant`
      then applies draft update
  - setup flow explicitly does not publish and does not change runtime apply state directly
  - preserved B1/B2 behavior: onboarding gate, global publish/status bar, sectioned editor shell
  - updated web tests for quick-start and advanced-setup draft flow
- Completed Step 4 slice `B2` only (assistant editor sections in `apps/web`):
  - added sectioned assistant editor shell (not a wizard) under `/app` completed-onboarding branch
  - introduced visible editor sections:
    - Persona
    - Memory
    - Tools & Integrations
    - Channels
    - Limits & Safety Summary
    - Publish History
  - surfaced a global publish/status bar above editor sections with lifecycle truth:
    - draft truth (`draft.updatedAt`)
    - draft publish state (unpublished changes vs matches latest published snapshot)
    - published truth (`latestPublishedVersion`)
    - apply truth (`runtimeApply.status` + optional error)
  - kept B1 create-assistant flow for assistant-absent state
  - kept onboarding gate and protected route behavior unchanged
  - updated web tests for section visibility and assistant-absent behavior
- Completed Step 4 slice `B1` only (assistant dashboard shell in `apps/web`):
  - replaced completed-onboarding `/app` "Me" view with a minimal assistant-first dashboard shell
  - added primary status/control block that surfaces control-plane truth:
    - draft truth (`draft.updatedAt`)
    - published truth (`latestPublishedVersion`)
    - apply truth (`runtimeApply.status` + optional apply error message)
  - added basic assistant summary block with assistant identity, draft summary, and apply version pointers
  - preserved existing protected route + onboarding gate behavior
  - added web assistant API client wiring:
    - `GET /assistant` returns `null` on `404` for assistant-not-created state
    - `POST /assistant` creates assistant from the dashboard when absent
  - updated web tests for dashboard completed branch and assistant-absent branch
- Closed the remaining A8 apply-route compatibility gap:
  - added workflow-driven OpenClaw source patching in `.github/workflows/openclaw-dev-image-publish.yml`
  - added patch file `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`
  - patch injects auth-protected endpoint `POST /api/v1/runtime/spec/apply` into OpenClaw gateway HTTP server
  - endpoint validates minimal payload shape and returns JSON ack instead of `404`
- Added deterministic OpenClaw rollout wiring for patched images:
  - introduced `openclaw.image.digest` in Helm values and deployment template (digest-aware image ref)
  - OpenClaw workflow now reads docker build digest output and updates both:
    - `openclaw.image.tag`
    - `openclaw.image.digest`
      in `infra/helm/values-dev.yaml`
  - this ensures Argo applies a real OpenClaw rollout after each patched image build, even when approved SHA tag string is unchanged
- Added OpenClaw pre-session guidance baseline for agent startup discipline:
  - created `docs/OPENCLAW-PRESESSION.md` with mandatory OpenClaw docs pack, role-based optional links, and a 60-second pre-session checklist
  - updated `AGENTS.md` mandatory startup reading order to include `docs/OPENCLAW-PRESESSION.md`
  - recorded this baseline in `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md`
- Applied a narrow A8 runtime stabilization slice before Step 4:
  - added missing API runtime adapter wiring in Helm values (`OPENCLAW_ADAPTER_ENABLED`, `OPENCLAW_BASE_URL`, `OPENCLAW_GATEWAY_TOKEN`)
  - enabled adapter in dev values with in-cluster OpenClaw URL (`http://openclaw:18789`)
  - hardened `AssistantRuntimePreflightService` to return degraded preflight state (`live=false`, `ready=false`) on adapter-level failures instead of surfacing unhandled `500`
- Fixed the `api-migrate` Argo PreSync hook lifecycle deadlock:
  - changed `cloud-sql-proxy` from a regular Job sidecar container to a sidecar-style `initContainer` with `restartPolicy: Always`
  - added explicit proxy readiness wait in `api-migrate` before Prisma commands run
  - result: migration hook can now complete and reach `Succeeded` instead of hanging in `Running` after SQL steps finish
- Applied deploy reliability hardening for automatic DB migration + verification on each sync:
  - added new Helm template `infra/helm/templates/api-migrate-job.yaml`
  - `api-migrate` runs as Argo `PreSync` hook using API image + same env/secret + Cloud SQL proxy in sidecar-style init lifecycle
  - hook command is strict:
    - `corepack pnpm run prisma:migrate:deploy`
    - `corepack pnpm run prisma:migrate:status`
  - sync fails if migration/apply/status fails (prevents app/schema drift)
- Enabled dev Argo application automated sync:
  - `prune: true`
  - `selfHeal: true`
  - `CreateNamespace=true`
- Added migration automation guidance in:
  - `README.md`
  - `infra/dev/gitops/README.md`
  - `infra/dev/gke/RUNBOOK.md`
- Applied a narrow OpenClaw deploy automation slice:
  - extended `.github/workflows/openclaw-dev-image-publish.yml` to auto-update `infra/helm/values-dev.yaml` `openclaw.image.tag` to `OPENCLAW_APPROVED_SHA` after successful image publish on `main`
  - added `paths-ignore` for `infra/helm/values-dev.yaml` to prevent self-trigger loops from workflow-generated commits
- This removes the manual OpenClaw GitOps tag promotion step after push.
- Applied a narrow post-A8 deploy-automation hotfix to keep dev auto-deploy stable after `main` pushes.
- Fixed dev image pinning workflow behavior in `.github/workflows/dev-image-publish.yml`:
  - now updates only `global.images.tag` in `infra/helm/values-dev.yaml`
  - no longer rewrites every YAML `tag` field
- Restored dev values tag strategy in `infra/helm/values-dev.yaml`:
  - `api.image.tag=""` and `web.image.tag=""` (inherit `global.images.tag`)
  - `openclaw.image.tag` pinned back to approved OpenClaw SHA `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- This removes the recurring failure mode where OpenClaw was forced to non-existent app commit tags.
- Completed Step 3 slice `A8` only (OpenClaw thin adapter for preflight + apply/reapply).
- Added dedicated runtime adapter boundary:
  - application-level adapter interface + coarse DTO/error model
  - infrastructure-level OpenClaw HTTP implementation only
- Added first adapter interactions:
  - runtime preflight via `GET /healthz` + `GET /readyz`
  - apply/reapply via `POST /api/v1/runtime/spec/apply`
  - apply payload source is A7 materialized spec only (`openclawBootstrap`, `openclawWorkspace`, `contentHash`)
- Added apply execution flow service and wired lifecycle actions:
  - publish/rollback/reset now attempt runtime apply after materialization
  - apply-state transitions are explicit: `pending -> in_progress -> succeeded|failed|degraded`
  - coarse adapter error categories are persisted into `runtimeApply.error`
- Added two control-plane endpoints:
  - `POST /api/v1/assistant/reapply`
  - `GET /api/v1/assistant/runtime/preflight`
- Added OpenClaw adapter env/config baseline in `packages/config` + API env examples.
- Preserved architectural boundaries:
  - domain/application layers stay OpenClaw-agnostic
  - no chat relay, no Telegram/channels work
  - no behavior-level OpenClaw integration
- Updated docs:
  - `docs/ADR/014-openclaw-apply-reapply-adapter.md`
  - `docs/ARCHITECTURE.md`
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A8` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- Platform-managed updates should be visible enough to feel trustworthy, but not noisy enough to feel intrusive.
- B6 introduces lightweight markers that separate ordinary updates from recovery-worthy events while preserving the soft auto-update model.
- This keeps user-facing transparency high without leaking admin/support diagnostics or turning the UI into an alert feed.
- Step 4 requires safe lifecycle recovery controls in user-facing UI before deeper activity/history work.
- B5 provides rollback/reset controls that match backend semantics and force explicit reset confirmation to prevent accidental destructive assistant-content resets.
- The UI now communicates rollback vs reset consequences without introducing account-deletion behavior or hiding meaningful impact.
- Step 4 requires a user-friendly but honest lifecycle model where users can understand publish and apply as separate truths.
- B4 makes publish/apply progress and failure outcomes visible without exposing raw runtime internals.
- This keeps lifecycle transparency aligned with control-plane state and prepares rollback/reset UX work in B5.
- Step 4 requires setup UX that supports both fast-start users and advanced users while preserving explicit lifecycle truth.
- B3 introduces two setup paths that always land in draft state, preventing hidden live-state mutation and avoiding accidental publish side effects.
- This keeps control-plane consistency with B1/B2 and prepares B4 publish/apply UX without widening into full persona/memory feature depth.
- Step 4 requires a sectioned control surface so assistant management does not collapse into one oversized settings page.
- B2 establishes editor information architecture and keeps lifecycle status globally visible while preserving draft/publish/apply control-plane truth.
- This creates a stable foundation for B3-B6 without introducing chat-first drift or raw runtime file exposure.
- Step 4 product order requires assistant control surface visibility before chat expansion.
- Prior `/app` completed branch showed account/workspace baseline only, so assistant lifecycle/apply truth was not visible to users.
- B1 introduces a minimal assistant-managed shell that keeps control-plane lifecycle truth explicit without expanding into full editor/chat/tasks/memory scope.
- Live A8 check after runtime wiring fix showed one final blocker before Step 4:
  - preflight was healthy, but `publish/reapply` still failed because OpenClaw returned `404` on `/api/v1/runtime/spec/apply`
- This slice restores the exact A8 route contract while keeping domain/application boundaries and avoiding behavior-level runtime expansion.
- Post-fix live check showed patched OpenClaw route was still absent because deployment did not roll:
  - OpenClaw image tag remained text-identical (`approved SHA`) and `IfNotPresent` prevented guaranteed refresh
  - deployment spec therefore stayed effectively unchanged and existing pod/image digest remained old
- Digest pinning closes this rollout gap without changing the approved-SHA governance model.
- Team requested a single source for OpenClaw pre-session reading so every new agent session starts with consistent runtime/ops assumptions.
- This reduces session drift when working on Step 4+ slices that depend on stable control-plane/runtime boundary understanding.
- Live A1-A8 validation showed A8 runtime drift in dev:
  - adapter env/secret wiring was absent in API runtime values, so apply path failed as configuration-disabled
  - preflight endpoint surfaced adapter exceptions as `500`, making operator/UX checks noisy
- This slice keeps A8 boundary/scope unchanged while making runtime status reporting stable and explicit.
- User-required turnkey deploy path was still blocked by one recurring issue: successful migration SQL with non-terminating hook lifecycle.
- The previous Job-sidecar pattern left `api-migrate` in `Running/Terminating`, which blocked Argo sync completion and required manual cleanup.
- The fix keeps the same migration guarantees but removes the hook completion deadlock.
- User requirement: deploy must be turnkey and stable without manual DB migration steps.
- Previous flow allowed successful rollout while migrations could be skipped/failing, creating future break risk.
- New PreSync migration hook guarantees schema update + verification before API rollout is considered successful.
- User requirement: no manual OpenClaw deploy/tag step after push.
- OpenClaw image build was automated, but tag promotion in GitOps values was still manual.
- The new workflow step closes this gap while preserving separation:
  - app workflow controls `global.images.tag`
  - OpenClaw workflow controls `openclaw.image.tag`
- The previous broad `sed` replacement rewrote all `tag:` lines in dev values, including OpenClaw pinning.
- That caused `openclaw` rollout failures (`ImagePullBackOff`) when app commit SHA tags did not exist for OpenClaw image.
- The hotfix makes image pinning deterministic and aligned with intended ownership:
  - app deploys follow `${GITHUB_SHA}` via `global.images.tag`
  - OpenClaw remains pinned to approved source SHA
- A8 activates the first real runtime bridge while preserving control-plane boundaries from O6/A7.
- Materialized spec is now not only stored but also consumed by a thin adapter for runtime apply/reapply.
- Coarse failure outcomes are explicitly surfaced in apply state for later UX/admin use.

## Decisions made

- OpenClaw integration remains adapter-only (infrastructure layer); no OpenClaw transport types in domain/application.
- HTTP remains the first transport; WebSocket remains out of scope.
- A8 adapter interactions are intentionally narrow:
  - preflight probes (`/healthz`, `/readyz`)
  - apply/reapply of materialized spec (`/api/v1/runtime/spec/apply`)
- Coarse boundary error model is stable and explicit:
  - `runtime_unreachable`
  - `auth_failure`
  - `timeout`
  - `invalid_response`
  - `runtime_degraded`
- Reapply is explicit and does not create a new published version.

## Files touched

- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- .github/workflows/openclaw-dev-image-publish.yml
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- infra/helm/templates/openclaw-deployment.yaml
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- AGENTS.md
- docs/OPENCLAW-PRESESSION.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- infra/helm/templates/api-migrate-job.yaml
- infra/dev/gitops/argocd/application-dev.yaml
- .github/workflows/openclaw-dev-image-publish.yml
- README.md
- infra/dev/gitops/README.md
- infra/dev/gke/RUNBOOK.md
- .github/workflows/dev-image-publish.yml
- infra/helm/values-dev.yaml
- apps/api/.env.dev.example
- apps/api/.env.local.example
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts
- apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts
- apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts
- apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts
- apps/api/src/modules/workspace-management/application/reset-assistant.service.ts
- apps/api/src/modules/workspace-management/domain/assistant.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- packages/config/src/api-config.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/step2-client.ts
- packages/contracts/src/generated/model/\*
- docs/ADR/014-openclaw-apply-reapply-adapter.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- No new Prisma migration in A8.

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed

## Known risks

- Migration hook depends on Cloud SQL access rights for API runtime GSA (`roles/cloudsql.client`).
- If Cloud SQL IAM/scopes are broken, sync will now fail fast (desired behavior) until infra permissions are fixed.
- Argo application status can remain stale (`operationState`) after forced hook cleanup; if observed, clear the stale operation once and then rely on the fixed hook template for future sync cycles.
- Runtime apply endpoint contract in OpenClaw is assumed at `/api/v1/runtime/spec/apply`; any drift must be handled via adapter contract update.
- Current OpenClaw compatibility endpoint acknowledges apply payloads and validates shape/auth, but does not yet execute behavior-level assistant runtime mutation.
- Existing historical published versions without materialized spec will fail apply/reapply with `invalid_response` until backfilled/materialized.
- Adapter is synchronous request/response only; no async apply job tracking yet.

## Next recommended step

- Commit/push this hook lifecycle fix, then run one `main` push verification cycle:
  - confirm `api-migrate` reaches `Succeeded` (not `Running/Terminating`)
  - confirm workflow updates only `global.images.tag`
  - confirm OpenClaw workflow updates `openclaw.image.tag` to approved SHA
  - confirm Argo auto-sync completes without manual terminate/delete operations.

## H3: Runtime hydration depth — completed (2026-03-26)

### Status

- **H3a** — Persona, workspace, bootstrap: done (DB fields, materialization, OpenClaw workspace writer, env vars, Helm GCS FUSE, setup/settings UI, contracts).
- **H3b** — Memory management: done (OpenClaw HTTP memory API, PersAI proxy + adapter, Memory Center tabs).
- **H3c** — Chat history: done (paginated messages endpoint, `useChat.loadHistory` + thread navigation).

### Key files — PersAI

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — seven bootstrap Markdown docs → `openclawWorkspace.bootstrapDocuments`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts` — proxy to `/api/v1/runtime/memory/*`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — `assistant/memory/workspace/*`, `assistant/chats/web/:chatId/messages`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts` — cursor pagination for messages
- `apps/web/app/app/_components/use-chat.ts` — `loadHistory`
- `apps/web/app/app/chat/page.tsx` — calls `loadHistory` when opening existing thread
- `apps/web/app/app/assistant-api-client.ts` — client for workspace memory + messages
- `infra/helm/templates/openclaw-serviceaccount.yaml` — WI / SA template (with chart CSI mount as deployed)
- `packages/contracts` — `AssistantDraftState`, `AssistantDraftUpdateRequest`, `AssistantPublishedVersionSnapshotState`, `OnboardingRequest`, `AppUserSummary` (traits/avatar/birthday/gender)

### Key files — OpenClaw (fork)

- `src/gateway/persai-runtime/persai-runtime-workspace.ts` — per-assistant dirs, bootstrap write-once
- `src/gateway/persai-runtime/persai-runtime-memory.ts` — `/api/v1/runtime/memory/{items,add,edit,forget,search}`

### Ops / runtime env

- `PERSAI_WORKSPACE_ROOT`, `PERSAI_AGENT_WORKSPACE_DIR`

## Live-test fixes session (2026-03-26)

### What was done

Full interactive LIVE test of 8 areas after H2-cleanup + H3 deploy. Found and fixed:

1. **Plan model override not applied by OpenClaw**: `runtimeProviderProfile.primary.model` was always set to the global admin model; per-plan `primaryModelKey` was only in `runtimeProviderRouting` (which OpenClaw doesn't read). Fix: `materialize-assistant-published-version.service.ts` now overrides `runtimeProviderProfile.primary.model` with plan model key when present.
2. **Routing priority wrong**: `managedPrimary?.model` took precedence over `planModelKey`. Fix: swapped order in `resolve-runtime-provider-routing.service.ts`.
3. **Chat history stale on thread switch**: `useChat` hook didn't reset state when `threadKey` changed. Fix: added `prevThreadKeyRef` comparison and state reset in `use-chat.ts`.
4. **Admin Plans UI polish**: quota/model fields were dim (`text-text-subtle`); AI Model was free text. Fix: accent-bordered card sections, `<select>` for model from runtime `availableModelsByProvider`, vertical channels layout with full names and hint text.
5. **403 on runtime save**: user had `business_admin` role (legacy owner fallback) but `admin.runtime_provider_settings.update` requires `ops_admin`/`super_admin`. Fix: inserted `super_admin` role in `app_user_admin_roles` table for dev user.
6. **H3.1 tech debt**: logged in ROADMAP — lazy `settingsGeneration` invalidation to replace full re-materialization at scale (critical for ≥1000 workspaces).

### Commits

- `543c2d9` → `9b1b15a` (rebased) — refactor + live-test fixes on `main`

### Key files changed

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — plan model override in runtimeProviderProfile
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts` — planModelKey priority fix
- `apps/web/app/app/_components/use-chat.ts` — thread switch state reset
- `apps/web/app/admin/plans/page.tsx` — model select, channels vertical, styled sections, runtime models fetch
- `docs/ROADMAP.md` — H3.1 tech debt entry

---

## H3.3 — Assistant lifecycle rework (CREATE/EDIT/RESET)

### What changed

1. **EDIT simplification**: replaced "Save draft" + "Publish" two-step with single "Save and apply" button. Backend draft/publish versioning preserved internally for audit/rollback. Removed unused `publishing`/`pubFb` state and `Upload`/`Save` imports.

2. **RESET full wipe**: `reset-assistant.service.ts` rewritten with Prisma transaction that hard-deletes chat messages, chats, memory registry items, materialized specs, and published versions. Apply state reset to `not_requested`. Draft fields nulled. OpenClaw workspace cleanup via new `POST /api/v1/runtime/workspace/cleanup` endpoint (deletes workspace directory + removes spec store entries). Frontend redirects to `/app/setup` after reset. Setup wizard pre-fills user data (name, birthday, gender, timezone) from `/me` endpoint. `postAssistantCreate` 409 caught silently (assistant record already exists post-reset).

3. **Admin-editable bootstrap presets**: new `bootstrap_document_presets` table (id VARCHAR(32) PK, template TEXT). Prisma migration + seed for 4 presets (soul, user, identity, agents). Admin API: `GET /api/v1/admin/bootstrap-presets` and `PATCH /api/v1/admin/bootstrap-presets/:id`. Materialization service loads templates from DB with hardcoded fallback. Templates use `{{placeholder}}` interpolation — lines with empty/null placeholders are automatically removed. Admin UI: `/admin/presets` page with per-preset Markdown editor, variable chips (click to copy + insert at cursor), and live preview with sample data.

4. **OpenClaw changes**: `cleanupPersaiAssistantWorkspace()` function in `persai-runtime-workspace.ts`. `remove(assistantId)` method on `PersaiRuntimeSpecStore` interface (InMemory and Redis). `handleRuntimeWorkspaceCleanupHttpRequest` handler + route registration. `cleanupWorkspace(assistantId)` on `AssistantRuntimeAdapter` interface + `OpenClawRuntimeAdapter` implementation.

5. **App shell**: detects post-reset state (assistant exists, no published version, `applyStatus=not_requested`) and redirects to `/app/setup`.

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `BootstrapDocumentPreset` model
- `apps/api/prisma/migrations/20260401100000_h3_bootstrap_document_presets/migration.sql`
- `apps/api/prisma/bootstrap-preset-data.ts` — default template definitions
- `apps/api/prisma/seed.ts` — preset upsert
- `apps/api/src/modules/workspace-management/domain/bootstrap-document-preset.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-bootstrap-document-preset.repository.ts`
- `apps/api/src/modules/workspace-management/application/manage-bootstrap-presets.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-bootstrap-presets.controller.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — template interpolation, preset loading
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts` — full wipe rewrite
- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts` — `cleanupWorkspace` method
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts` — cleanup implementation
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — reset return type
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` — new registrations

**PersAI frontend:**

- `apps/web/app/app/_components/assistant-settings.tsx` — "Save and apply" button, reset redirect
- `apps/web/app/app/_components/app-shell.tsx` — post-reset setup redirect
- `apps/web/app/app/setup/page.tsx` — user data pre-fill, 409 handling
- `apps/web/app/admin/presets/page.tsx` — new admin presets UI
- `apps/web/app/admin/layout.tsx` — nav item

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-workspace.ts` — `cleanupPersaiAssistantWorkspace`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts` — `remove()` method
- `src/gateway/persai-runtime/persai-runtime-http.ts` — cleanup endpoint handler
- `src/gateway/server-http.ts` — route registration

### Risks

- Bootstrap preset interpolation depends on exact `{{placeholder}}` syntax — admin typos in template will result in literal `{{...}}` text in generated documents.
- Reset full wipe is irreversible — no soft-delete or recovery path.
- `postAssistantCreate` 409 catch in setup wizard is broad — could mask other errors on that endpoint (acceptable for MVP).

### Next recommended step

- **H4 — Telegram runtime readiness alignment** against admin-driven runtime profile + managed secret refs.
- Live-test the full reset → setup → create → edit cycle on dev.

---

## H8 — Telegram runtime readiness

### What changed

1. **Encrypted bot token storage:** `ConnectTelegramIntegrationService` persists the bot token via `PlatformRuntimeProviderSecretStoreService` (AES-256-GCM) under key `telegram_bot:{assistantId}`. Token deleted on revoke/disconnect.

2. **Telegram channel materialization:** active Telegram binding → `openclawBootstrap.channels.telegram` with `enabled: true`, resolved `botToken`, `webhookUrl` (or null for polling), HMAC `webhookSecret`, `groupReplyMode`, `parseMode`, inbound/outbound policy. Inactive → `enabled: false`.

3. **OpenClaw Telegram bridge** (`persai-runtime-telegram.ts`): dynamically manages Grammy bot instances per assistant. On `spec/apply` with enabled Telegram, starts bot in webhook mode (if `webhookUrl` present) or polling mode (if null). Handles `message:text` → agent turn and `my_chat_member` → group status callback to PersAI.

4. **Polling fallback:** when `TELEGRAM_WEBHOOK_BASE_URL` env is unset, materialized `webhookUrl` is null, and OpenClaw uses `bot.start()` long polling — allows Telegram operation without public domain. Stale webhooks deleted on start.

5. **GKE Ingress** (`openclaw-ingress.yaml`): routes `bot.persai.dev/telegram-webhook/*` to OpenClaw with TLS managed certificate.

6. **Group tracking:** `assistant_telegram_groups` Prisma table stores join/leave events. OpenClaw sends `my_chat_member` to `POST /api/v1/internal/runtime/telegram/group-update`. `GET /api/v1/assistant/integrations/telegram/groups` returns group list.

7. **UI updates:** Groups section in connected Telegram panel. Group reply mode toggle. Disconnect/Reconnect buttons with confirmation dialog. Auto-populated group list from `my_chat_member` callbacks.

8. **Auto-apply on connect/disconnect:** `ConnectTelegramIntegrationService` and `RevokeTelegramIntegrationSecretService` now call `ApplyAssistantPublishedVersionService` after modifying integration, ensuring immediate OpenClaw sync.

9. **Telegram workspace isolation:** OpenClaw Telegram agent turns receive per-assistant `workspaceDir` from stored spec (same as web chat). Bot reads/writes the correct `MEMORY.md` and bootstrap files.

10. **Operational:** `OPENCLAW_ADAPTER_TIMEOUT_MS` increased to 90 000 ms for complex LLM queries. `OPENCLAW_STATE_DIR` set to persistent GCS FUSE volume for session survival across pod restarts.

### Why changed

H8 completes the Telegram delivery surface that was previously control-plane-only (E4 connect/config). Users can now interact with their assistant via Telegram DMs and group chats, with the same persona, memory, and tools as web chat.

### Slice boundary

- PersAI: encrypted token storage, materialization of Telegram channel config, `assistant_telegram_groups` table, group update internal endpoint, groups API, UI disconnect/reconnect/groups, auto-apply on connect/disconnect.
- OpenClaw: Telegram bridge (Grammy bot lifecycle, webhook/polling, event routing), workspace dir in agent turns, reinitialize from store on pod restart.
- No changes to: web chat, publish/rollback/reset, admin plans, provider settings, memory/tasks APIs.

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `AssistantTelegramGroup` model
- `apps/api/prisma/migrations/20260326300000_add_assistant_telegram_groups/migration.sql`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts` — encrypted token upsert, auto-apply
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts` — token delete, auto-apply
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — `resolveTelegramChannelConfig()`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — groups endpoint, disconnect endpoint
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts` — group-update endpoint
- `packages/config/src/api-config.ts` — `TELEGRAM_WEBHOOK_BASE_URL`, `TELEGRAM_WEBHOOK_HMAC_SECRET`

**PersAI frontend:**

- `apps/web/app/app/_components/telegram-connect.tsx` — Disconnect/Reconnect buttons, groups section, group reply mode toggle
- `apps/web/app/app/assistant-api-client.ts` — `fetchAssistantTelegramGroups`, `postAssistantTelegramDisconnect`

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-telegram.ts` — Grammy bot manager, webhook/polling, event handlers
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — `runPersaiTelegramAgentTurn`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts` — `getAll()` for reinitialize
- `src/gateway/persai-runtime/persai-runtime-http.ts` — `syncTelegramBotForAssistant` on apply with `workspaceDir`
- `src/gateway/server-http.ts` — Telegram webhook route, reinitialize on startup

**Infra:**

- `infra/helm/templates/openclaw-ingress.yaml` — new Ingress for `bot.persai.dev`
- `infra/helm/values-dev.yaml` — `OPENCLAW_ADAPTER_TIMEOUT_MS: "90000"`, `OPENCLAW_STATE_DIR`, `TELEGRAM_WEBHOOK_HMAC_SECRET` secret, `telegramWebhook` section
- `infra/dev/gitops/openclaw-approved-sha.txt` — updated to `d1dcf2ef2`

### Tests run

- `npx tsc --noEmit` — PersAI API (clean), PersAI Web (clean)
- `pnpm --filter @persai/web run test` — passing (flaky `putAdminRuntimeProviderSettings` spy timing in CI, passes on rerun)
- OpenClaw typecheck clean for new files

### Risks

1. Polling mode uses long-lived connections from OpenClaw pod to Telegram — one connection per active bot. At scale, webhook mode is preferred.
2. `TELEGRAM_WEBHOOK_BASE_URL` commented out in dev values — Telegram polling active until domain DNS is ready.
3. Auto-apply on connect/disconnect adds latency to those API calls (~500ms). Wrapped in try/catch so failures are non-fatal.
4. Flaky web test (`putAdminRuntimeProviderSettings` spy timing) — pre-existing, unrelated to H8. Passes on CI rerun.

### Next recommended step

- **H9 — thinking/reasoning UX:** stream thinking tokens from OpenClaw, collapsible "Thought for X seconds" block in web chat with fade-out preview.
- Configure `bot.persai.dev` DNS and uncomment `TELEGRAM_WEBHOOK_BASE_URL` to switch from polling to webhook mode.
- Monitor Telegram group tracking accuracy (join/leave events).

---

## H3.1 — configGeneration lazy invalidation (scale to 5 000–10 000 users)

### What changed

1. **New `PlatformConfigGeneration` singleton table** with monotonic `generation` counter. Atomically incremented on every admin config change: provider settings, plan create/update, bootstrap preset update. Seeded in migration.

2. **New `configDirtyAt` column on `assistants`** — set to `NOW()` when per-user data changes (onboarding/profile, Telegram connect/revoke, subscription). Cleared to `NULL` after successful materialization.

3. **New `materializedAtConfigGeneration` column on `assistant_materialized_specs`** — records which global generation the spec was built against. `configGeneration` also embedded in `openclawBootstrap.governance.configGeneration`.

4. **Removed `reapplyLatestPublishedVersions()`** from `ManageAdminRuntimeProviderSettingsService` — the O(N) sequential mass-reapply loop that blocked admin requests. Admin settings save now persists data, bumps generation, returns immediately.

5. **Generation bump wired into all admin write services**: `ManageAdminRuntimeProviderSettingsService`, `ManageAdminPlansService`, `ManageBootstrapPresetsService`. `configDirtyAt` wired into: `UpsertOnboardingService`, `ConnectTelegramIntegrationService`, `RevokeTelegramIntegrationSecretService`. Subscription hook ready for billing.

6. **Two new PersAI internal endpoints**: `GET /internal/v1/runtime/config-generation` (returns current generation, cacheable); `POST /internal/v1/runtime/ensure-fresh-spec` (checks global + per-user staleness, re-materializes if needed, returns fresh spec or 204).

7. **OpenClaw two-tier freshness check** in both chat handlers (sync + stream): cached global generation (TTL via `PERSAI_CONFIG_GENERATION_CACHE_TTL_MS`, default 1 hour) for fast-path zero-HTTP comparison; full PersAI freshness check when cache expires or generation mismatch. Reusable `applySpecLocally()` extracted from apply handler. Per-assistant mutex for dedup. Fail-open on PersAI unreachable.

8. **Frontend**: admin runtime settings page — `reapplySummary` display removed, replaced with `configGeneration` feedback. Admin Plans page — new "Force reapply all" emergency button (step-up protected, shows summary). API client updated. OpenAPI spec updated.

### Why changed

The O(N) inline mass-reapply was the only auto-propagation mechanism and it blocked admin requests for minutes at 1 000+ workspaces. Meanwhile, 7 of 8 data sources (plans, presets, profile, bindings, subscription, tool catalog, tool activations) had zero auto-propagation — changes were silently stale until manual reapply. H3.1 replaces both problems with a unified lazy invalidation system that scales to 10 000 users.

### Slice boundary

- PersAI: schema migration, generation bumps in admin services, dirty flags in user services, materialization embedding, new internal endpoints, removed mass-reapply, updated admin API response, frontend update.
- OpenClaw: freshness client, generation cache, local-apply helper, freshness check in chat handlers.
- No changes to: publish, rollback, reset, manual reapply, platform rollouts, Telegram delivery.

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `PlatformConfigGeneration`, `Assistant.configDirtyAt`, `AssistantMaterializedSpec.materializedAtConfigGeneration`
- `apps/api/prisma/migrations/...` — migration + seed
- `apps/api/src/modules/workspace-management/application/manage-admin-runtime-provider-settings.service.ts` — removed mass-reapply, added generation bump
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` — added generation bump
- `apps/api/src/modules/workspace-management/application/manage-bootstrap-presets.service.ts` — added generation bump
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — read generation, write to spec, clear dirty flag
- `apps/api/src/modules/workspace-management/application/ensure-spec-freshness.service.ts` — new service
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts` — new controller
- `apps/api/src/modules/identity-access/application/upsert-onboarding.service.ts` — set configDirtyAt
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts` — set configDirtyAt
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts` — set configDirtyAt

**PersAI frontend:**

- `apps/web/app/admin/runtime/page.tsx` — removed reapplySummary, shows configGeneration feedback
- `apps/web/app/admin/plans/page.tsx` — new "Force reapply all" button with step-up + summary
- `apps/web/app/app/app-flow.client.tsx` — updated feedback to configGeneration
- `apps/web/app/app/assistant-api-client.ts` — updated response validation, added `postAdminForceReapplyAll`

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-http.ts` — freshness check in both chat handlers (sync + stream)
- `src/gateway/persai-runtime/persai-runtime-freshness.ts` — new: two-tier freshness client with TTL cache + mutex

### Tests run

- `npx tsc --noEmit` — PersAI API (clean), PersAI Web (clean)
- `npx tsc --noEmit` — OpenClaw (all new files clean; pre-existing test errors in extensions unchanged)
- `npx prisma validate` — schema valid

### Risks

1. Changes propagate with up to TTL delay (default 1 hour). Manual reapply available as instant escape hatch.
2. First chat after stale detection pays ~200-500ms materialization latency.
3. Global `configGeneration` counter — plan change invalidates all assistants, not just those on the changed plan. Acceptable: only chatting assistants pay, plan changes are infrequent.
4. OpenClaw depends on PersAI internal API for freshness checks. Mitigated by fail-open + cache.
5. Migration needs `prisma migrate deploy` on running DB before deployment.

### Next recommended step

- **H4 — Telegram runtime readiness alignment** against admin-driven runtime profile + managed secret refs.
- Monitor lazy invalidation latency in dev; tune TTL if needed.
- When billing is connected (FINAL), subscription webhook sets `configDirtyAt` — no additional code needed.
- Run `npx prisma migrate deploy` when DB is available to apply migration.
