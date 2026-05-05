# ADR-086: Async media jobs for generated image, audio, and video

## Status

Accepted; implemented for the active generated-media lane (`image_generate`, `image_edit`, `video_generate`).

Current continuation state:

- **Purpose:** replace long synchronous media completion inside ordinary chat/webhook turns with one durable async media lane for generated `image`, `audio`, and `video` outputs.
- **Production posture:** text replies remain on the current sync/stream turn path; generated media delivery moves to a durable job model shared by `web` and `Telegram`.
- **Completed through:** Slice 7 cleanup and verification for the active generated-media lane. Ordinary `image_generate`, `image_edit`, and `video_generate` turns now accept only at the real tool boundary, persist one durable `assistant_media_jobs` request shape with `directToolExecution`, execute in the worker without a second LLM run, and restore pending state on web from durable `activeMediaJobs` truth.
- **Next active item:** none inside ADR-086 architecture cleanup. Only live validation / operational observation remains outside this ADR slice.
- **Critical invariant:** preserve current quota/limit truth, especially ADR-082 delivery-confirmed media settlement and the existing calm user-facing limit explanations when media is unavailable.
- **Do not preserve:** channel-specific long-held media completion paths, Telegram webhook waits for final generated media, web stream waits for final generated media, or dual long-term sync/async media truth.
- **Continuity requirement:** chat switch, `F5`, passive reconnect, and stream reattach must restore pending media state from server truth. Users must not be left in a hanging or ambiguous state.

## Date

2026-05-05

## Relates to

ADR-016, ADR-017, ADR-034, ADR-060, ADR-066, ADR-076, ADR-081, ADR-082

## Context

PersAI currently treats generated media too much like ordinary text completion:

1. a user asks for generated media
2. the ordinary turn stays open while runtime/provider work happens
3. the same request path is expected to persist messages, settle quota, and deliver the final artifact to the channel
4. the user sees the final result only if that whole synchronous path survives

That shape is now too fragile for production media behavior.

The live Telegram investigation for assistant `8b27ed67-b9dc-4c9e-b1dc-8b09852eaaee` exposed the concrete failure mode clearly:

- `/telegram-webhook/:assistantId` could stay open for `~60s`, `~68s`, `~148s`, and `~153s`
- Telegram retried the same update while the first request was still in flight
- duplicate update handling protected correctness only partially; it did not produce good user experience
- users could see apparent silence, missing "sending" state, later dry-error fallback text, and delayed media arrival out of band

The recently fixed Telegram false-success bug was narrower than this ADR, but it confirmed the deeper architecture issue: generated media delivery does not fit safely inside the same synchronous completion contour as short text replies.

The product constraints are strict:

- do **not** convert the whole platform into async chat
- do **not** break ordinary text speed or web stream continuity
- do **not** lose the current calm quota/limit explanations when media is blocked by plan/tool limits
- do **not** break ADR-082 reservation/settlement/reconciliation semantics
- do **not** leave the user in a "maybe still working, maybe dead" state
- do **not** create one async model for Telegram and a different one for web
- do **not** leave behind a second legacy media path after cutover

The web product also has continuity requirements that the Telegram webhook path does not:

- pending state must survive chat switches
- pending state must survive `F5`
- pending state must survive passive disconnect / stream reattach
- the user should see a minimal status indicator for background generation without relying on fragile local-only state

At the same time, the existing limit behavior is valuable and must be preserved. Today, when media cannot be generated because of limits or tool policy, the assistant can still produce a useful calm explanation instead of a generic hard failure. Moving media work async must not flatten those product responses into `"temporarily unavailable"` or generic worker errors.

## Decision

PersAI will introduce one durable async media lane for generated `image`, `audio`, and `video` outputs while keeping ordinary text turns on the current sync/stream path.

Core decisions:

1. Only generated media moves to the async lane. Ordinary text turns stay synchronous/streaming.
2. The async lane is platform-wide, not Telegram-only or web-only.
3. Media job truth is durable server-side state, not a long-lived in-memory LLM session and not client-local recovery state.
4. `activeTurn` remains the continuity model for ordinary web text turns; generated media gets a separate continuity model.
5. Quota/limit refusal remains immediate and conversational. If a request is blocked by plan/tool/limit policy, no media job is created and the user still receives the existing calm explanation path.
6. The async lane preserves ADR-082 semantics: reserve before expensive provider work, settle only on delivered user-visible output, release or reconcile on no-delivery outcomes.
7. When a media job finishes, PersAI may run a short completion turn with current history, but the job state and delivery are still backend-owned truth.
8. The completion turn is a fresh synthetic/internal turn, not a resumed long-running user turn.
9. The final media send is backend-owned and idempotent.
10. After cutover, the old long-lived sync media completion path is removed from the active product path.

The target invariant is:

```text
user requests generated media
-> policy/quota/limit precheck
-> durable media job created
-> quick user-visible accepted/pending response
-> async provider/runtime execution
-> durable artifact/job state update
-> short completion turn with current history when needed
-> backend delivery to channel
-> quota settle/release/reconcile by delivered truth
```

## Product semantics

### Split between text turns and media jobs

PersAI now treats two outcomes differently:

- ordinary text reply: current sync/stream path
- generated `image` / `audio` / `video`: async media job path

This ADR applies only when the product action is "generate media for the user" or equivalent generated media delivery, not to all tool usage in general.

### Immediate refusal must stay conversational

If media is blocked before provider work because of:

- quota exhausted
- plan does not allow the tool
- dynamic policy says the tool/model is unavailable
- concurrency or queue policy rejects the request
- per-turn media cap or safety policy blocks the request

then PersAI must keep the current immediate user-facing explanation behavior.

That means:

- no media job is created
- the user still receives a calm assistant reply that explains the limit or policy outcome
- the existing assistant-visible limit semantics are preserved rather than replaced by a generic background-job error

This is a hard requirement. Async execution changes orchestration, not the product truth of polite, informative media refusal.

### Accepted media requests

If the media request is allowed:

1. PersAI creates a durable media job.
2. The user receives an immediate accepted/pending response.
3. The long provider/runtime/media work continues asynchronously.
4. The user can continue ordinary text conversation while the job is running.

### No hanging state

Every media job must converge to one visible terminal outcome:

- `delivered`
- `failed`
- `canceled`
- `expired`

The user must never be left with only a vanished spinner or a silent stalled state.

### One active media job per chat

For the first target state, PersAI should allow:

- at most one `running` media job per chat
- at most one additional `queued` media job per chat

Reason:

- it prevents unbounded backlog
- it keeps the product understandable
- it reduces ambiguous "which image/video/audio is still pending?" states
- it avoids overcomplicating quota reservations and user recovery in the first implementation

Ordinary text messages may continue normally while a media job is active.

If the user asks for more media than the bounded queue allows, PersAI should return a calm explicit explanation rather than silently dropping the request.

### Ordinary turns must see open media jobs

When a chat has one or more open media jobs, every new ordinary user turn in that chat must receive a compact server-provided summary of those open jobs in runtime context.

This summary is included only when at least one media job is still open, for example:

- `queued`
- `running`
- `completion_pending`

It should not be injected when the chat has no open media job state.

The purpose is product continuity:

- the assistant knows that background generation is already in progress
- the assistant can answer repeated media requests contextually instead of behaving as if no prior request exists
- the assistant can explain whether it is still working, can queue the next request, or needs the user to replace the current one

The summary must be factual and backend-owned. The model receives queue truth; it does not invent queue truth.

### Completion turn with history

When media generation finishes, PersAI may create a short synthetic/internal completion turn that sees:

- current canonical chat history
- the completed media job summary
- resulting artifact/file references
- current plan/quota/channel truth

The purpose of this completion turn is limited:

- decide whether to add a short final text
- adapt the wording to the now-current context
- avoid awkward stale wording if the conversation moved on

The completion turn must **not** own:

- job truth
- queue truth
- delivery idempotency
- quota truth

Backend state remains authoritative.

## Web continuity semantics

### `activeTurn` remains separate

`activeTurn` continues to represent ordinary text-turn continuity for:

- stream start
- stream reattach
- passive disconnect recovery
- stop semantics

Generated media jobs must not be hidden inside `activeTurn`.

Web continuity needs a separate server-projected media state, for example:

- `activeMediaJobs[]` on chat bootstrap rows
- `activeMediaJobs[]` on message/history reads for the selected chat

### Recovery on chat switch and `F5`

Pending media state must restore from server truth when the user:

- switches away from the chat and back
- reloads with `F5`
- backgrounds the tab and returns
- passively disconnects and reconnects

The indicator must not depend only on local React state or a currently open SSE connection.

### Web indicator

Web should show a minimal pending indicator above the input area when a media job exists for the current chat.

The indicator should be:

- quiet, not a large modal
- per-chat
- durable across switch/reload
- timestamp-based so elapsed time can resume from persisted `startedAt`

Recommended visible fields:

- media type or short label
- status (`queued`, `generating`, `finalizing`, `delivered`, `failed`)
- elapsed time

The indicator is product truth, not decoration. Its restore path must be tested explicitly.

## Telegram semantics

Telegram webhook processing must no longer wait for final generated media completion.

For accepted media requests:

1. webhook creates/claims the media job
2. webhook returns quickly
3. Telegram receives an immediate honest acknowledgement such as "preparing the image/audio/video"
4. final media is delivered later by the async completion/delivery path

Telegram duplicate update handling remains necessary, but the product should no longer rely on one long webhook surviving end-to-end media generation.

## Queue and worker semantics

Media jobs require durable worker semantics.

Each job should include:

- one canonical job id
- one canonical chat/thread owner
- one canonical current status
- attempts and retry timing
- per-job idempotency for execution and delivery
- clear error code/message on failure

Workers must enforce:

- bounded global concurrency
- per-chat single active media execution
- per-assistant/user locks where needed by existing runtime/channel semantics
- retry with backoff for retryable infrastructure failures
- no duplicate final delivery for the same completed job

If a worker crashes mid-flight, the system must recover from persisted job state rather than losing the media request silently.

## Timeout, budget, and limit semantics

This ADR does **not** replace existing timeout or dynamic budget logic. It relocates where that logic applies.

### Preserve current policy truth

Existing semantics that must remain intact:

- per-tool availability checks
- dynamic timeout selection
- model/provider fallback rules
- per-turn caps and safety limits
- monthly media quota semantics from ADR-082
- daily non-billing safety/rate limits where they still apply

### Move long wait off the user request lifecycle

What changes:

- timeout and budget policy apply to media job execution
- they no longer require holding the Telegram webhook or web stream open until final media delivery

### Explicit timeout outcomes

When a media job times out or expires:

- the job must move to a visible terminal state
- reserved quota must be released or marked for reconciliation exactly by ADR-082 truth
- the user must receive an explicit failure outcome, not silence

## Limit and quota explanation invariants

The current product has an important quality that must survive this ADR:

- when media cannot be sent because of limits, the assistant can still explain the situation cleanly

To preserve that:

1. limit/quota rejection happens before durable async execution starts
2. the same structured policy/quota facts remain available to the assistant/runtime response shaping path
3. user-visible copy remains calm and specific
4. "job failed" is not used as a substitute for "request was never allowed"

In short:

```text
blocked by quota/plan/policy
-> immediate assistant explanation
-> no job created

allowed, but later infra/provider/delivery failure
-> job terminal failure
-> explicit failure outcome
```

These are different product states and must stay different.

## Data model direction

Do not overload the existing web `activeTurn` persistence or legacy message-delivery flags to represent async generated media state.

Target persisted concepts:

### Media job

- `id`
- `assistantId`
- `workspaceId`
- `userId`
- `chatId` / canonical surface thread reference
- `surface`: `web`, `telegram`, future channels
- `kind`: generated `image`, generated `audio`, generated `video`
- `requestSource`: user turn / tool request / completion request metadata
- `status`: `queued`, `running`, `completion_pending`, `delivered`, `failed`, `canceled`, `expired`
- `sourceClientTurnId` when applicable
- `sourceUserMessageId`
- `assistantAcknowledgementMessageId` when applicable
- `completionAssistantMessageId` when applicable
- `createdAt`, `startedAt`, `completedAt`, `deliveredAt`, `failedAt`
- `lastErrorCode`, `lastErrorMessage`
- `attemptCount`, `nextRetryAt`

### Media job artifact linkage

- job id
- produced `artifactId` when runtime uses one internally
- produced `fileRef` / `AssistantFile` link when persisted
- delivered attachment/message refs when delivery succeeds

### Media job quota linkage

- reservation reference ids
- settle/release/reconcile references
- resolved plan period snapshot used for the job

### Media job event history

Append-only event rows are preferred for debuggability:

- `queued`
- `started`
- `provider_completed`
- `completion_turn_started`
- `completion_turn_completed`
- `delivery_succeeded`
- `delivery_failed`
- `released`
- `reconciliation_required`
- `expired`
- `canceled`

## API and boundary direction

### Public/product boundaries

The public chat send APIs stay as they are for ordinary text semantics. This ADR does not create a second public chat product.

What changes at the public/product level:

- chat/bootstrap/history responses must expose current media-job continuity truth for the selected chat
- web clients must be able to restore pending media state without depending on an open stream
- Telegram webhook must use the async media lane internally

### Internal boundaries

Add explicit internal services/endpoints with names that match target semantics rather than hiding async media state behind old synchronous names.

Likely boundary concepts:

- create media job
- claim/run media job
- complete media job
- deliver completed media job
- read media job continuity for chat bootstrap/history

The exact route/service names are implementation detail, but the active boundary must make async media job ownership explicit.

### Completion-turn boundary

The completion-turn path should be explicit and internal:

- accepts a completed media job id plus current history context
- returns optional final text framing
- must be idempotent

It is not a reopened user stream and not a resumed Telegram webhook.

## Files and delivery invariants

ADR-081 file truth remains intact:

- generated media still receives canonical `fileRef` truth when persisted
- delivery and chat rendering can project from canonical Files truth
- `artifactId` remains internal implementation detail, not product truth

ADR-082 delivery-confirmed charging also remains intact:

- generated provider output alone is not enough to charge the user
- only delivered user-visible media settles quota
- no-delivery outcomes release or reconcile instead

## Implementation shape and status

This ADR should be implemented as one coherent cutover slice, not as a long-lived Telegram-only then web-only architecture split.

Internal implementation work can still proceed in ordered steps, but the active shipped product truth after cutover must be one model shared by both channels.

| Work block                                    | Status    | Purpose                                                                                      | Main affected areas                                  | Completion criteria                                                                                                                                |
| --------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ADR and target-state contract              | Completed | Lock the async media architecture before code changes.                                       | `docs/ADR/086-*`, handoff, changelog                 | ADR accepted with one platform-wide media-job model, preserved quota/limit invariants, web continuity rules, and Telegram quick-ack semantics.     |
| 2. Durable media job data model and contracts | Completed | Add canonical persisted job truth and client-facing continuity projections.                  | Prisma schema, contracts, API read models            | `assistant_media_jobs` now exists as durable schema truth, and web continuity responses expose `activeMediaJobs` without overloading `activeTurn`. |
| 3. API orchestration and worker execution     | Completed | Create the backend-owned async lane.                                                         | `apps/api`, worker services, media delivery services | Web ordinary chat requests can now create durable media jobs with immediate acknowledgement, jobs run asynchronously, and `completion_pending` rows are delivered into the web chat by the backend worker. |
| 4. Runtime/completion-turn seam               | Completed | Allow completed jobs to be framed with current history without reviving a long-running turn. | `apps/runtime`, internal API seams                   | Completion framing now runs through an explicit internal runtime seam that receives current history from the API, replays idempotently by media-job id, and does not own job truth, quota truth, or delivery truth. |
| 5. Web continuity and UX cutover              | Completed | Restore pending media state across chat switch, reconnect, and `F5`.                         | `apps/web`, bootstrap/history payloads, chat UI      | Durable `activeMediaJobs` truth now restores on switch/reload/reconnect, the composer shows quiet pending chips, and pending state clears when durable job state clears. |
| 6. Telegram cutover and sync-path removal     | Completed | Remove long-held webhook media completion from the active path.                              | Telegram adapter/services, delivery seam             | Telegram accepted generated-media requests now quick-ack on the shared async lane, final media arrives through backend completion delivery, and no detector-only or sync fallback path remains in active truth. |
| 7. Verification and cleanup                   | Completed | Ensure no legacy dual-path remains.                                                          | API/runtime/web/tests/docs                           | The active path uses one tool-boundary acceptance contour, worker execution uses only persisted direct tool requests, duplicate read/acceptance layers are removed, quota semantics stay delivery-confirmed, and docs/tests match repo truth. |

## Execution rules

- Do not convert ordinary text chat into a general async queue.
- Do not ship a Telegram-only async media architecture as long-term truth.
- Do not keep the old sync media completion path as a hidden fallback after cutover.
- Do not reuse `activeTurn` as the canonical model for pending generated media.
- Do not degrade quota/limit refusal into generic worker failure text.
- Do not let a completion turn become the job source of truth.
- Do not charge user media quota before delivered user-visible output.
- Do not rely on client-local state for pending media recovery on `web`.
- Do not leave Telegram waiting for final generated media inside one webhook request.

## Prompt for a future implementation session

```text
Implement ADR-086 for PersAI.

Read before coding:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/086-async-media-jobs-for-generated-image-audio-and-video.md
5. docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md
6. docs/ADR/081-unified-user-files-architecture.md
7. docs/ARCHITECTURE.md
8. docs/API-BOUNDARY.md
9. docs/DATA-MODEL.md
10. docs/TEST-PLAN.md

Current active item:
ADR-086 implementation. Build one platform-wide async media lane for generated image/audio/video without changing ordinary text turns into async chat.

Hard invariants:
- preserve ADR-082 delivery-confirmed quota semantics
- preserve calm immediate limit/quota explanations when media is blocked
- preserve web chat switch / F5 / reconnect continuity for pending media state
- keep `activeTurn` as text-turn continuity only
- Telegram webhook must not wait for final generated media after cutover
- no long-term dual sync/async media path

Out of scope:
- billing/provider work
- converting all chat/tool work into background jobs
- redesigning ordinary text stream semantics

Before ending:
- run focused tests for the touched areas
- run AGENTS verification gates when code/contracts changed
- update docs/SESSION-HANDOFF.md and docs/CHANGELOG.md
- state whether any legacy sync media path still remains
```

## Verification requirements

Focused checks should prove:

1. media blocked by quota/plan/policy still returns a calm immediate assistant explanation and does not create a job
2. allowed media requests create durable jobs and return accepted/pending state quickly
3. ordinary text turns still work while a media job is pending
4. web chat switch restores pending media state from server truth
5. `F5` restores the pending media indicator for the current chat
6. passive disconnect/reconnect does not lose pending media state
7. Telegram webhook completes quickly for accepted media jobs instead of waiting for final delivery
8. final delivery is idempotent and does not double-send media
9. completion-turn wording can use current history, but job truth remains backend-owned
10. media quota is still settled only on delivered output
11. provider success plus no delivery still releases or reconciles quota instead of charging the user
12. no active shipped path still relies on synchronous final media completion inside the old request lifecycle

## Non-goals

- No conversion of all chat turns into background jobs.
- No redesign of ordinary text SSE semantics.
- No second long-term queue model for non-media tools.
- No replacement of ADR-082 quota policy.
- No replacement of ADR-081 file identity truth.
- No Telegram-only special architecture as final product truth.

## Consequences

### Positive

- Telegram webhook latency and retry pressure from generated media can be removed from the active product path.
- Web users get durable, recoverable pending-media state instead of fragile local spinners.
- Users can continue chatting while media is being generated.
- Quota/limit explanations remain calm and immediate.
- Media charging remains defensible because delivery-confirmed settlement stays intact.
- One architecture serves both `web` and `Telegram` instead of drifting into channel-specific hacks.

### Negative

- The control plane gains another durable job model and more orchestration complexity.
- Chat continuity becomes intentionally split between text `activeTurn` truth and media-job truth.
- Delivery requires stricter idempotency and better explicit terminal-state handling.
- The implementation slice is broader than a small Telegram bugfix and must be treated as one coherent cutover.
