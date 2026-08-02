# ADR-170: Turn event log as the single source of presentation order

## Status

**Opened 2026-08-02** on baseline `dfcf081d` (clean tree, `main == origin/main`).
Founder-directed cleanup program: replace every client-side reconstruction of
process order with one server-owned ordered event log, delete the compensating
heuristic layer, and remove the superseded fields entirely — no legacy path, no
parallel source, no back-compat branch.

Parent agent orchestrates, audits, and commits. Implementation subagents use
`claude-sonnet-5-thinking-high` at the founder's explicit direction. One push at
the end of the program, after independent audits and the full gate; no
intermediate deploys.

Keep commits separate from ADR-161/162/163/164 and from ADR-169.

---

## Context — why the current model cannot be made correct

An assistant turn produces three kinds of presentable facts: the short
narration replicas the model writes before each tool call, the tool calls
themselves, and the delivery of produced artifacts (images, documents, files).
Today each of these travels in a different shape, and **none of them carries a
moment in time**:

| Fact        | Current shape                                                     | Order information it carries                                                      |
| ----------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| narration   | `workingNotes: string[]`                                          | array index only, and only after the step finished                                |
| tool call   | `toolInvocations[].iteration: number`                             | tool-loop counter, not a time                                                     |
| delivery    | `attachments[]` + `inlineMediaPlacement[{toolCallId, ids}]`       | a spatial binding to the tool call that produced or merely _started_ the artifact |
| live answer | cumulative `message.content` string (notes + answer concatenated) | string offsets                                                                    |

Consequences observed in production and reported by the founder repeatedly
during 2026-07-25…2026-07-31:

1. A deferred job's receipt binds to the tool call that **started** it, so a
   file delivered many steps later renders far above narration the user has
   already read ("прилипился в самый верх").
2. Live narration lives inside the cumulative `content` string and only later
   migrates into `workingNotes`, so a receipt arriving mid-sentence has no
   finished note to sit under; a fixed after-answer block places it
   permanently just above the streaming cursor ("едет за курсором").
3. Because the browser is the only place that can observe _when_ something
   actually appeared, the fix for (1) and (2) had to be browser-observed
   arrival snapshots — which do not exist after F5, so live order and
   history order legitimately disagree.

Every repair so far has been a better guess about time, layered on data that
has no time. The defect class is structural: **the surface reconstructs order
that the server never stated.** This ADR removes the reconstruction, not the
symptom.

---

## ИКР (Ideal End Result)

One append-only, server-numbered event log per assistant turn is the only
statement of order in the system. Every surface renders it by sorting on
`seq`. Live and history are the same sequence rendered by the same code, so
they cannot disagree. The client contains no notion of "where does this
belong" — no placement binding, no arrival snapshot, no offset anchoring, no
markdown sniffing, no claimed/unclaimed split.

**One sentence:** the server says when, the client only draws.

---

## Decisions

### D1 — One ordered event log owns order, built on the sequence that already exists

Each assistant turn owns `turnEvents`: an append-only list of events, each with
a server-assigned monotonic `seq` and an `at` timestamp. `seq` is assigned at
the moment the fact becomes true and is never recomputed, re-sorted, or
re-derived by any consumer. No other field in the system may be used to order
the process stream.

This is **not a new numbering mechanism**. `TurnStreamEnvelope.seq`
(`turn-stream-event-store.ts`) is already a server-assigned, monotonic,
per-turn, append-only sequence used by the ADR-158 bus for reattach replay — it
is simply ephemeral today and never reaches Postgres. This ADR makes that
sequence durable and canonical instead of introducing a second one.

One consequence is mandatory: the bus currently falls back to a **per-pod local
counter** when the durable store is unreachable. A pod-local counter cannot
number a durable cross-pod log. Therefore `seq` allocation moves to the durable
append primitive of D3, and the bus envelope carries the number it allocated
rather than allocating its own. One allocator, one number, no fallback.

`AssistantAsyncJobHandle.catchUpOrdinal` / `catchUpWaveId` (ADR-159 wave
ordering) and `RuntimeToolProgressEvent.seq` (per-tool-call progress lines) are
different axes and stay as they are.

### D2 — Closed event vocabulary

Exactly these kinds exist. The list is closed; adding a kind requires amending
this ADR.

| kind           | carries                                      | emitted when                                        |
| -------------- | -------------------------------------------- | --------------------------------------------------- |
| `note`         | text                                         | a pre-tool narration segment is complete            |
| `tool_call`    | tool name, ok, execution mode, tool call id  | a tool invocation completes                         |
| `answer_text`  | text segment                                 | a segment of the final answer is flushed            |
| `delivery`     | durable attachment id, artifact kind, filename, size | an artifact actually becomes available in this chat |
| `job_accepted` | job id, job kind                             | an async job is accepted                            |
| `turn_stopped` | reason                                       | the turn ends by user stop                          |
| `turn_failed`  | reason                                       | the turn ends by failure                            |

No `other`, no free-form metadata bag, no per-surface extras. Ephemeral live
signals — thinking text, tool progress, activity labels (ADR-149) — are **not**
events: they are transient status, they are never persisted, and they never
influence order.

`artifactKind` is `image | video | audio | document | file`. Audio is its own
kind rather than being folded into `file`, because a surface that has to guess
what a "file" really is has been handed a heuristic.

### D2.1 — `delivery` is emitted only where the durable attachment id exists

The runtime never emits `delivery`. It has no durable chat attachment id at
emission time, so it could only carry its own artifact id, which would force a
later artifact-to-attachment reconciliation — the same class of guessing this
ADR removes. `delivery` is appended exclusively by the server, at the moment the
attachment row is created, by the same primitive that allocates `seq`. This
holds for in-loop synchronous attachments and for late job deliveries alike.

### D3 — Emission at the moment of truth, through one append path

In-turn facts are emitted by the runtime as they happen. Out-of-turn facts —
principally a deferred media/document job delivering after its originating turn
has closed, from a scheduler-leased worker on any API pod — append to that same
turn's log with a higher `seq` through one narrow server-side append primitive
that atomically allocates `seq`. This primitive is the only writer. Concurrent
deliverers are serialized by it, reusing the same message-row serialization that
`DeliverChatAttachmentOnceService` already relies on (ADR-167 D5).

### D3.1 — The log is a metadata array on the assistant message, not a new table

`turnEvents` lives as one more key in the existing
`AssistantChatMessage.metadata` JSONB column. No Prisma migration, no new
model, no join, one read, and the append path serializes on the row it already
has to lock. A turn's log is tens of events, always read in full, so a
dedicated table would buy indexability we never query and cost a migration
approval gate plus a second repository — rejected deliberately, recorded here so
it is not re-litigated later.

### D3.2 — Interrupted turns have no separate assembly path

Today a partial or interrupted turn persists raw accumulated text with notes
still inline, because no note/answer split exists on that path. With events
there is nothing to split: a stopped turn simply has the events that were
emitted plus a terminal event. The divergent partial-turn text assembly is
deleted, not ported.

### D4 — The client never computes position

Consumers merge by event identity and sort by `seq`. There is exactly one
renderer for a turn's process stream, used by live streaming, reconciling,
committed, history-after-reload, and continuation bubbles alike. The only
difference between live and committed is whether the log is still open.

### D5 — Answer text is events, not a cumulative blob

The runtime stops producing a concatenated notes+answer string for
presentation. Narration and answer are separate events from birth, so nothing
downstream needs to split, strip, or prefix-match text. Persisted
`message.content` remains the clean final answer for history and provider
replay, but it is no longer a source of presentation order.

A delivery that lands between two answer segments is ordered between them by
`seq` — interleaving is a consequence of the log, not of character offsets.

### D5.1 — Answer segmentation is owned by the append primitive

Appending `answer_text` extends the last event when that event is also
`answer_text`; appending any other kind closes the open segment, so the next
answer text starts a new one. Nothing chooses a segment length, and no clock or
character threshold is involved: a delivery that lands mid-answer splits the
answer exactly where it landed, because every writer goes through the same
primitive. This is what the deleted character-offset anchoring was imitating.

### D5.2 — Transient duplication during the program, never in a deploy

Slices S1–S4 necessarily carry both the log and the fields it replaces, or no
intermediate slice would typecheck. S5 removes the old fields, and there is one
push after S6, so no deployed state ever has two sources of order. An auditor
reading a mid-program tree should treat coexistence as expected only before S5.

### D6 — Per-surface difference is one projection table

Which event kinds a surface shows, and in what visual form, is declared once as
data in a single projection table shared by all surfaces. Web and Telegram read
the same log and the same table. A surface may hide a kind; it may never
reorder, re-derive, or invent one.

Telegram's projection is defined to be behavior-identical to today: it renders
one flat message per turn whose body is the `note` and `answer_text` events
concatenated in `seq` order. That is byte-equivalent to the current cumulative
`assistantText` it sends, so Telegram output does not change — it merely stops
depending on a separately assembled blob. Telegram continues to show no tool
activity and no receipts.

### D7 — No legacy, no parallel source

In the same program, `workingNotes`, presentational `toolInvocations`,
`inlineMediaPlacement`, `inlineAfterToolCallId`, and the placement roles of
`producingToolCallId` / `sourceToolCallId` are removed from the contract, from
persistence writes, and from every surface.

There is **no backfill and no migration script**. A historical message simply
has an empty log, and an empty log renders no process block — that is the
general rule applied to empty input, not a legacy branch. Old messages keep
their answer text and their attachment strip and lose the collapsed «Выполнено»
expand, which the founder has explicitly accepted. No code path may branch on
"this message has no log".

### D8 — Reattach and catch-up are `sinceSeq`

Reconnect, thread restore, and history reconciliation request events after a
known `seq`. Idempotency is `seq` identity. This replaces the existing
per-handler dedupe and attachment-preservation compensations.

### D9 — Identity and provenance are typed fields, never string prefixes

No code may derive meaning from the shape of an id. Three current sniffs are
deleted:

- `shouldSuppressMediaReceipts` matching `message.id.includes("async-cont")`
  becomes an explicit server-set flag on the message.
- `isLocalScopedAssistantId` matching `local-assistant-` / `active-assistant-`
  prefixes across 30+ call sites becomes one typed provenance field set once by
  the send path.
- `isAsyncContinuationClientTurnId` matching the `async-cont:` prefix becomes
  the same typed field.

Ids stay opaque. This is in scope precisely because the same paths are already
being rewritten; leaving it behind would be the "parallel truth" this program
exists to remove.

### D10 — Note display class is decided once, on the server, deterministically

A pre-tool note that is structurally a content block (table, heading, fenced
code, a list of three or more items) renders inline as content rather than
folded into the collapsed badge. That product behavior is kept, but the client
stops inspecting text: the emitting side sets `note.display` once, by one
documented deterministic rule, and every surface obeys it. Classification of
_form_ is allowed and lives in exactly one place; inference of _order_ is not
allowed anywhere.

### D11 — Placement metadata is deleted, not repurposed

`inlineMediaPlacement` / `inlineAfterToolCallId` are removed outright. A
`delivery` event does not carry a producing tool call id, because nothing in the
product groups receipts by tool call — carrying it would only invite a second
ordering source to grow back.

### D12 — Live and reconciling are one path

The duplicated streaming and reconciling render branches collapse into a single
live path parameterized by whether text is actively appending. Committed and
history render the same stream from the same component, so a receipt cannot
appear in one structure live and a different structure after reload.

---

## Superseded decisions

These sections are replaced by this ADR. The remaining decisions in those ADRs
stay live truth and must not be disturbed.

| ADR     | Superseded                                                                                                                                                                                 | Stays live                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| ADR-165 | D2 (`producingToolCallId` as placement), D3 (`metadata.inlineMediaPlacement` + `afterToolCallId` on SSE), D4 (live vs committed piece kinds), D6.1 (`sourceToolCallId` placement fallback) | D1 defer policy, D5 warm-pod hydrate, D6 claim/settle routing                                         |
| ADR-166 | D6's "receipts in tool order" ordering clause                                                                                                                                              | D1, D2 claim gate, D3 wake-once, D4 eligibility, D5 Working snapshot, D7 event parity, D8             |
| ADR-167 | D4 in full (one-badge ordering rule, `workingNotes` prefix stripping, note+receipt stream construction)                                                                                    | D1 message identity, D2 cross-pod consumption, D3 no browser geometry, D5 deliver-once, D6 tombstones |
| ADR-162 | any reading that chat-present order derives from placement or arrival                                                                                                                      | queue, eligibility, wave-closed continue, publish identity                                            |

ADR-149 (durable Stop, deadlines, live activity), ADR-158 (durable turn stream
bus), ADR-159 (queue) are unaffected.

---

## Deletion inventory — server (`apps/runtime`, `apps/api`)

**Text assembly deleted** (`apps/runtime/src/modules/turns/turn-execution.service.ts`):
`assembleWorkingNotesAndAnswer` and the `toolStepTexts` accumulator that feeds
it; the presentation role of `mergeAssistantTurnText` (its prefix-dedupe /
segment-join rule exists only to rebuild one cumulative blob); the
`cleanedAccumulated` fallback for partial turns in
`stream-web-chat-turn.service.ts`. Emission replaces them at the two points
where the facts actually occur: where a step's narration is captured, and where
the final answer resolves.

**Order producers deleted**: `RuntimeTurnToolInvocation.iteration`;
`RuntimeOutputArtifact.producingToolCallId` in its placement role;
`inlineMediaPlacement` writers and readers —
`workspace-media-job-completion-delivery.service.ts` (`publishOpenTurnMediaPresent`,
`readInlineMediaPlacement`, `firstProducingToolCallId`),
`assistant-document-job-delivery.service.ts` (`publishOpenTurnDocumentMedia`),
`persist-assistant-message.ts`, and `extractInlineMediaPlacementFromMetadata`
in `web-chat-message-state.mapper.ts`.

**Contract changes**: `RuntimeTurnResult` loses `workingNotes`, `answerText`,
`assistantText`, `toolInvocations`; `RuntimeTurnToolInvocation` loses
`iteration`; `AssistantWebChatMessageState` loses `workingNotes`,
`toolInvocations`, `inlineMediaPlacement` and gains `turnEvents`;
`AssistantRuntimeWebChatTurnResult` / `AssistantRuntimeWebChatTurnStreamChunk`
lose their `workingNotes` / `finalAnswer` / `toolInvocations` carriers.
`ClientRuntimeTurnToolInvocation` and `stripToolInvocationsForClient` disappear
with them. Contract drift is closed in the same slice: `turnEvents` must exist
in `openapi.yaml` and the generated models, unlike `toolInvocations` and
`inlineMediaPlacement`, which were never modeled there at all.

**Kept deliberately**: the acknowledgement rules for deferred media and
documents (text is replaced only when the model said nothing) and the final
delivery honesty corrections. These rewrite _text_, not order, and their rules
stay as they are — see Non-goals.

**Server tests deleted or rebuilt**: `apps/runtime/test/assemble-working-notes-and-answer.test.ts`
(whole file), the `workingNotes` / `answerText` / `assistantText` assertions in
`apps/runtime/test/turn-execution.service.test.ts`, the placement contract
assertions in `apps/api/test/workspace-media-job-completion-delivery.service.test.ts`
and `apps/api/test/assistant-document-job-delivery.service.test.ts`, and the
metadata-shape assertions in `apps/api/test/persist-assistant-message.test.ts`.
The acknowledgement suites and `final-delivery-honesty.test.ts` stay.

---

## Mandatory cleanup carried by this program

These are not ordering defects; they are the junk that let ordering defects hide.

1. **37 runtime test files execute in zero gates.** `apps/runtime` runs tests
   through a manually curated array in `test/run-suite-isolated.ts`, so any file
   not hand-registered silently never runs — including
   `build-async-job-accepted-event.test.ts`, `turn-delivery-facts.test.ts`,
   `project-stream-events.test.ts` and `turn-execution-discovered-file-paths.test.ts`,
   which sit directly on this ADR's blast radius. This is exactly how a restored
   fix was silently reverted earlier in this program's history. The curated list
   is replaced by a glob, matching `apps/api/test/run-suite.ts`; files that fail
   under the glob are either repaired or deleted, never re-hidden.
2. **`apps/api/prisma/backfill-working-notes.ts`** is a completed one-off
   migration for a content format two generations old, and its test
   re-implements the logic instead of importing it. Both are deleted.
3. **Three dead regression guards** assert the absence of elements that no
   longer exist anywhere in source, so they can never fail:
   `process-live-unclaimed-receipt-stream`, `engagement-annotation`,
   `assistant-body-high-water` (the last a leftover of the browser-geometry
   mechanism ADR-167 D3 already retired). Deleted, not "kept just in case".
4. **Two test ids exist in source and are asserted nowhere**: `chat-title-pill`,
   `voice-stretch-pill`. Removed unless a rebuilt test claims them.
5. **`use-chat.ts` has 43 invalid UTF-8 characters across 11 lines** — em dashes
   and arrows destroyed by an earlier Windows shell write, confirmed by a byte
   scan, not a display artifact. A repo-wide scan of `apps/` and `packages/`
   found no other affected source file. Repaired in the slice that rewrites the
   file.
6. **Eight of eleven exports in `use-chat.ts` are unused outside the file**
   (`ChatMessageRole`, `ChatMessageStatus`, `PendingSendStatus`,
   `ChatPlatformNotice`, `RecentAutoCompactionNotice`, `ChatEntry`,
   `ChatSendOptions`, `formatTurnRoutingBadgeLabel`), verified mechanically with
   `knip` and per-symbol search. They lose `export`, or the symbol entirely
   where nothing reads it.
7. The duplicated SSE dispatch chain in `assistant-api-client.ts` (a ~20-branch
   `if/else if` copied byte-for-byte between the primary stream and reattach,
   plus a duplicated trailing-buffer flush whose own comment admits the copy)
   becomes one dispatcher parameterized by the read strategy.

---

## Deletion inventory — web (`apps/web`)

Verified by inventory on baseline `dfcf081d`. Sizes: `chat-message.tsx` 3,171
lines, `use-chat.ts` 7,882 lines; the addressable layer is ~1,400–1,600 lines
across both.

**Deleted outright** (`apps/web/app/app/_components/chat-message.tsx`):
`deriveLiveAnswer`, `UnclaimedReceiptArrival`, `arrivalNoteIndex`,
`receiptArrivalRef`, `liveTextHighWaterRef`, `hasObservedLiveFrameRef`,
`receiptsWithoutArrivalInfoRef`, `answerAnchoredReceipts`,
`liveBeforeContentPieces`, `liveAnswerSegments`, the `LiveAnswerSegments`
component, `resolveReceiptAttachments`, and `buildIterationBlocks` (its
`Math.max(toolIndex, arrivalIndex)` floor, its arrival buckets, and its
end-of-stream safety net all cease to have meaning).

**Rewritten to consume the log** (behavior preserved): `ProcessNoteReceiptStream`,
`ProcessBadge`, `IterationBlocks`, `MediaReceiptLines`, `resolveProcessBadgeLabel`,
`buildToolFamilyMicroRows`, `resolveToolFamily`, `bottomStripAttachments`.

**Deleted from `use-chat.ts`**: `mergeAttachmentsById`,
`mergeInlineMediaPlacementByToolCallId`, `mergeLiveAssistantWithCommittedHistory`
(including its longer-string-wins pick), `mergeTerminalAssistantWithLiveAttachments`,
`stampSuppressMediaReceiptsFromLive`, `mergeMediaEventIntoAssistantMessage`,
`ordinarySameIdMissedTerminalAttachmentOnly`, `isOrdinarySameIdHistoryTerminal`,
the `preservedAttachments` fallback chain in `applyTurnStatusState`, the
duplicated `authoritativeWorkingNotes` / `authoritativeToolInvocations` merge
blocks in both `send()` and `sendWelcome()`, and the reattach tri-state latch
replaced by `sinceSeq`.

**Cleanup carried in the same program** (found by inventory, unrelated to
ordering but inside the files being rewritten): five unreferenced test ids
(`process-live-note-receipt-anchor`, `live-answer-segments`,
`background-wait-footer`, `reconciling-cursor`, `attachment-strip-audio`); one
vacuous assertion against the never-existing `process-live-unclaimed-receipt-stream`;
the duplicated SSE dispatch chain in `assistant-api-client.ts`
(`streamAssistantWebChatTurn` vs `reattachAssistantWebChatTurnStream`); mojibake
in the `ChatMessageStatus` doc comment.

**Out of scope, stated explicitly:** `sortChatMessagesChronologically` orders
_messages within a thread_ by `createdAt`. That is a different axis from
within-turn process order and is not touched.

**Tests deleted** (they encode the heuristics, not product rules): the six
2026-07-31 `regression:` tests about riding the cursor, mid-sentence anchoring,
the early-tool-call floor and the reconcile frame; plus
`ADR-167: strips the raw workingNotes prefix…`, `ADR-167: live content matching
no workingNotes prefix renders unchanged…`, `ADR-167: delivery order follows
tool chronology…`, `ADR-165: live USER_TURN shows orphan media receipts when
placement is missing`, and `ADR-167: async-cont optimistic id suppresses
Получено without explicit flag`.

**Tests that must survive, rebuilt on log fixtures:** receipts fold into
«Выполнено» on commit with the terminal strip below; receipt click opens the
lightbox / downloads a document; no-path receipt stays non-clickable; superseded
document versions stay non-clickable; receipts survive live → committed; one
process badge per message; badge label resolution per tool family; expanded
badge groups notes then tool families; async-cont delivery-only bubbles show no
technical receipts; continuation strip suppressed until terminal commit;
stopped-by-user keeps partial text.

---

## Non-goals

- The model-owned-reply rule is unchanged: if the model wrote text, that text
  survives; server text fills only a genuinely empty reply.
- No change to queue/eligibility (ADR-159/162), Working snapshot semantics
  (ADR-166 D5), deliver-once identity (ADR-167 D5), terminal tombstones
  (ADR-167 D6), or assistant message identity (ADR-167 D1/D2).
- No new user-visible feature, no process-timeline UI component, no new
  registry or table beyond the log itself.
- No data migration of any kind: historical turns are not reconstructed,
  re-ordered, or given invented timestamps.
- No dynamic/token-threshold compaction work (ADR-161 owns that).

---

## Slices

Each slice is implemented by a `claude-sonnet-5-thinking-high` subagent, then
independently audited by a second one before the next slice starts. The parent
commits. There is one push, after S6.

**S1 — Contract and runtime emission.** The closed `TurnEventDraft` / `TurnEvent`
union in `packages/runtime-contract`; the runtime emits ordered drafts at the
points where facts actually occur; the `note.display` rule of D10 is applied once
at emission. Existing fields stay untouched in this slice (D5.2) so the tree
keeps typechecking; their deletion is S5.

**S2 — Durable sequence, persistence, and stream.** `seq` allocation moves into
one append primitive; the ADR-158 bus carries the allocated number instead of
its own, and its pod-local fallback counter is removed; `turnEvents` persists
into message metadata; SSE carries events with their `seq`; reattach becomes
`sinceSeq`; the media and document delivery workers plus ConversationalPublish
append `delivery` events for late completions; every `inlineMediaPlacement`
writer and reader is deleted.

**S3a — Web rendering.** Merge by identity, sort by `seq`, one live path (D12),
deletion of the anchoring/arrival/placement layer in `chat-message.tsx`, and
`chat-message.test.tsx` rebuilt on log fixtures with the six 2026-07-31
heuristic regressions deleted.

**S3b — Web state.** `use-chat.ts`: typed provenance fields replacing id-prefix
sniffing (D9), removal of the live-versus-committed merge helpers, `sinceSeq`
catch-up replacing the reattach latch, plus this file's dead exports and its
43 broken characters. Its 149-test suite is rebuilt per the classification
below.

**Scope reality, stated up front:** of those 149 tests only three exist solely
to pin a deleted mechanism. The large majority assert observable product rules —
same-id ownership, reattach and soft-detach recovery, phantom-placeholder
cleanup, out-of-order media merging — whose _fixtures_ are condemned while their
_assertions_ must survive. S3b is therefore mostly rewriting, not deleting, and
must not be estimated as a deletion pass. Four tests needed an explicit ruling:
"does not reconstruct tool status from historical media attachments" is deleted
because activity entries can only come from `tool_call` events and the failure it
guards becomes structurally impossible; the two per-thread streaming restore
tests and "history refresh drops non-live messages that leaked into the active
snapshot" are rewritten, because their rules stay meaningful when the log is the
only truth.

**S4 — Telegram projection.** One shared projection table; Telegram output
proven byte-identical to the current cumulative text on a fixture turn.

**S5 — Legacy fields removed and junk cleared.** `workingNotes`,
`toolInvocations`, `inlineMediaPlacement` gone from contract, OpenAPI, mapper,
persistence and every test fixture; the runtime test runner switched from a
curated list to a glob with all 37 orphans either repaired or deleted;
`backfill-working-notes.ts` and its test removed; web junk from the inventory
cleared.

**S7 — Mechanical dead-export sweep.** `knip` reports 76 further unused exports
and types across `apps/web` beyond the files this program rewrites (unused API
client functions, landing-demo types, admin helpers, stale constants). Removed
in one mechanical commit with per-symbol search evidence and no behavior change,
kept separate from the ordering commits so an audit can read either alone.

**S6 — Gate and acceptance.** Independent audits of every slice, workspace lint,
`format:check`, API and web typecheck, all affected suites plus the full serial
web suite, production build, one push, deploy, founder live acceptance.

---

## Acceptance

1. A mixed turn producing three artifacts (two images plus one document) with
   narration between them renders in identical order live and after a hard
   reload, with no receipt above narration that preceded it.
2. `rg` for the retired symbols returns nothing outside this ADR and the
   changelog.
3. The program deletes more lines than it adds. A net addition means a
   compensation layer was rebuilt instead of removed.
4. Telegram renders the same turn in the same relative order as web, through
   the shared projection table.
5. Reconnect mid-turn replays by `sinceSeq` with no duplicate and no missing
   event; Stop mid-turn leaves the log terminal and ordered.
6. Full local gate: workspace lint, `format:check`, API and web typecheck, all
   affected suites, production build. Independent allowed-model audits per
   slice. One push, then founder live acceptance on `persai.dev`.
