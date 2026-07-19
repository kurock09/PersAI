# ADR-159: Session Work Queue and Async Catch-up

## Status

**Open 2026-07-19 — S4 CLEAN + runtime-duplicate release P0 repaired locally
(not committed).** S0–S4 landed; parent S3 audit was CLEAN; S4 re-audit DIRTY
repaired: durable catch-up ordinals, sequential 1/2→2/2 markers,
`duplicate_handled` frees FIFO head immediately, TG ambiguous
`markDispatched` documented as P2 reconcile exception. Follow-up P0: runtime
`outcome === "duplicate"` must `releaseClaimToReady` (web also abandons
pre-accept attempt) — never bare-return with claim held; still distinct from
`duplicate_handled` → `completeClaim`. S5 (deploy + live) remains. Baseline
`b41adb6a`.

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
developer section treats structured facts as the product signal (synthetic
`[internal async completion]` strip retained, not sole cue). **S4** purges
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

| Work kind | Origin | Priority |
|---|---|---|
| `USER_TURN` | Ordinary user message (web POST / Telegram inbound) | **Higher** |
| `JOB_CATCHUP` | Subscribed handle → ready → scheduled continuation | Lower |

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
2. **Idle-pause debounce.** After a user turn becomes terminal (completed /
   interrupted / failed), wait a short bounded idle pause (implementation
   constant; order of ~1–3s, tunable once) before the coordinator may start
   the next catch-up. Purpose: let the user send a follow-up without racing a
   докат. Not a parked-accepted reconciler.
3. **FIFO catch-ups.** Among handles for that chat in `ready` (source
   finalized, subscribed, entitlement OK), dispatch oldest `readyAt` first.
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

#### Schema sketch (additive, minimal)

No new queue table. Prefer one of (S1 picks exact shape; both are ADR-legal):

**Option A (preferred):** reuse `SchedulerLease` with a deterministic key
`async-catchup:{chatId}` (or equivalent) as the exclusive catch-up lock.
Handle row CAS remains authority for `ready → claimed → dispatched`.

**Option B:** additive nullable columns on `assistant_chats` (or a tiny
`assistant_chat_wake_locks` row keyed by `chatId`):

| Column | Role |
|---|---|
| `catchUpLockToken` | opaque owner token |
| `catchUpLockExpiresAt` | lease TTL |
| `catchUpHandleId` | optional pointer to active claimed/dispatched handle |

Either way: lock TTL must be shorter than “forever park” and must release on
terminal / fail-closed paths. Do not introduce a 30s parked-accepted
reconciler as the wake architecture.

Durable catch-up ordinal columns (stamped at ready-promotion; S4 CLEAN):

| Field | Role |
|---|---|
| `catchUpOrdinal` | 1-based FIFO ordinal in the open catch-up wave |
| `catchUpWaveTotal` | stable N for the wave (bumped as siblings join) |
| `catchUpWaveId` | shared id while any ready/claimed/dispatched sibling remains |

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

| Crutch | Fate (S4) |
|---|---|
| `resetToAccepted` park on async-cont busy | **Deleted** as product path (S1) |
| Parked reclaim / ~30s parked reconcile | **Deleted** as architecture (S1/S4) |
| Global `claimReady` / `requeueBusyNotStarted` | **Deleted** (S4); production uses `claimReadyHeadForChat` + `releaseClaimToReady` |
| `legacyChosen` finalize alias | **Deleted** (S4); return `autoSubscribed` only |
| Client stuck-accepted absorb as product | **Absent on main** (S4 verified); ADR-158 history absorb for null-user async-cont completion remains |
| Sticky LB / pod affinity as wake fix | Remains non-goal; ADR-158 bus is the stream plane |
| Fake-user-only cue for catch-up | **Deleted**; `wakeKind` markers (S3) |
| Historical `narrationOwner=legacy` enum + one-shot heal | **Residual (documented):** live finalize never stamps `legacy`; subscribe/completion still heal historical rows → continuation. No enum data migration in this program. |
| `legacy_frame` / `skip_legacy_frame` delivery decision names | **Retained** (wide delivery blast; not a wake crutch) |

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

| Slice | Scope | Deploy |
|---|---|---|
| **S0** | This docs ADR + related doc pointers | Docs only |
| **S1** | Dispatch gate + per-chat serial claim (root race fix); delete parked-accepted path (`resetToAccepted` park, parked reclaim as product) | No |
| **S2** | User priority + idle-pause debounce + FIFO catch-ups | No |
| **S3** | Model/UI/Telegram markers (`wakeKind`, ordinal, interleaved, jobRef facts) — **landed locally** | No |
| **S4** | Purge legacy/sticky leftovers + focused/regression tests — **landed locally** | No |
| **S5** | One deploy + live acceptance (web + api + runtime + Telegram) | Yes — once |

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

| Prior clause | ADR-159 |
|---|---|
| ADR-152: runtime session lease is sole gate; user turn and catch-up race (“whichever acquires first”); busy durably requeues / parked reconcile as wake architecture | ChatWakeCoordinator: user priority + exclusive per-chat catch-up lock + ready FIFO; never park `accepted` for busy |
| ADR-152: conservative stale-claim/dispatched reconciler as primary serialization story | Operational recovery only; session serialization is the coordinator |
| ADR-157 D4.1: auto-subscribe → scheduler wake (dispatch shape unspecified / parallel-capable) | Auto-subscribe **intent** stays; **dispatch** is session-queue catch-ups only |
| ADR-158: client sticky/absorb crutches as product wake reliability | Stream bus stays; sticky/absorb **wake** crutches purged in S4; ADR-158 history absorb for null-user async-cont remains |
| Parked `accepted` + 30s parked reconcile + stuck-accepted absorb | Deleted by S1/S4 |
| Global `claimReady` / dispatched `requeueBusyNotStarted` as wake product | Deleted by S4; chat-scoped head claim + `releaseClaimToReady` |

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

- **Telegram ambiguous dispatch (P2):** blocking `execute` path may
  `markDispatched` on `AsyncContinuationDispatchAmbiguousError` so operational
  reconcile can finish an accepted-but-transport-failed turn. Not a product
  wake timer; web stream path uses post-accept `leaveDispatchedAmbiguous`.
  Moving TG `markDispatched` closer to accept remains optional follow-up.

## Orchestration model

- Parent owns architecture, slice boundaries, audits, commits, deploy, live
  acceptance.
- Implementation subagents: **`cursor-grok-4.5-high-fast`** only for this
  program.
- No parallel implementation slices.
- S1 starts only after founder/parent accepts this S0 docs checkpoint.
- Closed ADRs remain closed; supersession is clause-scoped only.
