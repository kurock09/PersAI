# ADR-157: Await Delivery, Image Narration, and Background Shell

## Status

**Open 2026-07-18 — founder-approved architecture checkpoint (documentation
first).** One clean follow-through program. No dual-path, no short-ops
back-compat, no ghostwriter completion framing for images, no post-job wipe of
background shell processes. Intermediate deploys are forbidden; ship once after
implementation + independent audit + full gate.

Supersedes the conflicting ADR-152 clauses listed under **Supersession**.
Does not reopen ADR-151 or ADR-156. ADR-152 Browser Script SDK acceptance
remains paused and is outside this ADR.

Baseline at opening: clean `main` `3879196a`.

## Context

Live and local evidence on the ADR-152 await/job path showed four product
failures that share one root: contracts were half-Cursor and half-legacy.

1. **Delivery deferred on narration.** Media/document completion delivery
   returned early on `prepareDelivery → defer` while `narrationOwner` was null.
   Image bytes were ready in seconds; `await.wait` stayed `pending` for minutes
   because attachment/`deliveredAt` never landed until the source turn ended.
2. **Ghostwriter framing.** Unsubscribed image completion called a separate
   LLM (`completion_framing`) that authored user-facing text. The chat model
   was not the narrator; DeepSeek vs vision providers were conflated with that
   ghostwriter path.
3. **Empty wait was not a timer.** `await.wait` with no open jobs returned
   immediately even when `timeoutMs` was positive. Max timeout was 60s. Tool
   prose claimed “block up to 60 seconds,” so the model lied about waiting.
4. **Background shell was threshold-only and wiped.** Detach required plan
   Process-timeout yield; `nohup`/user background without retain was killed by
   post-job process baseline cleanup. Founder requires Cursor-like **explicit
   background** jobs that stay visible and alive until warm pod idle TTL
   (~15m), not silent process death between shell calls.

## Decision

### D1 — Delivery never waits on narration

For media and document adapters, artifact delivery to chat (attachment /
`deliveredAt` / equivalent Telegram outbound) proceeds as soon as artifacts are
ready. `prepareDelivery` may still decide whether a **legacy framing text call**
is allowed for non-image paths that remain in scope elsewhere; it **must not**
block bytes. `async_narration_decision_pending` must not delay attachment.

`await` terminal success for media/document remains **delivery-visible**
authority (attachment and/or `deliveredAt` / delivered status). Failure/cancel
still beats delivery-visible success.

### D2 — Image narration is chat-model owned

For `image_generate` and `image_edit` only:

- If the plan enables vision, run vision **only as perception** so the next
  chat-model call understands what arrived. Vision does not author the
  user-visible message.
- The **chat model** writes all user-facing text (same turn after wait, or
  continuation after notify / post-turn delivery).
- Web and Telegram are the same contract.
- DeepSeek (non-vision): inject perception via the existing vision-bridge
  describe path into model context.
- OpenAI / Anthropic (vision-capable): give the model the image/observation in
  the provider-native way; no ghostwriter caption.
- Kill success-path image `completion_framing` / `maybeFrame` as a
  user-text author. No dual “frame if unresolved” path.
- Audio, video, and document vision/framing redesign are **out of scope**.

### D3 — Pure timer wait and five-minute max

`await({ action: "wait", timeoutMs })` with no `jobRef`:

- If there are open/owned non-terminal jobs, poll until change, all terminal, or
  deadline (unchanged intent).
- If the snapshot is empty (or already all-terminal) and `timeoutMs > 0`,
  **sleep until the deadline** — this is an intentional timer.
- `timeoutMs` range is integer `0..300000` (five minutes). `0` remains
  status-only / no sleep.
- Notify still requires `jobRef`. Twenty replay-deduped waits per dispatched
  turn remain. Update tool projection, runtime validation, and wait countdown
  banner clamps together — no stale 60s ceiling left in code or docs.

### D4 — Explicit background shell (Cursor-like)

Model-facing `shell` / `exec`:

- **Synchronous (default):** tool waits for completion; not shown as an
  in-progress Working job.
- **Background (explicit):** model sets background in the tool call (no waiting
  for plan Process-timeout). Runtime returns opaque `jobRef` immediately;
  canonical sandbox job is visible in Working; `await.wait` / `await.notify`
  apply. Process remains in the warm session pod until pod idle TTL (~15m) or
  pod death.
- Post-job process baseline wipe **must not** kill retained background job
  processes. Warm pod idle TTL remains the GC.
- Turn **Stop** cancels only the current turn’s foreground work, not retained
  background jobs from earlier calls.
- Silent `nohup` without background/`jobRef` is not a supported product path;
  background is only the explicit job path.

Plan Process-timeout remains a bound for synchronous execution and safety; it
is not the only door into background.

### D4.1 — Honest chat bubbles (same-turn vs wake)

Founder override 2026-07-19 (Cursor-like; supersedes prior “no auto-subscribe”):

| Path | User-visible bubble |
|---|---|
| In-turn `await.wait` (or sync tool) while the streaming assistant reply is still open | **Same** assistant bubble: model text + queued attachments/shell outputs embed into that reply |
| Source turn finalized with unresolved child jobs (with or without explicit `await.notify`) | Jobs are **auto-subscribed** to continuation; on terminal → **new** assistant bubble via scheduler |
| Explicit `await.notify` | Idempotent with auto-subscribe (duplicate subscribe); same wake path |
| Background job still open; user may send ordinary messages between enqueue and wake | Interleaved user bubbles are first-class; wake remains a **new** assistant bubble, never a patch onto an old one |

**Wake dispatch (2026-07-19):** D4.1 auto-subscribe **intent** stays.
**Dispatch** of those wakes is owned by **ADR-159** Session Work Queue
(`ChatWakeCoordinator`: user priority, idle-pause, FIFO catch-ups, no
parked-accepted parallel wakes). Do not reopen this ADR for queue work.

`narrationOwner: "legacy"` is abolished on the live finalize path. Historical
legacy rows heal into continuation on subscribe/completion. `await.wait` /
`already_owned` must never write “already being handled…” into chat
(`terminal_static` reserved for depth exhaustion only). Continuation is
“agent gets another turn”, not “append to the previous message”.

### D5 — Working pill ops

Web Working media pills accept only OpenAPI operations
(`image_generate` | `image_edit` | `video_generate` | `audio_generate`). Short
`generate` / `edit` dual-read is removed.

## Supersession (ADR-152)

This ADR supersedes ADR-152 where they conflict:

| ADR-152 clause | ADR-157 |
|---|---|
| Empty wait → immediate empty snapshot | Empty wait + `timeoutMs > 0` → timer sleep |
| `timeoutMs` max 60000 | max 300000 |
| Unsubscribed image keeps completion-framing author | Image framing author removed; chat model narrates |
| Delivery may defer on unresolved narration | Bytes never defer on narration |
| Sandbox background only via Process-timeout detach | Explicit background; sync default; no wipe of background PIDs |
| Short Working ops back-compat (if any) | OpenAPI ops only |

Unchanged from ADR-152 unless listed above: opaque `jobRef` shapes, notify
non-terminal continuation, same-chat lease serialization, eight-active-job cap
with self-exclude on post-detach register, browser Script SDK pause, Redis
long-poll still not landed.

## Scope boundaries

Out of scope:

- Document completion-framing / document-vision redesign
- Audio/video vision perception
- Browser Script SDK live acceptance
- Redis subscribe-before-read long-poll
- General-purpose process retain without `jobRef`
- New ScriptRun / nested LLM / managed secrets

## Implementation sequence (no intermediate deploy)

0. This ADR + docs pointers (ARCHITECTURE, API-BOUNDARY, DATA-MODEL,
   TEST-PLAN, SESSION-HANDOFF, CHANGELOG).
1. Delivery unblock + await timer/5m + explicit background shell + wipe/Stop
   semantics + tests.
2. Image perception → chat-model narration; remove image ghostwriter framing;
   Working pill OpenAPI-only; web/Telegram parity; tests.
3. Independent audit + full local gate → one push/deploy → founder live
   acceptance.

Parent audits/commits only. Implementation subagents may use only
`gpt-5.6-terra-medium` or `claude-sonnet-5-thinking-high`.

## Verification

- Media/document: artifacts ready + `narrationOwner = null` → attachment /
  delivery-visible before source finalize; `await` can observe `completed`
  mid-turn.
- Empty `await.wait` with `timeoutMs = 300000` sleeps; with `0` does not.
- Background shell: immediate `jobRef`, listed in Working, survives a later
  sync shell in the same warm pod, dies with idle pod TTL; Stop does not kill
  it.
- Sync shell: not listed as in-progress Working background job.
- Image success path: no user-text `completion_framing`; chat model produces
  visible text; plan without vision skips perception injection.
- Working pill: OpenAPI ops only; no short `generate`/`edit` branches.
- Focused API/runtime/sandbox/web tests + full CI-like gate before push.

## Rollback

Application order reverse of deploy pins. Fail closed if await v2 / background
shell capability is required by a newer runtime against an older API/sandbox.
No dual-read shims left in place for rollback convenience.
