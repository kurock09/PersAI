# ADR-090: Idle Re-Engagement Prod Hardening

**Status:** Accepted  
**Date:** 2026-05-10  
**Relates to:** ADR-088 (Unified Notification Platform)

## Context

### Evidence from Cloud Logging (72h window, 2026-05-07 – 2026-05-09)

27 `runtime_turn_busy` events were recorded in the runtime tier.

- **26 of 27** had `requestId=background-task-tool-run:...` — idle_reengagement evaluations colliding with themselves on the same synthetic runtime session.
- **1 of 27** was a real user turn (`sessionId=30e25e5f-...`, 2026-05-09 11:16:22 UTC), likely a zombie lease left by a prior background session.
- One synthetic session (`060b0665-...`) hit busy 5 separate times over several hours — confirming the stable `dedupeKey` as `externalThreadKey` caused repeated lease conflicts on the same session.
- OpenAI usage logs showed "Background Task / Sense of Time" entries duplicated at approximately 15-minute intervals, corresponding to the two API pods each independently running `evaluate()` on every candidate.

### Root causes identified

1. **No single-leader guard.** Both API pods call `findDueCandidates` + `evaluate()` on exactly the same candidates at exactly the same wall-clock tick. Every user gets two LLM calls per evaluation window.

2. **Stable `externalThreadKey` per candidate.** The runtime `buildToolRunRequest` used `system:background-task:{task.id}` as the thread key — stable across parallel evaluations of the same candidate → same runtime `sessionId` → `busy` conflicts between the two pod evaluations. (`task.scheduledRunAt` is part of the receipt-key sha256 hash inside the runtime, but does NOT vary between parallel pod evaluations of the same candidate, since both pods compute it from the same idle-window snapshot.)

3. **No per-(assistant, chat) durable evaluation state.** The cooldown check only filters `notificationIntent` rows with `lifecycleStatus IN (pending, claimed, delivered, deferred_quiet_hours, deferred_rate_limit)`. Intents in `failed` or `dead_letter` state are invisible → the candidate re-qualifies immediately after delivery failure → infinite re-evaluation loop.

4. **409 from runtime is treated as a retryable error.** The `InternalRuntimeBackgroundTaskClientService` maps HTTP 409 to `retryable: false` but the scheduler logs it as a failure and burns attempt budget. There is no dedicated "defer, don't fail" path.

5. **Channel misconfiguration causes delivery loop.** The live DB policy for `idle_reengagement` had `escalationChannel = "telegram_thread"` which is unhealthy → intent `failed` → (with root cause 3) re-evaluation begins immediately.

## Decision

Apply five hardening measures in a single session, shipped as one deploy:

### 1. `pg_try_advisory_lock` in each scheduler `tick()`

All three polling schedulers (`idle_reengagement`, `background_task`, `background_compaction`) acquire a session-level Postgres advisory lock at the start of `tick()`. The lock is held for the duration of the tick and released in `finally`. Only one pod proceeds; the other exits the tick silently. Lock IDs are stable `bigint` constants defined per scheduler.

The lock/unlock commands are issued inside a `$transaction` interactive transaction to guarantee they share the same DB connection.

### 2. `AssistantIdleEvaluationMarker` — durable per-(assistant, chat) state

A new Prisma model `AssistantIdleEvaluationMarker` with a unique constraint on `(assistantId, chatId)` becomes the primary cooldown / attempt-budget source of truth for idle re-engagement.

Candidate qualification:
```
qualifies IFF
  latest_user_message exists
  AND now - latestUserMessageAt >= idleHours
  AND (
        no marker for (assistantId, chatId)
        OR marker.latestUserMessageAtSnapshot < latestUserMessageAt   -- new user activity
      )
  AND marker.attemptsForCurrentUserMessage < MAX_ATTEMPTS (= 2)
  AND (marker.nextEligibleEvaluationAt IS NULL OR <= now)
```

State transitions after `evaluate()`:
- `push` / `complete` → upsert marker with snapshot; set `attempts = MAX_ATTEMPTS` (closed until next user message)
- `no_push` → upsert marker with snapshot; increment `attempts`; if `>= MAX_ATTEMPTS` → closed
- LLM/delivery error → increment `attempts`; set `nextEligibleEvaluationAt = now + backoff` (30s → 2min → 10min, capped)

The existing `notificationIntent` cooldown filter is retained as a secondary guard only.

### 3. Per-evaluation unique `externalThreadKey`

`RuntimeBackgroundTaskEvaluationRequest.task` gains an optional `evaluationAttemptId?: string` field. When present, the runtime `buildToolRunRequest` uses it to build a unique `externalThreadKey`:

```
system:background-task:{task.id}:{evaluationAttemptId}
```

The API scheduler generates a fresh `uuid` before each `evaluate()` call and passes it in `task.evaluationAttemptId`. This eliminates the entire class of "background vs background lease conflict" — each evaluation runs in its own ephemeral synthetic session.

### 4. HTTP 409 = defer, not failure

`InternalRuntimeBackgroundTaskClientService.evaluate()` now returns a distinct outcome `{ ok: false, deferred: true, ... }` when the runtime responds with HTTP 409. The idle scheduler treats this as: do not increment `attempts`; set `nextEligibleEvaluationAt = now + 60s`. The existing `retryable` error path is unchanged for 5xx/408/429 responses.

The same `deferred` semantics are applied in `persai-background-task-scheduler.service.ts` and `persai-background-compaction-scheduler.service.ts` for consistency.

### 5. Channel allow-list validation for `idle_reengagement`

`ManageNotificationPlatformService.patchPolicy()` rejects any `channels` or `escalationChannel` value not in the idle allow-list when `source === "idle_reengagement"`:

Allowed: `user_preferred`, `web_notification_center`, `current_thread`, `email`  
Rejected with 400: `telegram_thread`, `web_thread`, `admin_webhook`, `web_push`, `mobile_push`

This prevents a misconfigured `telegram_thread` policy from silently putting every evaluation into a `failed` → re-evaluate loop.

The code-level default for `idle_reengagement` already has `escalationChannel: "web_notification_center"` which is safe; no default changes are needed.

## Consequences

- OpenAI costs for `background_task_evaluation` become strictly `users × MAX_ATTEMPTS (2)` per idle window.
- A new user-message resets the marker, opening a fresh 2-attempt window — the "magic" of proactive assistant engagement is preserved.
- No re-evaluation happens in `failed`/`dead_letter` states until the user sends a new message.
- Cross-pod parallelism for all three schedulers is eliminated via a single Postgres advisory lock per scheduler, with no external coordination infrastructure.
- A new migration adds the `AssistantIdleEvaluationMarker` table. On first deploy, no markers exist; all current idle candidates get a fresh 2-attempt window — expected and safe.

## Files changed

- `docs/ADR/090-idle-reengagement-prod-hardening.md` (this file)
- `packages/runtime-contract/src/index.ts` — `RuntimeBackgroundTaskEvaluationRequest.task.evaluationAttemptId?: string`
- `apps/api/prisma/schema.prisma` — `AssistantIdleEvaluationMarker` model
- `apps/api/prisma/migrations/20260510130000_adr090_idle_eval_marker/migration.sql`
- `apps/api/src/modules/workspace-management/application/internal-runtime-background-task.client.service.ts` — deferred outcome for 409
- `apps/api/src/modules/workspace-management/application/persai-idle-reengagement-scheduler.service.ts` — advisory lock; marker-based candidate selection; MAX_ATTEMPTS=2; backoff; unique evaluationAttemptId
- `apps/api/src/modules/workspace-management/application/persai-background-task-scheduler.service.ts` — advisory lock; 409=defer
- `apps/api/src/modules/workspace-management/application/persai-background-compaction-scheduler.service.ts` — advisory lock; 409=defer
- `apps/api/src/modules/workspace-management/application/notifications/manage-notification-platform.service.ts` — idle channel allow-list
- `apps/runtime/src/modules/turns/runtime-background-task-evaluation.service.ts` — unique `externalThreadKey` via `evaluationAttemptId`, extracted `buildExternalThreadKey` helper that defensively falls back to the legacy key on empty/whitespace input
- `apps/api/test/persai-idle-reengagement-scheduler.service.test.ts` (rewritten — 8 tests covering marker-window selection, MAX_ATTEMPTS, 409 defer, push-without-text, new-message reset)
- `apps/runtime/test/runtime-background-task-evaluation.service.test.ts` (updated with `runUniqueExternalThreadKeyTest`, `runLegacyThreadKeyFallbackTest`, `runEmptyAttemptIdFallsBackToLegacyKeyTest`)
- `apps/runtime/test/run-suite-isolated.ts` — registers the three new runtime tests
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`
