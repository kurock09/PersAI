# ADR-167: Single-turn message, stable receipts, and cross-pod Working

- Status: Implemented locally; amend for deliver-once + unified timeline pending full gate
- Date: 2026-07-28 (amended 2026-07-29)
- Baseline: `4c6738b00680c37fddf6e26299880ef9a814ee75`
- Amend baseline tip before this slice: `548febf3`

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

Post-deploy live acceptance on `persai.dev` then proved an additional delivery/UX failure:

5. Worker delivery created a chat attachment, then `files.attach` of the same identity
   created a second attachment row. The web showed a separate receipt rail outside
   «Выполнено» chronology, duplicate thumbnails, and technical «Получено…» lines on
   async-continuation bubbles that only delivered attachments.

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

### D4. One process badge; delivery receipts as always-visible reply lines

Ordinary open `USER_TURN` renders exactly one process badge for tools/notes only.
Successful delivery receipts are **not** inside the collapsible «Выполнено» log.
They render as always-visible assistant reply lines **after** the process badge and
**before** the answer text, in actual delivery order
(`inlineMediaPlacement` / attachment append order for F5 hydrate). While the turn
is still open, each receipt reuses the same attachment URLs as the terminal strip:
images/videos open the existing lightbox; files download. No separate preview
pipeline. The full attachment strip also appears at terminal.

Standalone async continuation may own its own «Выполнено» when it performed real work.
Attachment-only delivery on a continuation must not show technical internal-delivery
«Получено изображение/файл» copy.

### D5. Atomic deliver-once by canonical identity

All chat attachment creates for assistant delivery go through one coordinator
(`DeliverChatAttachmentOnceService`) under message-row serialization. Identity is
canonical, not filename:

- media: artifact id when present, plus workspace artifact path aliases (including
  renamed persisted storage paths); legacy rows still match exact `storagePath`
- document: `docId` + `versionId` (or version number); a new version is a new deliverable;
  the same version is a duplicate

`files.attach` of an already-delivered identity returns structured model-visible
`already_delivered` and must not emit a second artifact or second attachment row. Ready
artifact delivery also clears that job from Working via existing `async_jobs_open`
terminal truth.

### D6. Terminal jobs cannot be resurrected client-side

`async_jobs_open` may carry the exact terminal media/document job identity that caused the
snapshot. The client records a chat-scoped in-memory tombstone, removes that job, and
filters it from later stale snapshots. F5 reloads canonical open jobs, so tombstones need
not persist. A chat-wide durable revision is deferred unless a controlled two-pod test
proves a broader ordering failure.

## Non-goals

- No new presentation registry, receipt table, Prisma migration, or persisted layout state.
- No new ADR for this amend; long-term truth stays on ADR-167.
- No change that reopens ADR-162 queue/eligibility mechanics beyond publish bind to the
  open turn message.
- No replacement of the full turn stream with a bus-only token stream.

## Acceptance

1. Async completion-first and stream-first interleavings produce one assistant row and one
   attachment set per delivered identity.
2. Remote-pod `media` and `async_jobs_open` reach the original POST exactly once and in
   sequence.
3. One process badge for tools/notes; delivery-ordered receipt lines survive live →
   commit → F5 as always-visible reply content after «Выполнено» and before the answer;
   the terminal attachment strip is also present.
4. Worker delivery then `files.attach` of the same identity yields one attachment row and
   model-visible `already_delivered`.
5. Same document version is not re-delivered; a new document version is deliverable.
6. No remembered or fixed assistant-body `min-height` remains.
7. A stale snapshot cannot re-add a terminal job after its terminal identity was observed.
8. Async-continuation attachment-only delivery does not show technical «Получено…».
9. Focused tests, full repository verification, independent audits, and an authenticated
   mixed image/PDF live smoke pass before production acceptance.

## Local implementation evidence

- D1–D3 and D6 landed on baseline `4c6738b0` / tip `52c1e606` with CI follow-up
  `548febf3`.
- 2026-07-29 amend implements D4–D5 locally: deliver-once coordinator, runtime
  `already_delivered`, unified process-badge timeline, ADR reconcile.
- Cleanup audit follow-through: MediaDelivery peeks delivery identity before
  download; ConversationalPublish residual selection uses the same identity
  matcher (not renamed `storagePath` alone); dead
  `AssistantChatMessageAttachmentRepository.create` removed; stream
  `liveSyncMediaPresent.deliveredIdentities` kept as process-local POST
  optimization beside durable deliver-once.
- Production acceptance still requires deploy plus authenticated mixed image/PDF live
  smoke including completion-first/stream-first, cross-pod delivery, terminal commit, and
  F5.
