# ADR-159: Session Work Queue and Async Catch-up

## Status

**Open 2026-07-20 — web live acceptance passed; Telegram remains pending.**
The scheduler SQL, exact `JOB_CATCHUP` projection, logical-receipt ambiguity
fence, and live web continuation discovery repairs are deployed. Current
accepted releases are runtime continuation repair `ca0780dc`, web discovery
release `687876a7`, API Clerk registration hotfix `d62de2ee`, and GitOps pin
`b71904b9`. Argo is `Synced/Healthy`; API, web, and runtime each have 2/2 ready
replicas on those exact selective pins. Real-PostgreSQL concurrency coverage
proves two request ids for one logical continuation produce one authoritative
receipt and no reclaim.

Browser live acceptance passed three explicit recovery modes: an already-open
chat received two continuations without refresh; switching away during active
work and returning restored the job and delivered its continuation; reloading
during active work immediately restored Working and delivered the final
continuation without another refresh. ADR-159 remains open until Telegram
background continuation acceptance passes and final documentation is
reconciled. Do not reopen or implement the discarded ADR-160 draft.

**Post-deploy live-web regression repair (deployed and web-accepted):** Slice 2's
canonical-nonterminal-only Working truth remains unchanged. The browser had
also depended on those rows to discover `continuationClientTurnId`, so a
terminal job could become ready/claimed and stream a persisted continuation
without an already-open chat learning its synthetic turn id. A separate
assistant/user/chat/thread-scoped Redis replay channel now announces only
`{clientTurnId}` after the exact ADR-158 stream is registered. One
authenticated chat-level SSE subscription uses cursor replay and teardown;
the browser deduplicates discovery and attaches to the unchanged per-turn
stream for the complete lifecycle. History remains fallback/reconciliation,
not normal live delivery. This is a repair within ADR-158/159 boundaries, not
a new job-state or Working model.

**Slice 2 final repair:** Working projections now include only
canonical nonterminal media/document/sandbox jobs; terminal continuation facts
remain history/catch-up input but no longer render as active work. Legacy
completion framing is deferred until canonical attachment delivery succeeds,
and catch-up guidance now constrains narration to the exact terminal facts and
stable queue ordinal while preserving later user-message priority. This does
not include Stop, Redis, or heartbeat changes. Document delivery finalization
also locks the document row and advances `currentVersionId` only by durable
monotonic version number; a late older success remains delivered history as
`superseded` rather than regressing the current revision. The same locked
transaction finalizes attachment currentness, and revision-source lookup
requires the canonical current version identity rather than attachment
recency alone.

**Slice 3 final repair:** web stream admission awaits durable
cross-replica Stop-owner publication before emitting `started` or opening
runtime work; publication failure fails the fresh stream closed rather than
falsely promising Stop. Redis metadata/replay/subscribe failure during
reattach is non-live (`liveTokenStream:false`) so the client falls back to
canonical attempt status/history, never a 500. Same-owner stream
re-registration preserves replay events and sequence, while conflicting
registration fails closed. Catch-up heartbeat loss is latched and blocks claim
completion; already-dispatched receipt/output remains for durable
reconciliation. Telegram ambiguity first reconciles exact requestId receipt /
in-flight status: proven acceptance dispatches, proven absence releases ready,
and ambiguous status fails closed for orphan reconciliation without re-execute.
Registration now returns explicit `registered | idempotent | conflict |
unavailable` state; conflict/unavailable is an admission error, never a
log-and-continue path. A per-claim coordination abort signal is raised on
catch-up heartbeat loss and is distinct from a user Stop.

Final invariants: claim-one/process-one means no acquired lock or pre-dispatch
claim waits unheartbeated behind another runtime; coordination loss reconciles
the exact runtime receipt before only proven-absent work returns ready;
attachment-first delivery and locked monotonic document-current-version
promotion remain authoritative; Redis owner/stream coordination provides
cross-replica Stop and non-live reattach degrades to canonical history/status.

S0 docs checkpoint accepted; S1 implements `ChatWakeCoordinator` + per-chat
`async-catchup:{chatId}` SchedulerLease lock + FIFO head claim, dispatch gate
(never `markDispatched` before runtime lease + web attempt running), and
deletes parked-accepted busy (`resetToAccepted` / reclaim-as-product). **S2**
adds durable idle-pause (`assistant_chats.last_user_turn_terminal_at` +
`CATCHUP_IDLE_PAUSE_MS=2000`), durable preparing open window
(`last_user_turn_started_at`; TG stamp at inbound user-message start),
hardened user priority (open window + web attempt + Telegram accepted
non-`async-cont` receipt), post-lock + pre-runtime TOCTOU gate, and FIFO
one-at-a-time tests. **S3** adds structured `wakeKind=job_catchup` markers
in continuation `facts` (ordinal/total, interleaved, originating vs latest
user message, retained terminal/`sandboxResult`) via scheduler
`buildRequest` (web + Telegram share the builder); quiet
`AssistantChatMessage.metadata` flags on persisted catch-up bubbles; runtime
projects the final model-facing user message as an explicit bounded synthetic
`JOB_CATCHUP` event with exact terminal facts and instructions to handle only
that event (rather than stripping the transport placeholder and leaving an
old user instruction active). **S4** purges
dead wake APIs (`claimReady`, `requeueBusyNotStarted`), drops
`legacyChosen` alias, confirms no client stuck-accepted absorb product path
(ADR-158 history absorb for null-user async-cont remains), documents
historical `narrationOwner=legacy` one-shot heal residual (no enum migration),
and lands durable ordinals + `duplicate_handled` complete.

Parent orchestrates. Implementation subagents for this program: founder-directed
**`cursor-grok-4.5-high-fast`** only. Parent audits/commits only. One bounded
slice at a time. Intermediate deploys are forbidden until S5.

Supersedes conflicting wake-dispatch / lease-race / parked-busy clauses in
ADR-152, ADR-157 D4.1 **dispatch** shape, and temporary ADR-158 client
crutches — see **Supersession**. Does not reopen ADR-151, ADR-156, or closed
sandbox/Scripts programs. Opaque `jobRef`, in-turn `await.wait`, Stop≠cancel
background job, and ADR-158 stream bus remain.

## Context

Cursor-like product truth is a **per-session serial agent**: the user speaks,
the agent answers; background work may finish meanwhile, but catch-up turns
run only when the session is free, in order, with honest markers. PersAI today
is close on contracts (opaque `jobRef`, auto-subscribe, resumable web stream)
and far on dispatch:

1. **Lease race (“whichever acquires first”).** ADR-152 treated the runtime
   session lease as the sole no-parallel gate between ordinary user turns and
   job continuations. Ready handles are claimed globally; a catch-up and a
   user POST race the same lease. Busy outcomes park or requeue chaotically.
2. **Parked `accepted` busy strategy.** Web async-cont on `busy` can
   `resetToAccepted` and rely on parked reclaim / ~30s parked reconcile /
   client stuck-accepted absorb. That is timer architecture and zombie SSE
   risk, not a session queue.
3. **Auto-subscribe without ordered catch-up.** ADR-157 D4.1 correctly
   auto-subscribes unresolved child jobs so background completion wakes the
   agent without explicit `await.notify`. Dispatch still fans into parallel
   wakes / reconcile timers instead of a per-chat FIFO with user priority.
4. **Model/UI honesty gap.** The assistant often does not see a structured
   `wakeKind=job_catchup` with ordinal, interleave facts, and `jobRef` — only
   ad-hoc continuation prompts or legacy heal paths.
5. **Telegram vs web asymmetry risk.** Web has SSE / attempt / absorb crutches;
   Telegram blocking deliver is fine, but must obey the **same** queue rules
   (no web-only zombie paths as product truth).

Founder rejects more reconcile timers as architecture. The delete path for
crutches is part of this ADR (S1/S4), not a forever dual path.

## Decision

### D1 — Per chat/session work queue (serial agent)

Each chat has at most **one active agent execution** at a time:

| Work kind     | Origin                                              | Priority   |
| ------------- | --------------------------------------------------- | ---------- |
| `USER_TURN`   | Ordinary user message (web POST / Telegram inbound) | **Higher** |
| `JOB_CATCHUP` | Subscribed handle → ready → scheduled continuation  | Lower      |

Serial means: never two agent turns for the same chat overlapping in the
runtime session lease + (web) turn-attempt running sense. Sync in-turn
`await.wait` / current-turn narration stays inside the open `USER_TURN`
bubble (ADR-157 D4.1 unchanged for same-bubble sync).

### D2 — Design lock: ChatWakeCoordinator (no new queue table)

**Chosen design:** `ChatWakeCoordinator` over existing
`assistant_async_job_handles` with an **exclusive per-chat catch-up lock** and
**ready FIFO**, not a second durable queue table.

Justification (PROD-simple, Cursor-shaped):

- Ready / claimed / dispatched handle rows already are the durable catch-up
  backlog; a companion `chat_work_queue` would dual-write with the handle
  state machine and reopen missed-wake races.
- `USER_TURN` is already admitted by the chat HTTP/channel path; it does not
  need an enqueued row. Priority is enforced by **not dispatching catch-up**
  while a user turn is active or inside the idle-pause window.
- Exclusive catch-up lock gives “at most one catch-up active per chat”
  without inventing parked `accepted` attempts.
- No new “architecture timers.” Existing SchedulerLease ticks may **drive**
  the coordinator; they must not **own** parked-accepted reclaim as product
  truth.

**Rejected alternative:** additive `assistant_chat_work_items` table with
`USER_TURN` / `JOB_CATCHUP` rows. Clearer on paper, heavier in prod (migration,
dual authority with handles, enqueue on every user POST). Revisit only if
handle-scoped FIFO proves insufficient after S2.

#### Coordinator rules

1. **User always wins.** If a `USER_TURN` is preparing, running, or within the
   post-user **idle-pause debounce**, no `JOB_CATCHUP` may acquire the
   catch-up lock or call runtime.
   For ordinary web turns, preparation stamps the durable user-open window
   immediately after chat resolution and before persisting the user message;
   preparation retains terminal-close ownership until successful
   `markRunning` transfers it to the attempt.
2. **Idle-pause debounce.** After a user turn becomes terminal (completed /
   interrupted / failed), wait a short bounded idle pause (implementation
   constant; order of ~1–3s, tunable once) before the coordinator may start
   the next catch-up. Purpose: let the user send a follow-up without racing a
   докат. Not a parked-accepted reconciler.
3. **FIFO catch-ups.** Among handles for that chat in `ready` (source
   finalized, subscribed, entitlement OK), dispatch oldest `readyAt` first,
   then `updatedAt`, then stable handle `id` for equal timestamps.
   After one catch-up terminals, the next ready handle may run — still only
   when idle-pause allows and no user turn is active.
4. **claimReady is chat-scoped.** Global “grab any ready handle” is replaced
   by: select candidate chats that are catch-up-eligible → take exclusive
   per-chat catch-up lock → claim **at most one** head handle for that chat.
5. **Dispatch gate (hard invariant).** Never `markDispatched` before:
   - runtime session lease for that chat is acquired for this continuation, **and**
   - (web) `AssistantWebChatTurnAttempt` is created/claimed and **running**
     under `continuationClientTurnId`, stream registry/bus attached as today
     (ADR-149 / ADR-158).
     On pre-acceptance `busy` / lease miss: release catch-up lock, leave handle
     `ready` or reclaim to `ready` without fabricating dispatch proof — **no**
     `resetToAccepted` park.
6. **At most one catch-up active per chat.** Enforced by the exclusive
   catch-up lock + single head claim. Depth / eight-job cap / Stop≠cancel job
   unchanged.

#### Slice 1 admission linearization repair

The final pre-runtime gate is not a check-then-act read. `JOB_CATCHUP` is
linearly admitted only by a successful conditional update of its
`assistant_chats` row (`catch_up_admission_fence`). Every web turn, including
no-`clientTurnId` synchronous turns, calls the matching chat-row USER_TURN
admission mutation immediately after chat resolution and before user-message
persistence; Telegram stamps the same
row after persisting its inbound user message and before runtime acceptance.
The chat row is the exact serialization point: whichever mutation commits
first wins; a later catch-up CAS sees an open user window and requeues, while a
later user cannot preempt an already-admitted catch-up. Preparation failure
after web admission closes the durable user-open window before propagating the
failure. Runtime session lease
remains an execution guard, not the priority decision. Candidate scanning uses
bounded keyset pages (32 rows/page, at most 256 rows/tick) ordered by durable
`catch_up_last_scanned_at`; every evaluated chat is stamped, making
round-robin fairness eventual across ticks and replicas rather than
process-local.

#### Schema sketch (additive, minimal)

No new queue table. Prefer one of (S1 picks exact shape; both are ADR-legal):

**Option A (preferred):** reuse `SchedulerLease` with a deterministic key
`async-catchup:{chatId}` (or equivalent) as the exclusive catch-up lock.
Handle row CAS remains authority for `ready → claimed → dispatched`.

**Option B:** additive nullable columns on `assistant_chats` (or a tiny
`assistant_chat_wake_locks` row keyed by `chatId`):

| Column                 | Role                                                 |
| ---------------------- | ---------------------------------------------------- |
| `catchUpLockToken`     | opaque owner token                                   |
| `catchUpLockExpiresAt` | lease TTL                                            |
| `catchUpHandleId`      | optional pointer to active claimed/dispatched handle |

Either way: lock TTL must be shorter than “forever park” and must release on
terminal / fail-closed paths. Do not introduce a 30s parked-accepted
reconciler as the wake architecture.

Durable catch-up ordinal columns (stamped at ready-promotion; S4 CLEAN):

| Field              | Role                                                         |
| ------------------ | ------------------------------------------------------------ |
| `catchUpOrdinal`   | 1-based FIFO ordinal in the open catch-up wave               |
| `catchUpWaveTotal` | stable N for the wave (bumped as siblings join)              |
| `catchUpWaveId`    | shared id while any ready/claimed/dispatched sibling remains |

Interleave remains derived at dispatch (`wakeInterleaved` not stored).

### D3 — Product semantics (founder)

1. **Per session/chat work queue — serial agent execution.**
2. **`USER_TURN` priority over `JOB_CATCHUP`.**
3. **User chats while jobs finish:** answer the user first; after idle pause,
   sequential докаты (catch-up bubbles) with markers — never parallel wakes
   for the same chat.
4. **Assistant sees WHAT arrived and HOW:** structured wake facts include at
   least `wakeKind=job_catchup`, ordinal, interleaved flag, `jobRef`, and
   existing bounded terminal/sandbox facts. No fake-user-only cue as the
   product signal.
5. **Sync in-turn `await` / current_turn unchanged** — same open assistant
   bubble (ADR-157 D4.1).
6. **Telegram:** same queue rules; blocking deliver OK; no web SSE zombies as
   architecture; no Telegram-only parallel catch-up.
7. **Invariants:**
   - never `markDispatched` before runtime lease acquired + (web) attempt
     running;
   - at most one catch-up active per chat;
   - no parked `accepted` busy strategy;
   - no reconcile timers as wake architecture (missed-completion recovery for
     canonical/detached jobs may remain operational; it must not own session
     serialization).

### D4 — Crutch delete path (S4 landed; inventory reduced)

| Crutch                                                       | Fate (S4)                                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resetToAccepted` park on async-cont busy                    | **Deleted** as product path (S1)                                                                                                                                        |
| Parked reclaim / ~30s parked reconcile                       | **Deleted** as architecture (S1/S4)                                                                                                                                     |
| Global `claimReady` / `requeueBusyNotStarted`                | **Deleted** (S4); production uses `claimReadyHeadForChat` + `releaseClaimToReady`                                                                                       |
| `legacyChosen` finalize alias                                | **Deleted** (S4); return `autoSubscribed` only                                                                                                                          |
| Client stuck-accepted absorb as product                      | **Absent on main** (S4 verified); ADR-158 history absorb for null-user async-cont completion remains                                                                    |
| Sticky LB / pod affinity as wake fix                         | Remains non-goal; ADR-158 bus is the stream plane                                                                                                                       |
| Fake-user-only cue for catch-up                              | **Deleted**; `wakeKind` markers (S3)                                                                                                                                    |
| Historical `narrationOwner=legacy` enum + one-shot heal      | **Residual (documented):** live finalize never stamps `legacy`; subscribe/completion still heal historical rows → continuation. No enum data migration in this program. |
| `legacy_frame` / `skip_legacy_frame` delivery decision names | **Retained** (wide delivery blast; not a wake crutch)                                                                                                                   |

ADR-158 **stream bus stays**. Soft-detach (SSE death ≠ Stop) stays ADR-149
truth. Wake-path crutches above are purged; only the historical-legacy heal
residual remains intentional until a future migration ADR.

### D5 — Unchanged contracts

- Opaque `jobRef` / `await.wait` / `await.notify` shapes
- Auto-subscribe intent (ADR-157 D4.1): unresolved children still subscribe on
  source finalize; explicit notify remains idempotent
- Stop cancels the **current** agent turn only — not retained background jobs
- Eight-active-job cap, continuation depth, delivery-visible media/document
- ADR-158 Redis/memory turn stream bus for live web SSE catch-up
- Browser Script SDK pause / Document SDK NO-GO / managed secrets out

## Consequences

- Scheduler “claim any ready handle then hope for lease” becomes
  **ChatWakeCoordinator** eligibility → lock → head claim → lease+attempt →
  `markDispatched`.
- Multi-job completions while the user is mid-conversation become an ordered
  backlog of catch-up bubbles after idle pause, not a race.
- Web and Telegram share one serialization story; web no longer needs parked
  attempts to paper over busy.
- ADR-152 “whichever acquires first” and parked busy/reconcile prose are
  historical for wake dispatch.
- Slightly more coordinator logic in API; **no** new public chat API required
  for S1–S2; S3 may extend continuation prompt / Working projection only.

## Slices

| Slice  | Scope                                                                                                                                  | Deploy     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **S0** | This docs ADR + related doc pointers                                                                                                   | Docs only  |
| **S1** | Dispatch gate + per-chat serial claim (root race fix); delete parked-accepted path (`resetToAccepted` park, parked reclaim as product) | No         |
| **S2** | User priority + idle-pause debounce + FIFO catch-ups                                                                                   | No         |
| **S3** | Model/UI/Telegram markers (`wakeKind`, ordinal, interleaved, jobRef facts) — **pushed**                                                | No         |
| **S4** | Purge legacy/sticky leftovers + focused/regression tests — **pushed**                                                                  | No         |
| **S5** | One deploy + live acceptance (web + api + runtime + Telegram) — **in progress**                                                        | Yes — once |

Parent gates each slice. Implementation: `cursor-grok-4.5-high-fast`.

## Out of scope

- Media/document cancel trash UX
- Working pill UX polish
- Reopening ADR-151 / ADR-156
- Document SDK
- Managed secrets
- Redis subscribe-before-read long-poll as wake acceleration
- General-purpose Tool SDK / nested PersAI LLM / ScriptRun
- Replacing ADR-158 stream bus
- Sticky load-balancer affinity as primary wake fix

## Supersession

| Prior clause                                                                                                                                                         | ADR-159                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ADR-152: runtime session lease is sole gate; user turn and catch-up race (“whichever acquires first”); busy durably requeues / parked reconcile as wake architecture | ChatWakeCoordinator: user priority + exclusive per-chat catch-up lock + ready FIFO; never park `accepted` for busy      |
| ADR-152: conservative stale-claim/dispatched reconciler as primary serialization story                                                                               | Operational recovery only; session serialization is the coordinator                                                     |
| ADR-157 D4.1: auto-subscribe → scheduler wake (dispatch shape unspecified / parallel-capable)                                                                        | Auto-subscribe **intent** stays; **dispatch** is session-queue catch-ups only                                           |
| ADR-158: client sticky/absorb crutches as product wake reliability                                                                                                   | Stream bus stays; sticky/absorb **wake** crutches purged in S4; ADR-158 history absorb for null-user async-cont remains |
| Parked `accepted` + 30s parked reconcile + stuck-accepted absorb                                                                                                     | Deleted by S1/S4                                                                                                        |
| Global `claimReady` / dispatched `requeueBusyNotStarted` as wake product                                                                                             | Deleted by S4; chat-scoped head claim + `releaseClaimToReady`                                                           |

**Explicitly not superseded:** opaque `jobRef`; sync in-turn await same bubble;
Stop≠cancel background job; ADR-158 durable stream bus; soft-detach ≠ Stop;
eight-job cap; continuation depth; Telegram blocking deliver.

## Verification (program-level)

- Interleave: user message during ready backlog → user answered first → after
  idle pause, FIFO catch-ups with markers.
- Multi-job FIFO: two ready handles same chat → ordinal **1/2** then **2/2**
  (same N; durable stamps — not remaining-ready count), never parallel.
- Sync wait: in-turn `await.wait` still same bubble; no catch-up lock taken.
- Telegram busy: blocking path obeys same serial rules; no web zombie SSE.
- Invariant tests: `markDispatched` only after lease + (web) running attempt;
  busy never `resetToAccepted`.
- Web `duplicate_handled` on async-cont claim → `completeClaim` immediately
  (claimed|dispatched → completed); FIFO head must not stall for claim TTL.
- Runtime `outcome === "duplicate"` (acceptTurn in_flight elsewhere) must
  **release**, not bare-return: web abandons the pre-accept attempt +
  `releaseClaimToReady`; Telegram `releaseClaimToReady`. Same as pre-accept
  busy / `duplicate_inflight`. Do **not** `completeClaim` — the turn is still
  owned elsewhere. Distinct from attempt-claim `duplicate_handled`.
- S5 live: web + api + runtime + Telegram founder acceptance on one deploy.

### Residuals (documented, not P0)

- No local audit residual remains: Slices 1–3 and the final frozen
  integration/cleanup audit are CLEAN/GO. S5 is still pending its mandatory
  gate rerun, commit/push, migration approval, exact-image/GitOps rollout, and
  live multi-replica web + Telegram acceptance.

## Orchestration model

- Parent owns architecture, slice boundaries, audits, commits, deploy, live
  acceptance.
- Implementation subagents: **`cursor-grok-4.5-high-fast`** only for this
  program.
- No parallel implementation slices.
- S1 starts only after founder/parent accepts this S0 docs checkpoint.
- Closed ADRs remain closed; supersession is clause-scoped only.
