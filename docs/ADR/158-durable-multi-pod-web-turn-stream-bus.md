# ADR-158 — Durable multi-pod web turn stream bus

Status: **API bus + client lifecycle implemented locally** (opened 2026-07-19;
bus + client landed 2026-07-19; audit seq/attach repairs 2026-07-19).
Deploy / multi-replica live acceptance still open.
Parent: founder-directed prod fix after ADR-152 notify reattach showed
`live:false` / empty «Думаю» under `api` replicaCount ≥ 2.

## Problem

Live web chat SSE events (`delta`, `thinking`, `tool`, `tool_progress`, …)
were fanned out only through process-local `WebChatTurnStreamRegistry`.
With ≥2 API replicas and no sticky sessions:

- soft-detach reattach often hits a different pod → `live:false` → status
  poll only → no mid-turn text;
- ADR-152 notify continuation is worse: the scheduler owns the stream on
  whichever pod claimed the job, while the browser GETs another pod;
- UI still showed streaming «Думаю» / phantom cursors because client
  lifecycle treated non-live reattach like a live token stream.

Stop already uses Redis (`WebChatTurnStopDispatchService`). Streams did not.
ADR-149 soft-detach remains correct (SSE death ≠ Stop); only the live
catch-up plane was incomplete.

## Decision

1. **Durable turn stream bus (Redis)** on the same coordination URL family as
   Stop: `PERSAI_TURN_COORDINATION_REDIS_URL` with fallback to
   `BROWSER_BRIDGE_REDIS_URL`. Keyed by `(assistantId, userId, clientTurnId)`
   (`${assistantId}:${userId}:${clientTurnId}`).
2. **Owning path** (ordinary POST stream + web async continuation) appends
   every SSE-facing event to the bus and notifies subscribers. Local sinks
   remain for same-pod listeners.
3. **Reattach** on any pod: replay buffered events from the bus, then follow
   live appends until a terminal event (`completed` / `interrupted` /
   `failed`). `reattached.live` is true when the bus (or same-pod registry)
   can deliver events — not only when the process-local Map has sinks.
4. **Ephemeral only.** Postgres `AssistantWebChatTurnAttempt` remains status /
   `currentActivity` / terminal identity authority. Redis TTL bounds the
   buffer to turn lifetime (aligned with Stop owner TTL order of magnitude).
   No second source of truth for committed messages.
5. **Client lifecycle (same slice).** One clear teardown for primary /
   reattach / notify: no empty streaming «Думаю» when events are not live;
   terminal + history absorb always clears streaming flag, snapshot, and
   placeholder bubbles — including `async-cont:*`. Live activities bind only
   to the current live assistant for that `clientTurnId`, not orphaned chips.
6. **Single-process / no Redis.** Dev without Redis keeps in-memory bus only
   (same-pod). Prod must have coordination Redis (already required for Stop).

## Non-goals

- Sticky LB / pod affinity as the primary fix
- Reopening ADR-149, ADR-152 parent scope, or closed sandbox/scripts ADRs
- Persisting full token streams into Postgres
- Changing soft-detach (SSE death still does not Stop)
- Telegram live seconds UI

## Acceptance

- Soft-detach reattach on another API pod shows live deltas/tools
- Pure notify continuation shows live stream (or honest non-empty progress),
  not empty «Думаю» then sudden dump
- No phantom thinking cursor after terminal / history absorb
- Ordinary same-pod POST stream unchanged in behavior
- Stop still works cross-replica
- Focused tests for bus replay + client teardown; AGENTS/CI-like gate green

## Files (expected)

- `apps/api/.../web-chat-turn-stream-bus.service.ts` (new) + registry wrap
- `assistant.controller.ts` (POST publish + GET reattach replay)
- `stream-web-async-continuation.service.ts`
- `apps/web/.../use-chat.ts` (+ tests), chat-area/message if status binding
- `docs/API-BOUNDARY.md`, `ARCHITECTURE.md`, CHANGELOG, SESSION-HANDOFF
