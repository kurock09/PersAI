# ADR-152: Browser Script SDK and Durable Job Wait/Notify

## Status

**2026-07-18 founder final semantics — local implementation in progress
(`Давай делай чисто и честно`):** this decision supersedes the
media/document-only F0 draft and the prior assumption that Process timeout is a
warm shell kill deadline. Exact-owned warm-session shell/exec `SandboxJob` is
the third narrow async adapter. Model-facing shell/exec always launches through
a durable pod-side supervisor: short completion is returned synchronously; at
the plan Process-timeout threshold the runtime returns only an opaque
`jr1.sandbox.*` and the canonical row is `detached`. Detached work releases the
workspace lease, survives sandbox control-plane restart while the pod survives,
and is not cancelled by turn Stop or await timeout. Natural exit, explicit
later process control, or idle-TTL pod deletion ends it. CPU budget, pod
resources/egress, and sessionless hard-timeout/retirement semantics are
unchanged.

Universal await is
`await({action:"wait"|"notify",jobRef?:string,timeoutMs?:number})`: wait may
omit `jobRef` for a complete bounded current-turn/open-chat snapshot; notify
requires it; timeout is wait-only `0..60000`; and 20 replay-deduped waits are
admitted per dispatched turn. Canonical adapters are media, document, and
sandbox. Registration is trusted and exact-owned through runtime session and
source turn. Notify remains non-terminal and durable; terminal-before-subscribe
is inline; sourceFinalizedAt and same-chat lease gate exactly-once continuation.

One chat-row lock now defines the target eight-active-background-job cap across
all three adapters. UI truth is one Working popover, per-job notify badge,
decreasing absolute-deadline inline wait status, and deterministic post-loop
subscribed status. No browser-enabled Script detachment is claimed. Exact
detached produced-file attribution is intentionally empty in this checkpoint:
concurrent retained processes make attribution unsafe without a broader
filesystem journal, and another job's files must never be assigned.

Local implementation and verification are still underway. Do not call this
CLEAN, committed, pushed, deployed, or founder-accepted.

**2026-07-18 founder UX revision (documentation-only; F0 audit pending):**
CP1–CP5 remain landed/deployed history, including the deployed `6224af52`
evidence for `await.wait`, durable `await.notify` subscription through an API
rolling restart, and exactly-once attachment-first delivery. The continuation
then failed with `continuation_context_invalid`; the narrow, uncommitted
native-web repair remains valid: intrinsic `web_internal`/`web_chat` needs no
synthetic `assistant_channel_surface_bindings` row, while Telegram still
requires an active binding. It must be carried into F1.

Founder rejected the current required-`jobRef`, one-wait-per-job,
terminal-`notify`, and late-banner UX as not Cursor-like. Browser SDK
acceptance is paused, not rejected. The decision below supersedes only the
previous `await`/continuation behavior and follow-through sequence; it
preserves CP1–CP5 history and does not reopen ADR-151 or ADR-156. F0 is
documentation revision only and is **not CLEAN** until an independent audit.

**2026-07-18 live-found repair (local; independent audit pending):** deployed
`6224af52` demonstrated `await.wait` PASS, durable `await.notify` subscription
across a full API rolling restart, and exact-once attachment-first delivery.
The continuation scheduler then failed the handle with
`continuation_context_invalid`, so no continuation Assistant message was
persisted. Read-only production diagnosis confirmed every existing
chat/assistant/workspace/user/surface/thread, published-version, canonical
delivery, source-message, runtime-session, and entitlement invariant; the sole
rejected fact was the intentionally absent
`assistant_channel_surface_bindings` row for intrinsic native
`web_internal`/`web_chat`. The local repair limits persisted active-binding
validation to Telegram. Native web continues to use its existing exact
ownership/session/canonical checks plus authoritative capability/quota
enforcement. Focused real-path regressions cover native web without a binding,
missing/inactive/active Telegram bindings, and foreign chat/session/canonical
fail-closed checks. This repair is not CLEAN, committed, deployed, or
live-accepted; ADR-152 remains open.

**Approved architecture checkpoint, open for staged implementation.** Checkpoint
1 (opaque media/document handles, owned canonical resolver, and bounded
`await.wait`) is implemented and independently audited CLEAN; it is not
deployed or live-accepted. Checkpoint 2 is implemented and, after repair
rounds, independently re-audited **CLEAN with no P0/P1/P2 findings**
(committed as `252f3460`). Same-row narration/continuation state,
canonical-under-lock observe/subscribe operations, delivery arbitration,
`await wait|notify` terminal control, source-turn finalization, and a same-chat
continuation runtime entry seam are implemented. API persistence proves
current-turn narration, and the SchedulerLease-backed worker performs validated,
idempotent dispatch/persistence/delivery plus conservative stale reconciliation.
Canonical persisted Assistant output is idempotent. Telegram and non-idempotent
artifact delivery attempts are separately durable at-most-once: an attempt is
CAS-owned before the external call and an ambiguous response is recorded but
not retried automatically, trading possible ambiguous loss for duplicate-send
prevention. Parent verification reran the complete API suite (exit `0`, about
431 seconds), complete runtime isolated suite (exit `0`), API/runtime
typecheck+lint, Prisma format/validate/generate, and root format/diff checks.
The clean disposable pgvector proof had already applied all 192 migrations and
passed trigger/CAS/depth checks. Checkpoint 3, the Browser Script SDK and
ephemeral broker, is implemented. A first independent Sonnet audit returned
**DIRTY (3 P1, 4 P2, no P0)**; all code findings were repaired. A
founder-directed independent re-audit on Cursor Grok 4.5 found all prior code
P1/P2 closed and one residual ARCHITECTURE docs contradiction (P2), which was
corrected before commit. Authored-output persistence remains a founder-owned
wording residual only. Checkpoint 3 is not deployed or live-accepted.
Checkpoint 4 Admin/MCP manifest authoring is implemented. A first independent
Cursor Grok audit returned **DIRTY (3 P2 docs only, no P0/P1)** with authoring
code PASS; docs repairs landed and the final status re-check returned
**CLEAN**. Checkpoint 4 is not deployed or live-accepted. Checkpoint 5 began
with DIRTY Terra/Sonnet audits covering rollout/rollback enforcement, missing
Helm mismatch and live route-binding proof, a type-invalid OS-FD test,
formatting drift, ordinary-Script env compatibility, and a duplicated depth
literal. All findings were repaired. Final frozen-tree independent GPT Terra
and Sonnet re-audits returned **CLEAN with no P0/P1/P2 findings**, and the
parent full repository gate passed lint, format, typecheck, tests, build,
Prisma validation/generation, deterministic contracts, Helm deploy truth,
rollout/affected-CI tests, and diff integrity. Checkpoint 5 is committed at
`e47964ed` (baseline `439b89f2`); no push, deploy, or live acceptance has
occurred. ADR-152 remains open only for one founder-authorized push,
exact-image deploy, and founder live acceptance.

## Decision

ADR-152 adds exactly two bounded capabilities:

1. a narrow Script browser SDK for profile-backed `snapshot` and `act` through
   the existing local-browser bridge; and
2. one universal model-visible `await` tool for canonical long-running jobs.

It creates no general-purpose PersAI SDK. A Document SDK is explicitly NO-GO
and omitted. Managed Script credentials remain ADR-153 scope.

Closed ADR-140, ADR-142, ADR-149, ADR-151, and ADR-156 remain authoritative and
are not reopened.

## `await` tool

The model-facing tool name is `await`:

The exact schema is
`await({ action: "wait" | "notify", jobRef?: string, timeoutMs?: number })`
with `additionalProperties: false` and required `action`. `jobRef` is optional
only for `wait`; runtime validation still requires it for `notify`. `timeoutMs`
is valid only for `wait`, with an inclusive `0..60000` range. There is no
`notify-all` action.

`wait(jobRef)` observes one exact owned job. `wait()` observes one complete,
stable-ordered bounded snapshot: all exact-owned handles created by the current
server-derived logical turn (terminal included), plus exact-owned currently-open
canonical media/document/sandbox jobs in the current chat/channel/thread. Exact
ownership includes assistant, workspace, user, chat, channel, and thread;
older terminal jobs not created by the current turn are excluded. No relevant
job returns an immediate empty snapshot. A snapshot has at most 32 rows;
overflow is the typed, fail-closed `snapshot_overflow` result, never silent
truncation or disclosure.

Local follow-through truth (not the aspirational Redis long-poll design):
internal `POST …/async-jobs/v1/{status,snapshot,subscribe}` perform immediate
owned DB reads; runtime client-polls ~500ms while waiting. A Redis
subscribe-before-read long-poll wake path is **not landed**. Durable
canonical/handle rows remain authority. Additive migration
`20260718150000_adr152_sandbox_async_job_handles` adds handle kind `sandbox`,
SandboxJob status `detached`, and `runtime_session_id`.

Actual attachment/delivery visibility wins over lagging worker/job state:
already visible or delivered media/documents are terminal immediately. This
closes the delivery-before-job/handle-finalization window without requiring a
risky giant atomic transaction. A completion/delivery transaction, or its
immediately-following handle CAS, marks subscribed handles ready. Local truth
today: no Redis subscribe-before-read long-poll; runtime polls immediate DB
seams and the API ~3s scheduler poll is the recovery path. (Post-commit Redis
wake/kick + immediate scheduler tick remains aspirational, not landed.)
Reconciliation promotes subscribed handles whose canonical observable truth is
terminal/visible but whose handle is not ready.

Each dispatched logical runtime turn has a 20-call admitted wait budget across
all jobs and provider loops; an original turn and each continuation have their
own budget. Timeout zero counts. The unique provider tool-call id makes
transport replay free; invalid/pre-admission failures do not count. Call 21
returns typed `wait_budget_exhausted` plus `notify` guidance. The former
one-wait-per-job Set is removed.

Every wait returns the complete snapshot and one deterministic trigger, or
`null` on timeout/status: order changed candidates by canonical observable
transition time, then handle id. A snapshot may therefore reflect multiple
changes in one read. Current-turn terminal rows represented in that snapshot
are CAS-owned by `current_turn` as needed, preserving one narrator and
attachment-first delivery.

`notify(jobRef)` CAS-subscribes a pending exact-owned job durably, reserves
continuation narration, and returns a non-terminal
`turnControl: "continue"` receipt. The model may continue independent work or
naturally finish. Terminal-before-subscribe returns inline and creates no
subscription; duplicates return existing state. UI observation remains visible.
Stop aborts only the current wait/turn, never the job or subscription.

The continuation chain remains bounded at depth four. The source-turn gate is
now critical: because notify is non-terminal, the scheduler may claim a ready
continuation only after `sourceFinalizedAt IS NOT NULL`, and defensively
revalidates immediately before dispatch. A terminal job before source
finalization can be ready but cannot dispatch. Source finalization/lease
release kicks the scheduler. The existing same-chat runtime session lease
serializes continuations and ordinary user turns bidirectionally: whichever
acquires first runs; busy-before-runtime-acceptance requeues unchanged without
retry-budget consumption. Later ordinary user turns do not cancel or suppress
notify; a continuation hydrates all committed messages before lease acquisition
and resumes afterward. Only a future explicit cancellation may supersede.

Permanent continuation validation/retry failure must persist/project exactly one
honest failure observation through existing CAS/delivery machinery: visible in
web and a channel notice in Telegram. Attachment delivery remains unaffected.

## Observation streaming UX

Immediately after canonical enqueue returns `jobRef`, runtime emits a dedicated
`async_job_accepted` stream event before the provider loop closes; API relays it
through SSE. The durable/reconnect authority is the chat active-observation
projection derived from existing handle/canonical rows.

Runtime emits await activity start/end events with one absolute `startedAt`
timestamp, not per-second ticks. Existing 50ms tool-progress draining may relay
start while wait blocks. Web locally renders `Waiting · Ns` / `Ожидаю · N сек`;
reattach/status returns the same `startedAt`, and Stop/resolve clears it.
Durable notify observation projects `subscribed | ready | claimed | dispatched`
across normal turn completion, reload, and reconnect. Telegram has no live
seconds UI but retains durable notify and failure semantics.

## Durable handle and ownership model

ADR-152 adds one additive table, exactly named
`assistant_async_job_handles`. It is both the canonical-job mapping and
continuation state; no second subscription or claim table is introduced.

Each row has a server-minted opaque handle:
`jr1.<kind>.<192-bit-random-base64url>`. It is stored directly on the row:
there is no AEAD/keyring design. The row records canonical kind/id; assistant,
workspace, user, chat, channel, thread, and source-turn ownership; state
`none | subscribed | ready | claimed | dispatched | completed | failed |
cancelled`; terminal snapshot; narration owner/decision; claim token, TTL, and
retry data; and deterministic continuation `clientTurnId`. `jobRef` is unique,
as is `(kind, canonicalJobId)`.

Every resolver rechecks the canonical job row and all ownership constraints.
Foreign, malformed, and tampered handles are indistinguishable from not found.

Current adapters (founder-superseding local follow-through):

- `assistant_media_jobs`;
- `assistant_document_render_jobs`;
- warm-session `SandboxJob` shell/exec (`kind: sandbox`, including `detached`).

For media/document, only `delivered` is terminal success; `completion_pending`
and `ready_for_delivery` remain pending. For sandbox, terminal success/failure
is completed/failed/cancelled (detached is open until observe finalizes). The
adapter contract remains extensible, but `assistant_background_task_runs` still
lacks an immutable exposed run identity and stays deferred; a recurring
`assistant_background_tasks` row never qualifies as a `jobRef`. Indexing,
safety, and rollout-handle adapters remain excluded.

## Delivery and continuation ownership

Jobs receive their handle on enqueue. Source-turn post-processing records
whether the model chose `notify`.

For a subscribed job, existing attachment-first delivery remains the sole file
delivery owner, but its isolated `maybeFrame` completion model call is skipped.
The new full continuation is the sole model narrator. Unsubscribed jobs retain
their current completion-framing bytes and behavior. Source-turn finalization,
compare-and-set transitions, and reconciliation close the completion-versus-
subscribe race; no path produces double framing or double delivery.

The notify scheduler reuses `SchedulerLease` and same-row CAS claim fields.
The runtime session lease is the sole no-parallel gate. Busy sessions or user
turns durably requeue. Existing `RuntimeTurnReceipt` provides deterministic
idempotency. A conservative stale-claim/dispatched reconciler requeues only
when there is no live receipt or session lease.

Before dispatch, the scheduler revalidates Assistant, workspace, user,
plan/subscription entitlement, active chat, and channel binding. It dispatches
only to the original chat; archived, deleted, or foreign targets fail closed.
Passive SSE disconnect remains a soft detach. The continuation receives
volatile structured completion facts (including sandbox `sandboxResult` when
present), persists only assistant output, and does not manufacture a persisted
user message or re-deliver files.

### Addendum — resumable web continuation (same chat)

Founder-approved follow-through: web notify wake must use the **same resumable
turn machinery** as ordinary web chat turns (ADR-149 soft-detach / reattach /
`AssistantWebChatTurnAttempt` / `WebChatTurnStreamRegistry`). It is not a new
stream protocol and not a third chat.

Rules:

1. **Same chat only.** Dispatch remains bound to the original `chatId` /
   `threadKey`. D4.1 still opens a **new** assistant bubble (user may have
   interleaved ordinary messages).
2. **`continuationClientTurnId` is the web `clientTurnId`.** Before runtime
   stream starts, API creates/claims an `AssistantWebChatTurnAttempt` with that
   id, `markRunning` with the chat and **null** `userMessageId` (no new user
   message row; avoids history-merge “already committed” heuristics keyed off
   the source user), and registers the in-process stream registry + Stop
   dispatch. Stop/abort finalizes interrupt; true post-accept ambiguity leaves
   the handle dispatched for reconcile.
3. **Runtime streams the continuation** (same event vocabulary as
   `streamTurn`: delta / tool / tool_progress / completed / failed /
   interrupted). Blocking JSON `createAsyncContinuation` remains for Telegram
   and as a non-web fallback; web prefers the stream path.
4. **Client reattach.** Working job projection exposes
   `continuationClientTurnId` while notify is
   `subscribed|ready|claimed|dispatched`. Web reattaches via existing
   `GET …/turns/:clientTurnId/stream` — same as soft-detach resume. Async-cont
   turns keep `liveUserMessageId` unbound so history poll cannot kill the live
   bubble. History poll remains a safety net, not the primary live path.
5. **Ordinary chat must not regress.** User-initiated POST stream turns keep
   their existing prepare/claim/stream path unchanged. Session lease still
   serializes user turns and continuations. Stop on a continuation
   `clientTurnId` uses the same Stop endpoint.
6. **Durable persist stays authoritative.** Scheduler CAS +
   `persistOutputOnce` / attempt terminal write remain the reconnect truth if
   the live registry is gone (other replica) or the client was offline.

Out of scope for this addendum: auto-subscribe of every `background:true`,
patching an old bubble, Telegram live seconds UI, new tables.

After continuation output is durably persisted, the scheduler finalizes only
child handles whose `sourceClientTurnId` equals that continuation's
deterministic client-turn id. Persisted output assigns unresolved children to
legacy while preserving children already owned by `notify` or the current turn.
Failed or interrupted continuation receipts finalize those children
failed/stopped. Lost-finalization repair identifies continuation output by
`asyncContinuationClientTurnId`; ordinary source turns continue using
`sourceUserMessageId`.

## Browser Script SDK

The exact manifest capability is:

```json
{ "browser": { "actions": ["snapshot", "act"] } }
```

Absent capability denies browser access. A profile is required and supplied as
structured Script input. The SDK exposes no `list`, `login`, `open_live`, or
`request_user_action`; profile selection, login, and handoff remain
model-owned. There is no headless fallback: Script browser work is only the
profile-backed local bridge.

Every request passes through the existing `RuntimeBrowserToolService` using the
original turn channel, exact device affinity, observer lock, abort semantics,
policy/quota checks, progress, and telemetry. Local bridge use remains
unbilled; existing headless Browserless flows do not change. Unavailable or
foreign profiles and Telegram retain existing fail-closed / `open_in_app`
semantics. Script input never receives a bridge token, device id, internal
bearer, or bridge URL.

The transport is a narrow ephemeral broker, not a second browser runtime. It
extends live-exec stdin/stdout framing. `apps/sandbox` and runtime coordinate
job-scoped TTL Redis messages following ADR-140’s cross-replica pattern; Redis
is new to `apps/sandbox`. Only one browser request may be outstanding per job.
The broker transport does not automatically persist or log browser request or
response payloads in Postgres, `SandboxJob`, GCS, or application logs. A Script
can intentionally include useful SDK-derived data in its authored output, and
that ordinary Script output is persisted in `SandboxJob` under the existing
output contract. Preventing a Script from copying SDK results would require
content inspection/redaction, is not implemented, and remains a founder/audit
wording residual if “never enter SandboxJob” was intended to prohibit explicit
authored output. Small platform Node/Python wrappers and a CLI live in the existing sandbox image:
there is no new image contour, pod, or NetworkPolicy. Broker loss/restart fails
the active Script closed; arbitrary-code execution never durably resumes.

Checkpoint-3 implementation reserves Kubernetes exec stdin and a bounded
stdout frame prefix only for capability-authorized Scripts. The Script wrapper
duplicates those streams to inherited FDs 4/3, keeps entry stdout/stderr on the
existing diagnostics path, and emits the ordinary final result marker after
entry exit. Runtime registers an unguessable TTL broker before sandbox submit;
the sandbox relays strict request/response envelopes through Redis and strips
broker/job/auth routing fields before returning a response to Script. The
runtime consumer invokes only `RuntimeBrowserToolService` with the original
turn context. Ordinary Scripts keep the existing buffered `runInPod` path and
do not connect to broker Redis.

## Document SDK NO-GO

Document SDK support is omitted. `document.inspect` is API-process work;
`document.render` and `document.convert` submit nested
`execute_document_code` `SandboxJob`s while an outer Script holds the same
workspace queue/lease. That produces guaranteed **bounded self-contention
timeout**, not an unbounded deadlock. Factoring engines or produced-file
registration would create a new contour and is rejected. The model continues
to orchestrate `document.inspect`, `document.render`, and `document.convert`
sequentially before or after a Script.

## Non-goals

- a general-purpose SDK, typed general Tools, or durable restart of arbitrary
  Script execution;
- `ScriptRun`, nested PersAI/model calls, workflow engine, browser executor
  outside the narrow SDK, async Script jobs, `jobRef` polling aliases, or a
  Script-specific sandbox contour;
- headless fallback for profile-backed Script browser work;
- secret broker, redaction, TTL, revoke, or logging guarantees (ADR-153);
- indexing/safety/rollout handle adapters (sandbox shell/exec is in scope).

## Follow-through checkpoints

These bounded checkpoints do not authorize an intermediate deploy.

- **F0 — architecture revision and independent docs audit.** This
  documentation-only checkpoint records the failed founder UX acceptance and
  this superseding await decision. It is pending an independent CLEAN audit.
- **F1 — correctness foundation.** Preserve the native-web/Telegram binding
  repair; add the `sourceFinalizedAt` dispatch gate, delivery-visible canonical
  observable truth, subscribed-terminal reconciliation, exactly-once visible
  permanent-failure fallback, and focused tests.
- **F2 — API/runtime await v2.** Implement no-id snapshot and exact-id wait,
  race-free long-poll with Redis hints, the 20-call budget, and non-terminal
  notify, with contract and mixed-version tests.
- **F3 — event-first continuation and serialization.** Add completion/source-
  finalization kicks, immediate scheduler tick, bidirectional lease/busy
  behavior, and duplicate/missed-wake tests.
- **F4 — web/runtime streaming UX.** Add immediate accepted banner, durable
  active observations, absolute-time wait activity, reconnect/reload/Stop
  coverage, and English/Russian strings.
- **F5 — final acceptance.** Run independent audits and the full gate, then one
  push, deploy, exact-image/database/Redis-recovery/founder live acceptance.
  Resume paused Browser SDK acceptance only after the await/job UX passes; close
  ADR-152 only if both it and browser acceptance pass.

The v2 application protocol retains the fail-closed capability barrier. Safe
rollout is additive migration
`20260718150000_adr152_sandbox_async_job_handles` → API → runtime → sandbox →
web; rollback reverses application order. This follow-through is local and
**not CLEAN/deployed**; ADR-152 is not reduced to “push/deploy only.”

Independent allowed-model audits are required for F0, the await/job
follow-through, paused browser acceptance, and final integration. The parent
agent audits and commits only; product implementation is delegated only to
`gpt-5.6-terra-medium` or `claude-sonnet-5-thinking-high`.

## Rollback

Rollback is additive: stop projecting `await` and stop its scheduler while
preserving existing canonical jobs and handles. Existing file delivery remains
intact, and unsubscribed legacy framing remains unchanged. No destructive
rollback migration, compatibility alias, or TODO scaffold is permitted.

Mixed-version production ordering is mandatory: apply the additive migration,
then roll API until every API replica mints/returns `jobRef` and serves the
owned status seam, and only then roll runtime replicas that require `jobRef` and
project `await`. Old runtime safely ignores the additive receipt field; new
runtime must never run against old API. Rollback reverses application order
(runtime first, then API) and retains the additive table/mapping rows.

The chart enforces this order with Argo waves: the existing migration Job is
`PreSync` wave `-1`, API is wave `0`, and runtime is wave `2`. A wave-`1` Sync
hook reaches the ready API Service and requires the exact public readiness
capability `asyncJobHandles: "v1"` before Argo admits runtime. The chart fails
rendering when runtime is enabled without API, enabled migrations, or the exact
v1 API/runtime contract declaration. The hook's own NetworkPolicy-only label is
explicitly allowed to the public readiness port. A missing/old/malformed API
capability fails the hook and blocks runtime; there is no handleless fallback.

This ordering is defense in depth, not the rollback safety boundary. F2 advances
the await observation protocol to `/v2`; runtime uses only the versioned v2
snapshot/long-poll and subscribe operations, with no unversioned/v1 fallback
for v2 semantics. API advertises the exact v2 capability only after it serves
the contract; an old API returns 404 before controller authorization, parsing,
enqueue, or canonical mutation. Thus an API-first rollback fails closed rather
than accepting a partial v2 request. Retain additive rows and reverse
application rollout runtime → API → web. The existing v1 enqueue barrier
remains historical CP5 protection for the previously deployed surface.

## Production exit gates

The approved founder gates are:

The former gate wording that treats `notify` as current-turn terminal, requires
one blocking wait/job/turn, or evaluates a late-only banner is superseded by the
F1–F4 criteria above. The historical CP1–CP5 evidence remains preserved; it is
not founder acceptance of this revised UX.

**Current production evidence:** the deployed live run passed gates 6–8 for
`wait`, durable `notify`, and restart survival, and gate 11 attachment delivery
remained exactly once. The full continuation portion of gates 9/10/13 did not
complete because native-web dispatch was incorrectly rejected for lacking a
synthetic binding row. The bounded local repair is pending independent audit;
these partial results do not constitute live acceptance or closure.

0. Migration → API → runtime rollout ordering is enforced; no new runtime
   replica can receive a handleless async enqueue response.

1. A published Script automates a real browser loop through the local bridge.
2. Script receives no bridge token and cannot bypass profile ownership.
3. Observer lock and `request_user_action` semantics are preserved.
4. Telegram honestly returns `open_in_app` / `bridge_unavailable`.
5. Browser quotas, billing, and telemetry use the existing contour.
6. `wait` after early completion immediately returns the terminal result.
7. `wait` timeout returns pending and does not cancel the job.
8. `notify` survives restart.
9. Duplicate notify/completion creates at most one continuation.
10. Completion concurrent with a user turn creates no parallel response.
11. Media/document delivery is not duplicated.
12. Foreign `jobRef` fails closed.
13. The model continues the same Scenario after completion.
14. Document SDK preservation of registration/versioning/honest delivery is
    **N/A by the approved NO-GO**; release proof must show that no Document SDK
    surface exists rather than silently dropping this gate.
15. Scripts receive none of the prohibited Tools.
16. There is no general-purpose SDK, second runtime, or `ScriptRun`.
17. Existing non-Script browser/document/media flows do not regress.
18. Founder live acceptance confirms the browser loop and `wait`/`notify`.

In addition, implementation must prove:

1. no dual narrator and no double model completion framing;
2. at most 20 admitted waits per dispatched turn (not one-wait-per-job);
3. dispatch-time entitlement recheck;
4. bounded unattended-continuation chain;
5. Redis-outage fail-closed behavior while ordinary Script execution remains
   unaffected.
