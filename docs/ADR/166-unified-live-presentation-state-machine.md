# ADR-166: Unified live presentation state machine

## Status

**Release `edb948f4` was deployed to `persai.dev`, but founder live acceptance
failed on 2026-07-27/28.** Founder-directed repair program opened on baseline
`1f2512a8e0e2e50cade98f1b5fee6e0475dd3bc7`; the bounded follow-up on baseline
`e8f26b2f` is now local CLEAN and uncommitted.

The deployed release proved two live gaps that keep this ADR open. First,
ordinary web USER_TURN lookup used a nullable-unsafe Prisma predicate, so
`surfaceClient = null` turns were excluded together with
`surfaceClient = "async_continuation"`, allowing deferred media to settle
`delivered` without live chat attach/receipt and letting the wake gate miss an
active ordinary user turn. Second, after a network stall or F5, a same-id
early assistant history row could be treated as terminal client truth while
the ordinary attempt was still `accepted` or `running`, clearing the active
busy/send state, reopening the composer, and later surfacing
`native_runtime_conflict` as a scrambled-looking orphan when continuations or
media arrived.

This follow-up repair keeps the original ADR-166 boundary and updates the
authoritative live truth: active attempt status outranks same-id history while
non-terminal; open-turn recognition is nullable-safe; terminal same-id retries
stay immutable; ambiguous sends reconcile before any redispatch; live
continuation strips are suppressed until terminal commit; and restored
user-only `native_runtime_conflict` remains a recoverable pending failure.

Two final independent post-repair re-audits returned CLEAN with zero P0/P1/P2.
The mandatory local gate passed: recursive lint, `format:check`, API
typecheck, and web typecheck. Focused API suites passed, focused web
`use-chat` / `chat-message` / `chat-area` passed (`264/264`), and optional
real-Postgres probes skipped honestly when no local DB was available.

Full recursive verification was also resolved locally. The first default-
parallel recursive test attempt exposed only web timing/contention failures.
Each originally failing web test passed in isolation, and the subsequent
default-parallel web rerun still showed scattered timeout-only unrelated
failures under contention. Treat that as harness-parallel evidence, not as a
product regression claim: the authoritative full web serial rerun passed
`86 files / 1130 tests` with `--maxWorkers=1`. All non-web recursive tests
passed, API `test:step2` passed, and the full production build passed.

Therefore the local code/audit/gate state is CLEAN. Deploy/redeploy and
authenticated live smoke remain pending, so this ADR must not claim deployed
repair or live acceptance.

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
authoritative live presentation identity. For web continuity, an
`accepted` or `running` attempt remains the active authority even when
durable history already contains an assistant row with the same
`clientTurnId`. SSE and durable history are inputs to that identity, not
competing owners.

While the exact attempt is non-terminal, a same-id history row may contribute
durable fields and attachments but must not demote `streaming`/`reconciling`,
erase live thinking/activity, clear `liveInlineMediaReceipts`, or replace newer
live content. It also must not clear busy/pending-send state, unlock the
composer, or treat the send as settled solely because an assistant row exists.
Terminal attempt truth permits committed replacement.

History reconciliation must match exact ids and preserve transcript order. It
must not absorb arbitrary older rows into the live tail.

### D2 — Open-turn media present is claim-gated and nullable-safe

Finding a `running` attempt is not sufficient authorization to present.
Open-turn lookup for an ordinary web USER_TURN must include
`surfaceClient = null` and exclude only the exact
`surfaceClient = "async_continuation"` sentinel. A nullable inequality that
filters out both values is invalid for live-present and wake-gate decisions.

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
- ordinary live USER_TURN received-file receipts in tool order.

Classic attachment strips for catch-up / async-continuation bubbles are
suppressed while that continuation is still streaming or reconciling, so a
committed-looking image cannot appear below a live cursor. One canonical
attachment strip appears only after the continuation becomes terminal and is
committed to history.

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

### D8 — Ambiguous sends reconcile before retry or cancel

Web retry/cancel decisions are driven by the durable logical-turn status for
the exact `clientTurnId` and the exact current pending user message id:

- `unknown` means server acceptance is unconfirmed. The client must reconcile
  and must never redispatch the same logical send automatically.
- `accepted` or `running` means the exact logical turn is active; the client
  reattaches that id and keeps the composer locked.
- `completed` hydrates the committed turn under the same id.
- `failed` or `interrupted` is terminal and immutable for that id. Explicit
  Retry mints a fresh `clientTurnId` plus fresh staged attachment identities.

User-visible terminal `native_runtime_conflict` restored during reconnect or
late reconciliation is presented as a recoverable failed pending send, not as a
committed assistant orphan. That restored pending slot may already be backed by
a canonical server user row; Retry and Cancel never delete that canonical row
locally. For text-only sends, explicit Retry creates one fresh logical turn
while preserving the old failed canonical row. If the restored canonical row
had attachments, browser `File` objects are unavailable after F5, so Retry must
not silently fall back to text-only: it preserves the failed row, restores text
into the composer, unlocks pending, and requires the user to reattach files
before a new send. Cancel may restore the draft only when the client has proof
the request never left the device. If acceptance is unconfirmed, Cancel
reconciles first and cannot unlock `unknown`, `accepted`, or `running`.
Retry/Cancel actions bind only to the exact current pending user message id,
never to historical failed rows in the transcript.

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
10. After a network stall or F5, history may contain an early assistant row for
    the same `clientTurnId` while the ordinary attempt is still
    `accepted` or `running`: the active attempt remains authoritative, the
    composer stays locked, and no second user send is admitted.
11. Restore from a local snapshot with no active controller and only a user-side
    pending bubble: late terminal `native_runtime_conflict` becomes a
    recoverable failed pending presentation, not a committed-looking orphan.
12. Nullable SQL query-shape coverage proves ordinary web USER_TURN lookup
    includes `surfaceClient = null` and excludes only exact
    `surfaceClient = "async_continuation"`; optional real-Postgres probes verify
    the same semantics when local DB is available.
13. Retry/cancel status matrix:
    `unknown` never redispatches;
    `accepted|running` reattach exact id;
    `completed` hydrates;
    `failed|interrupted` stay immutable and Retry uses a fresh id;
    restored canonical rows are never deleted locally; and Cancel restores draft
    only for confirmed-never-sent local failure.
14. A restored pending send that later terminalizes with
    `native_runtime_conflict` remains explicitly retryable with a fresh turn and
    fresh attachment identity, with no transcript scramble or same-id reuse.
15. Continuation media ordering: while catch-up is streaming or reconciling, no
    classic attachment strip renders below the live cursor; one canonical strip
    appears only on terminal commit.
16. Restored pending-send actions bind only to the exact current pending user
    message id. Historical failed rows remain inert transcript history.
17. If a restored canonical failed row has attachments after F5, Retry must not
    silently send text-only without browser `File` objects; it preserves the
    failed row, restores text into the composer, unlocks pending, and requires
    reattachment before the next logical send.

## Slices

1. Web same-id live merge and transcript-order regression tests.
2. API explicit open-turn claim outcome plus terminal Working cleanup.
3. Queue admission/discovery/publish identity ordering and Stop/requeue repair.
4. Compact live rail and primary/reattach reducer parity.
5. Three-image-series integration fixtures, independent audits, full local
   verification, then founder-authorized deploy/live acceptance.

No intermediate deploy is accepted. No push is authorized by this ADR.
