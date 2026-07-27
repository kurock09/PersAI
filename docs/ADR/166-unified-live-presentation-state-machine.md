# ADR-166: Unified live presentation state machine

## Status

**Implementation CLEAN and pushed 2026-07-27 as `edb948f4`; not deployed or
live-accepted.** Founder-directed repair program opened on baseline
`1f2512a8e0e2e50cade98f1b5fee6e0475dd3bc7`.

All five slices are implemented locally. The implementation preserves an open
USER_TURN same-id live overlay across history/media reconciliation; uses an
explicit claim outcome to exclude stale continuation-owned jobs from live
present; makes catch-up visible only after runtime acceptance and a durable
publish identity; clears Working from post-terminal full snapshots; preserves
delivered current-turn media across Stop without a second wake; and replaces
the fixed `8.75rem` blank reserve with a compact accessible live rail plus a
per-message progressive height high-water mark. The bubble starts without
blank reserve, grows with real thought/activity content, and cannot shrink
again for that message. Focused three-image tests cover enqueue-order and
out-of-order completion, set-like
attachment/placement merges, Working `3→2→1→0`, soft detach/history/F5,
pre-accept busy, terminal-first discovery, and retry/failure identities.

Independent audits first returned DIRTY findings; repairs were applied and all
targeted re-audits returned CLEAN with no remaining P0/P1/P2. Recursive lint,
format, full workspace typecheck, full recursive tests, final default-parallel
`test:step2` (86 web files / 1115 tests), full production build, and
`git diff --check` pass. Deploy and authenticated live three-image acceptance
remain open.

This ADR is the repair authority for the shared presentation boundary only. It
amends ADR-162 catch-up presentation ordering and ADR-165 open-turn/live UI
clauses where they conflict. It does not reopen either program outside this
boundary. ADR-161 and ADR-164 prompt/tool-observation work remains separate.

Parent orchestrates, audits, and commits. Because this repair touches active
ADR-162 and ADR-165 implementation, implementation subagents use the stricter
existing allowance: **`cursor-grok-4.5-high-fast` only**.

## Ideal end result

For one user turn that requests a series of three images:

1. one live Assistant bubble remains the owner of the open turn;
2. each completed image adds one italic received-file receipt to that bubble
   and one attachment identity, without starting a new Assistant turn;
3. the Working popover decreases after each terminal job and disappears
   immediately after the last job succeeds, fails, or is cancelled;
4. history refresh, reconnect, thread switching, and F5 preserve that live
   bubble until the exact turn attempt is terminal;
5. if the turn closes before a job is presented, catch-up creates one new
   bottom bubble only after queue admission and runtime acceptance;
6. no previous user or Assistant rows are reinserted near the live tail;
7. Stop closes the current presentation identity. Delivered files stay on the
   interrupted bubble and never requeue narration onto that same bubble;
8. thinking, activity, await, shell progress, and received-file receipts form
   one compact live rail with no permanent empty-height reservation.

## Decisions

### D1 — One presentation identity per active attempt

`AssistantWebChatTurnAttempt` plus its bound `assistantMessageId` is the
authoritative live presentation identity. SSE and durable history are inputs to
that identity, not competing owners.

While the exact attempt is non-terminal, a same-id history row may contribute
durable fields and attachments but must not demote `streaming`/`reconciling`,
erase live thinking/activity, clear `liveInlineMediaReceipts`, or replace newer
live content. Terminal attempt truth permits committed replacement.

History reconciliation must match exact ids and preserve transcript order. It
must not absorb arbitrary older rows into the live tail.

### D2 — Open-turn media present is claim-gated

Finding a `running` attempt is not sufficient authorization to present.
Open-turn delivery proceeds only when the canonical async handle atomically
returns one of:

- newly claimed `current_turn_inline`; or
- already owned by the same canonical job as `current_turn_inline` (idempotent
  retry).

Any continuation, notify, legacy, or otherwise denied owner takes the closed
turn settle/queue path and must not pin, attach, or publish `media` on the stale
attempt. The boolean claim API is replaced by an explicit outcome so callers
cannot ignore denial.

Source finalization and attempt-terminal lag may still exist operationally, but
cannot create dual presentation because the handle ownership decision is the
gate.

### D3 — A completed series item does not wake the agent twice

Each media job has one narration owner. A job presented in the open turn remains
`current_turn_inline` through successful source persistence and is excluded
from catch-up. Source Stop/failure does not release an already delivered
current-turn artifact into continuation; the artifact remains honestly visible
on the interrupted bubble and the handle terminalizes without a second model
turn.

Sibling jobs may complete in any order. Attachment and placement merges are
set-like by attachment id and tool call id; retries do not duplicate receipts
or strip entries.

### D4 — Catch-up becomes visible only after eligibility

Queue claim and the final USER_TURN exclusion gate happen before discovery or a
visible chat row. ConversationalPublish must not leave a durable visible bubble
or `completionAssistantMessageId` across a pre-accept `busy`, gate denial, or
never-accepted runtime failure.

After runtime acceptance, exactly one publish identity is created/bound at the
bottom and reused for that accepted continuation. A retry after release-to-ready
must obtain a fresh bottom identity unless the prior attempt was provably
accepted and is being resumed.

### D5 — Working is a durable projection with complete terminal cleanup

`async_jobs_open` is a full snapshot, not an incremental patch. Every open-turn
canonical terminal transition—success, failure, cancellation, and reconciled
orphan—publishes a fresh snapshot after terminal state is durable. The web
replaces its per-kind active rows from that snapshot.

No message text, history refresh, or attachment event independently decides
that Working is finished. Reconnect/history may restore the same projection
from canonical active-job rows.

### D6 — One compact live rail

The pre-answer rail renders one current status label plus only content that
exists:

- bounded live-thinking lines while thinking;
- current tool/await label and useful progress while active;
- received-file receipts in tool order.

There is no up-front fixed `min-height`/`max-height` thought reserve when
thought text has never appeared. Instead, each active Assistant bubble keeps a
progressive in-turn height high-water mark: once thinking/activity/progress
raises the live bubble, later status swaps may reuse that space or grow it but
must not shrink it while the turn remains active. This prevents the transcript
from moving down after thoughts fade without preallocating a blank seven-line
slot before any thought exists. Final answer growth naturally consumes the
high-water space. Attachment-only patches do not force a user who scrolled
upward back to the bottom.

### D7 — Event parity

Primary stream, reattach stream, turn-status hydration, thread restore, and
history reconciliation use the same reducer semantics for message identity,
status, `streamingTextActive`, receipts, attachments, activities, and terminal
cleanup. Handler-specific object-spread variants are not separate product
state machines.

## Required scenario tests

1. Three image jobs finish during one open USER_TURN in enqueue order and again
   out of order: one Assistant bubble, three unique receipts/attachments,
   Working count 3→2→1→0, zero continuation discovery.
2. Same scenario with history polling after the first receipt: no live demotion
   and no reinserted prior transcript rows.
3. `claimOpenTurnLivePresent` denied because source finalization already assigned
   continuation while attempt status still says `running`: no open attach/SSE;
   exactly one later catch-up bubble.
4. Catch-up reaches a pre-accept runtime `busy`: no publish row or durable pin
   exists. After a new user message and later accepted retry, one fresh bubble
   appears below that user message.
5. The same canonical media job retries after claiming
   `current_turn_inline` but before delivery fully settles: the idempotent claim
   outcome reuses one live bubble and produces one set of receipts/attachments,
   with no continuation wake.
6. Stop after one of three images is delivered: delivered image remains once,
   unresolved jobs remain background truth, and no catch-up updates the
   interrupted bubble.
7. Success/failure/cancellation for the last active media/document/sandbox job
   clears Working without another chat event.
8. Primary, reattach, and F5 produce the same visible state from equivalent
   canonical facts.
9. On a mobile-sized viewport, thinking grows to four lines and alternates with
   shorter tool/await labels several times: the active bubble's measured
   height and transcript position never decrease during the turn, while a turn
   that has never shown thought text receives no up-front blank reserve.

## Slices

1. Web same-id live merge and transcript-order regression tests.
2. API explicit open-turn claim outcome plus terminal Working cleanup.
3. Queue admission/discovery/publish identity ordering and Stop/requeue repair.
4. Compact live rail and primary/reattach reducer parity.
5. Three-image-series integration fixtures, independent audits, full local
   verification, then founder-authorized deploy/live acceptance.

No intermediate deploy is accepted. No push is authorized by this ADR.
