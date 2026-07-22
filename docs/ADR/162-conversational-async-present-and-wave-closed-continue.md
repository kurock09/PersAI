# ADR-162: Conversational async present and wave-closed continue

## Status

**Open 2026-07-22 — Phases 0–3 landed locally; Phase 4 audits/gates CLEAN;
awaiting founder push/deploy + Phase 5 live T1–T4.** Phase 0 docs IKR CLEAN.
Phase 1 ConversationalPublish CLEAN (pin-before-attach; path-identity partial
resume; no worker invent for owned deferred; empty-artifact fail-present).
Phase 2 wave-closed continue CLEAN (non-terminal siblings; server tool strip).
Phase 3 web bind CLEAN (publish `assistantMessageId`; no permanent dual local;
attachments preserved; missed-`completed` same-id recovery). Independent
parallel-logic audits CLEAN (zero P0/P1). Parent orchestrates/audits/commits.
Implementation subagents: **`cursor-grok-4.5-high-fast` only**.

Baseline at docs open: `d417b1af` (`origin/main`).

This ADR is the **orchestrator source of truth** for the async chat-present
repair. Do not re-derive scope from chat memory, SESSION-HANDOFF anecdotes, or
rejected local crutches. If code, handoff, and this ADR disagree — stop and
reconcile docs before code.

---

## ИКР (Ideal End Result)

User sits in chat (or walks away). Assistant has enqueued background jobs.
Jobs finish **staggered** (seconds–minutes apart). PersAI:

1. Never invents a chat bubble at artifact-ready time for ordinary deferred
   jobs.
2. After user-priority + idle-pause, presents **one job at a time, FIFO**,
   always as a **new assistant bubble at the bottom** of the live transcript.
3. Per job bubble: **attachment/file first**, then short narration in the
   **same** bubble (no second avatar for that job).
4. While the source wave still has **open (non-terminal) sibling jobs**, each
   present is **light ack only** — no heavy continue / shell marathon.
5. When the wave **closes** (every sibling terminal: completed / failed /
   cancelled), the catch-up that closes it may **continue** (shell, next
   plan steps, deeper work).
6. A hung sibling does **not** unlock early continue; it unlocks only via its
   own native terminal (platform/provider timeout → failed catch-up). No
   fake wake-up timer architecture.
7. F5 / history reload shows the same conversational append order — no
   teleport to mid-thread media, no client re-sort inventing a second timeline.
8. In-turn `await.wait` / `current_turn_inline` unchanged (same open reply
   bubble).

**One-sentence ИКР:** background work becomes chat only at FIFO present time,
bottom-append, one bubble per job; heavy continue only after the open sibling
wave is fully closed.

---

## Why current state is DIRTY (evidence, not guess)

| Fact                                                                                                                                                     | Where                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Ordinary async delivery creates `AssistantChatMessage` + attaches bytes as soon as the job is delivery-ready                                             | `WorkspaceMediaJobCompletionDeliveryService.ensureCompletionMessage` / `processClaimedCompletionPendingJob` |
| ADR-159 idle-pause / FIFO gate only agent `JOB_CATCHUP`, not chat visibility of those bytes                                                              | `ChatWakeCoordinator`, ADR-159 D2                                                                           |
| Catch-up narration often `UPDATE`s the early delivery row (`persistOutputOnce` → `completionAssistantMessageId`)                                         | `AssistantAsyncJobContinuationSchedulerService.persistOutputOnce`                                           |
| `createdAt` freezes at early create; later narration does not retouch stamp                                                                              | `PrismaAssistantChatRepository.createMessage` / `updateMessageContent`                                      |
| Web orders by `createdAt` and opens `local-assistant-${async-cont…}` without early bind to delivery id                                                   | `use-chat.ts`                                                                                               |
| Founder live: interleaved user reply then catch-ups; images/progress appear above live dialogue; multi-avatar fragmentation; F5 teleports to older media | 2026-07-22 founder reports                                                                                  |

Rejected local approaches (do **not** revive): invent “Ready.” text; banner
suppress; client absorb/dedupe as architecture; timed scroll-hold as product
fix; same-provider empty-stream retry as root UX fix; “continue on last
_already-ready_” (misses staggered job 3 after early continue on job 2).

---

## Product lock

### P1 — ConversationalPublish (chat visibility)

For **ordinary async / post-finalize** media & document jobs:

- Artifact durability + handle `ready` may happen anytime.
- The **only** writer that may create the user-visible assistant chat row and
  attach bytes for that job is **ConversationalPublish**, run under the same
  eligibility family as ADR-159 catch-up (no active USER_TURN; idle-pause
  elapsed; per-chat serial present).
- Sequence per job: **create bubble → attach file(s) → narrate into same id →
  complete claim → next FIFO head**.
- Chat position = first publish time of that bubble. Never job-ready time.
  Never “patch an older row and hope sort moves.”

### P2 — Wave-closed continue (Cursor-shaped)

Jobs from one source turn / catch-up wave usually complete **staggered**.
Ready backlog of N is uncommon; “assistant fired background work and waits”
(user may be away) is the common case.

| Condition                                     | Allowed agent behavior                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Open non-terminal siblings remain in the wave | Light present only: file + short ack in that job’s bubble. **No** heavy continue / new long shell campaign.       |
| Wave closed (all siblings terminal)           | Closing present may continue: shell, follow-on tools, plan progression.                                           |
| Sibling hung                                  | Wait for **native** job terminal (fail/timeout/cancel). Then present fail facts. No parallel fake wake-up poller. |
| User message arrives                          | USER_TURN wins (ADR-159). After idle-pause, resume present/FIFO.                                                  |

**Forbidden rule:** “continue when the ready queue looks empty right now.”
That fires continue after image 2 while image 3 is still running and loses the
thread.

### P3 — Multi-job UI

- One job → one bubble (artifacts + that job’s ack/narration).
- Multi-artifact **inside** one job (series/video) stays one bubble.
- Never sibling-pin many jobs onto the acknowledgement (“request accepted”)
  bubble.
- Never dual bubble for one job (file-only + later text-only) as product.

### P4 — Web transcript honesty

- On catch-up/`started`/`turn_status`, bind live stream to the
  **publish** `assistantMessageId` before first delta.
- Do not keep a permanent second `local-assistant-async-cont:*` slot beside
  the publish row.
- Preserve attachments when overlaying thought/stream text.
- History absorb reconciles ids; it is **not** a second ordering authority.

### P5 — Unchanged

- In-turn `await.wait` / `current_turn_inline` same-bubble (ADR-157 D4.1 sync).
- Stop ≠ cancel background job.
- Eight-active-job cap / depth rules.
- Opaque `jobRef`, Working nonterminal truth, ADR-158 stream bus.
- No ghostwriter / completion_framing as user-visible prose.
- Settle-after-delivered (quiet complete when bytes shown but narration fails)
  may remain once publish seam is correct — without inventing chat captions.

---

## Architecture seams

1. **CanonicalJobTerminal** — artifacts + await delivery-visible authority
   (ADR-157 D1 for **wait/tool truth**, not for chat invent).
2. **HandleQueue** — `assistant_async_job_handles` ready FIFO + wave ordinals
   (ADR-159).
3. **ChatWakeCoordinator** — USER_TURN > present/catch-up + idle-pause.
4. **ConversationalPublish** — sole chat-row create + attach for ordinary
   deferred jobs (this ADR).
5. **JobNarrationTurn** — `async-cont:*` model turn; light vs continue gated by
   **wave-closed**.
6. **WebTranscript** — append-only projection of publish stamps.

---

## Worked timelines (acceptance oracles)

### T1 — Staggered three images, user away

- t0: job1 ready → after eligibility: bottom bubble image1 + short ack; siblings
  open → no continue.
- t0+5s: job2 ready → image2 + ack; still no continue.
- t0+15s: job3 ready → image3 + ack → **wave closed → continue allowed**.

### T2 — User chats during backlog

- Jobs may be `ready` in handles while user talks.
- User turns append at bottom normally.
- No job bubbles appear during USER_TURN / idle-pause.
- After pause: presents append **below** that dialogue (new `createdAt` at
  publish), never above it.

### T3 — Hung third job

- job1, job2 present light.
- job3 hung → **no** continue after job2.
- job3 fails by native timeout → fail present → wave closed → continue if
  needed.

### T4 — F5 mid/after presents

- Reload lands at bottom of current transcript.
- Order matches publish order; no teleport to early media rows that were never
  the conversational bottom.

---

## Supersession / ADR amendments

| Prior clause                                                                            | This ADR                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-157 **D1** read as “bytes must appear in chat immediately”                          | Split: artifact/await readiness anytime; **chat ConversationalPublish** waits on idle-pause + FIFO present. Bytes still must not wait on _narration generation_ once publish has started (attach then narrate in one bubble). |
| ADR-157 **D4.1** “new wake bubble” vs handoff patch-into-`completionAssistantMessageId` | Wake/present = **new** bubble at append/publish time. “Same bubble” = artifacts + narration share that publish id — **not** reuse of an earlier delivery invent from mid-dialogue.                                            |
| ADR-159 idle-pause gates only runtime catch-up                                          | Same eligibility gates **ConversationalPublish** (chat visibility) as well as narration turn.                                                                                                                                 |
| Handoff 2026-07-22 “per-job bubble via early delivery + persistOutputOnce UPDATE”       | Historical wrong seam; superseded by publish-at-present.                                                                                                                                                                      |
| “Continue on last already-ready ordinal”                                                | **Rejected.** Continue on **wave-closed** only.                                                                                                                                                                               |

ADR-159 Telegram closure and ADR-161 cache work remain separate programs.
Do not reopen ADR-160 (discarded).

Phase 0 operative amendments landed in ADR-157 D1 and ADR-159 wave-closed /
D3 (2026-07-22); docs audit CLEAN. Do not reintroduce ASAP chat invent or
ready-queue-empty-as-wave-closed.

---

## Explicit NON-goals / rejected crutches

- Early `ensureCompletionMessage` as product visibility for ordinary async
- Patch narration into pre-interleave delivery rows (sticky `createdAt`)
- Client displayOrder / local re-sort / absorb-as-architecture
- Timed scroll-hold / teleport band-aids as the product fix
- Invented captions (“Ready.”, delivery stubs on the provider wire)
- Parallel wakes / parked `accepted` / global claimReady
- Sibling-pin onto acknowledgement
- Fake wake-up / hung-job poller beyond native job terminal paths
- Dual bubble per job
- Speculative “batch all ready jobs into one model turn” (out of scope unless
  founder later amends; FIFO one-present-at-a-time stays)

---

## Orchestrator protocol (do not lose the thread)

### Before every session that touches this program

1. Read this ADR end-to-end (ИКР + P1–P5 + timelines + NON-goals).
2. Read `docs/SESSION-HANDOFF.md` top entry for ADR-162 checkpoint.
3. `git status` must be clean (or only unrelated founder-approved WIP, kept in
   separate commits). Record HEAD SHA in the handoff when repo truth changes.
4. Restate to the user: phase, purpose, files, out of scope.
5. **No guesses.** If a seam is unclear — stop, audit code/ADR, then amend
   this file before coding.

### Task discipline

- One phase at a time. No “while we’re here” scroll/absorb/retry patches.
- Parent: plan → delegate → audit → commit (only when founder asks to commit).
- Implementation subs: only `cursor-grok-4.5-high-fast`; narrow prompt; cite
  this ADR section ids (P1/P2/…).
- After each phase: independent audit must return **CLEAN** (zero P0/P1 on
  this ADR’s invariants) before the next phase starts.
- Live smoke only after the phase that claims the behavior; use T1–T4 as
  oracles — not “looks fine.”

### Phase checklist (copy into handoff when starting)

| Phase                    | Deliverable                                                                                             | Exit gate                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **0 Docs**               | This ADR + operative ADR-157 D1 / ADR-159 wave-closed + handoff/AGENTS/CHANGELOG/cursor-rule            | **DONE 2026-07-22** — independent docs audit CLEAN                                                             |
| **1 Publish seam**       | Stop ordinary-async chat invent at delivery; ConversationalPublish create→attach under wake eligibility | **LANDED locally 2026-07-22** — independent re-audit still the parent gate before treating P1 closed           |
| **2 Wave continue gate** | Light vs continue from open-sibling / wave-closed facts; model instructions match                       | **LANDED locally 2026-07-22** — facts + server-side tool strip; focused tests green; independent audit pending |
| **3 Web bind**           | Early `assistantMessageId` bind; no permanent dual local bubble; attachments preserved                  | **LANDED locally 2026-07-22** — client bind + attachment-preserving overlay; focused web tests; independent audit pending |
| **4 Gates**              | lint/format/typecheck/focused+full tests as required                                                    | Green                                                                                                          |
| **5 Live**               | T1–T4 on deployed exact images; Telegram note if in scope                                               | Founder accept; then close or list residuals                                                                   |

### CLEAN definition (program)

- T1–T4 pass on live or equivalent deterministic integration coverage.
- No early ordinary-async chat rows before ConversationalPublish.
- No continue while open siblings remain.
- No dual avatar for one job in the happy path.
- No dependence on client absorb/scroll timers for correctness.
- ADR-157/159 text no longer contradict P1/P2.
- Independent allowed-model audit CLEAN on the phase diff.

### Anti-patterns for the orchestrator

- “Quick UI glue” while publish seam is still early-create.
- Fixing F5 teleport without fixing publish-time `createdAt`.
- Allowing continue-on-ready-empty.
- Mixing ADR-161 cache commits with this program’s commits.
- Reopening closed ADR-151/156/148/… for this work.

---

## Implementation notes (for later phases — not authority yet)

Likely touch points (informative; phase designs may refine after audit):

- `workspace-media-job-completion-delivery.service.ts` —
  defer chat invent for ordinary async.
- `assistant-async-job-continuation-scheduler.service.ts` /
  `stream-web-async-continuation.service.ts` — present pipeline +
  `persistOutputOnce` only on publish id created in-present.
- `assistant-async-job-handle-state.service.ts` — wave-closed / open-sibling
  facts for light vs continue.
- Runtime `JOB_CATCHUP` projection — instructions must match wave-closed.
- `web-chat-turn-attempt.service.ts` / SSE `started` — early
  `assistantMessageId`.
- `use-chat.ts` — bind live slot to publish id.

Exact SQL/API shapes are chosen in Phase 1 design audit — not guessed here.

---

## Phase 1 implementation notes (2026-07-22)

Landed seams:

- `ConversationalPublishService` — sole create+attach for ordinary deferred
  media/document at catch-up present (after `admitCatchUpAtBoundary`, before
  runtime stream/execute).
- `AssistantMediaJobCompletionDeliveryService` /
  `AssistantDocumentJobDeliveryService` — owned-handle non-inline jobs settle
  quota/finalize/`recordCanonicalCompletion` with
  `completionAssistantMessageId` left null; no chat invent / no
  `mediaDelivery.deliver`. Await `current_turn_inline` and missing-handle
  legacy keep early invent+attach.
- `persistOutputOnce` — UPDATE publish id only for media/document; fail closed
  if publish id missing (no second bubble).
- Web: `WebChatTurnAttemptService.bindAssistantMessageId` + SSE `started`
  carries `assistantMessageId`.

## Phase 2 implementation notes (2026-07-22)

Landed seams:

- `AssistantAsyncJobContinuationSchedulerService.resolveWaveClosedState` —
  counts non-terminal sibling handles by `sourceUserMessageId` (fallback
  `catchUpWaveId`), excluding the current handle; stamps
  `waveClosed` / `openSiblingCount` on JOB_CATCHUP facts.
- Runtime `isJobCatchUpLightPresentOnly` — fail-closed unless
  `facts.waveClosed === true`.
- `createAsyncContinuation` / `streamAsyncContinuation` —
  `allowModelToolExposure: false` while open; tool loops start with
  `forceFinalTextOnly` so tools stay empty / `toolChoice: none`.
- `projectAsyncContinuationTerminalEvent` + async_completion developer
  section — wave-open light-ack vs wave-closed continue; no
  “continue whenever” wording while open.

## Phase 3 implementation notes (2026-07-22)

Landed seams (web):

- `assistant-api-client` parses optional `assistantMessageId` on SSE `started`.
- `applyTurnStatusState` / reattach `onStarted` bind `liveAssistantMessageId` to
  the ConversationalPublish id for `async-cont:*` and drop the permanent
  `local-assistant-async-cont:*` dual slot when that id is known.
- Thinking/stream overlays preserve attachments already on the publish row
  (no `attachments: undefined` wipe for bound async-cont).
- `committedHistoryHasActiveTurnResult` /
  `committedHistoryHasActiveSnapshotResult` / async-cont
  `shouldReplaceActiveTurn` no longer treat publish-id presence in history as
  terminal completion (early bind is live overlay state).
- Ordinary user-turn optimistic `local-assistant-*` behavior unchanged.

## Next step

**Phase 3 web bind landed locally.** Next: independent allowed-model Phase 2
and Phase 3 audits CLEAN (and Phase 1 re-audit if still open). Then Phase 4
gates / Phase 5 live T1–T4. Keep ADR-161 commits separate. No push/deploy in
this slice.
