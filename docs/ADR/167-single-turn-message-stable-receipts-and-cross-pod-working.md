# ADR-167: Single-turn message, stable receipts, and cross-pod Working

- Status: Implemented locally; independent audits and local gate CLEAN
- Date: 2026-07-28
- Baseline: `4c6738b00680c37fddf6e26299880ef9a814ee75`

## Context

Authenticated live reproduction, DOM recording, pod logs, and database rows proved four
separate failures in one ordinary web `USER_TURN`:

1. `AssistantBodyHighWater` retained browser-measured `min-height` after terminal state.
   The same committed message measured 916 px before F5 and 633 px after F5 at the same
   viewport.
2. Async media completion and the main stream could create different assistant rows.
   The worker bound an empty row while the turn was running; terminal persistence later
   replaced the attempt binding with the main row. F5 then exposed both canonical rows.
3. Live receipts split process pieces into multiple `ProcessBadge` components and were
   intentionally removed at commit. The recorded sequence showed image receipt, two
   “Completed” badges, PDF receipt, then both receipts disappearing at terminal.
4. Async completion on one API pod published `media` / `async_jobs_open`, but the original
   POST stream on another pod did not receive them. The POST registered the bus identity
   without attaching a consumer, while owner-pod `attachLocal()` did not subscribe to
   durable remote publishes.

The exact historical sticky-Working event order was not retained and was not reproduced.
The unversioned resurrection seam is therefore treated as bounded terminal hardening, not
as a proven total-order failure.

## Decision

### D1. One durable assistant message per ordinary open turn

`AssistantWebChatTurnAttempt.assistantMessageId` is the sole assistant-bubble identity.
Creation/binding is atomic, null-only, and same-id idempotent. Async completion, synchronous
media delivery, and final text persistence reuse that identity; no path may overwrite it
with a sibling row.

### D2. The original POST consumes cross-pod live-present events

The original web stream attaches a bus consumer after registration. Owner-pod local attach
combines local sink delivery, durable replay, and durable live subscription behind one
sequence dedupe gate. Only cross-pod-capable `media` and `async_jobs_open` events are
forwarded by this attached path; direct token/tool callbacks remain direct.

### D3. Browser geometry is not product state

Delete `AssistantBodyHighWater` and its terminal-persistent `min-height`. Normal document
flow owns message height. No viewport measurement is persisted or remembered.

### D4. One process badge and durable receipt projection

Receipts are derived from persisted attachments plus `inlineMediaPlacement`; no receipt
table or second event model is introduced. A message renders exactly one process badge.
Its receipt rail is separate, ordered by tool placement, and remains visible in live,
committed, reattached, and F5 history states. The full attachment strip also appears at
terminal.

### D5. Terminal jobs cannot be resurrected client-side

`async_jobs_open` may carry the exact terminal media/document job identity that caused the
snapshot. The client records a chat-scoped in-memory tombstone, removes that job, and
filters it from later stale snapshots. F5 reloads canonical open jobs, so tombstones need
not persist. A chat-wide durable revision is deferred unless a controlled two-pod test
proves a broader ordering failure.

## Non-goals

- No new presentation registry, receipt table, or universal process timeline.
- No Prisma migration or persisted browser-layout state.
- No change to async continuation narration ownership.
- No replacement of the full turn stream with a bus-only token stream.

## Acceptance

1. Async completion-first and stream-first interleavings produce one assistant row and one
   attachment set.
2. Remote-pod `media` and `async_jobs_open` reach the original POST exactly once and in
   sequence.
3. One process badge and the same receipt text survive live → commit → F5; the terminal
   attachment strip is also present.
4. No remembered or fixed assistant-body `min-height` remains.
5. A stale snapshot cannot re-add a terminal job after its terminal identity was observed.
6. Focused tests, full repository verification, independent audits, and an authenticated
   mixed image/PDF live smoke pass before production acceptance.

## Local implementation evidence

- D1–D5 are implemented on baseline
  `4c6738b00680c37fddf6e26299880ef9a814ee75`.
- Final independent API and web audits returned CLEAN with no P0/P1/P2.
- Focused API race, document-delivery, durable-bus, finalization, and attempt-identity
  coverage passed: five files, 51 passed and one optional Postgres probe skipped because
  no local Postgres was available.
- Focused web receipt, terminal strip, F5/history, Retry/Cancel, and Working coverage
  passed: three files / 264 tests.
- Mandatory repository gate passed: recursive lint, `format:check`, API typecheck, and web
  typecheck.
- Production acceptance still requires deploy plus authenticated mixed image/PDF live
  smoke including completion-first/stream-first, cross-pod delivery, terminal commit, and
  F5.
