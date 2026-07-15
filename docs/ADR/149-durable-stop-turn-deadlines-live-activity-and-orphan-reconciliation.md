# ADR-149: Durable Stop, Turn Deadlines, Live Activity, and Orphan Reconciliation

## Status

**Open 2026-07-15** — **S0–S4 implemented locally; S5 local gate green.** Deploy +
live acceptance pending (push = deploy).

## Date

2026-07-15

## Baseline

**S0 lock:** `a753e77ef66f98bab67e237b6aabe55b7f2f939b` (`origin/main`,
2026-07-15). Parent-audited equal to deployed ADR-148 closure docs push.

Cluster evidence for this program (2026-07-15 `persai-dev`, assistant
`2f8cf38e…`, thread `web-1783813453912`):

- two web turns hit `runtime_timeout` at **615103ms** / **615258ms** with
  `firstDeltaMs=-1`;
- runtime completed **35** / **34** DeepSeek tool-loop iterations before API
  abort;
- **no** `POST /assistant/chat/web/stop` on those turns;
- sandbox warmth healthy (`warm_session_pod already_running=true`,
  `remaining_pids=0`, `cleanup_failed=0`).

## Orchestration model

ADR-149 is a parent-orchestrated program.

- The parent owns architecture, slice boundaries, subagent dispatch, diff review,
  verification, documentation truth, deploy sequencing, and live acceptance.
- Implementation is delegated **one bounded slice at a time**. GPT-5.4 / Sonnet
  subagents implement; the parent audits every diff and rejects compatibility
  shims, dual-path fallbacks, dead stubs, stale comments, and partial cutovers.
- **No parallel implementation slices.**
- S1 starts only after this ADR and S0 audit lock pass parent/founder audit.
- S1–S4 land locally without intermediate push or deploy unless the parent
  explicitly approves a hotfix.
- One final push occurs only after the S5 full-repository gate is green.
- Deploy and live acceptance follow the deployed release under parent
  supervision.
- Closed ADRs remain closed. ADR-148 warmth/cleanup is out of scope. ADR-142
  soft-detach semantics remain authoritative.
- If docs and code disagree at a slice boundary, reconcile truth before code.

## Problem

PersAI intentionally separates **UI disconnect** from **runtime stop**
(soft-detach). That model is correct. The remaining production pain is not
sandbox warmth; it is incomplete stop, misleading turn budgets, thin activity,
and orphan state after failure/restart.

### Observed failures (logs, not theory)

1. **Hard turn deadline masquerades as hang protection.** API stream abort uses
   `resolveNativeRuntimeTurnTimeoutMs`, which inflates the whole turn to
   `video_generate` **600s + 15s buffer = 615s**. A live tool loop working
   normally is killed at that wall clock with `runtime_timeout` and
   `firstDeltaMs=-1`.
2. **Stop is not durable or honest.** `WebChatTurnHardStopRegistry` is
   process-local. Wrong replica, finished stream, or active-assistant mismatch
   returns **204** while runtime may continue. Closing the browser SSE no longer
   stops the server (ADR-073 Slice 1.2); only explicit Stop should — but Stop
   itself is unreliable cross-replica.
3. **Stop does not cancel in-flight work.** Abort propagates API→runtime HTTP
   stream, but `shell` / `exec` / `browser` tools ignore turn `AbortSignal`.
   Sandbox jobs have no cancel API; runtime polls until completion or sandbox
   stale timeout.
4. **Assistant does not learn that the user pressed Stop.** Attempt rows may get
   `client_aborted`, but next-turn hydration uses generic partial-interruption
   copy, not an explicit user-stop fact.
5. **Activity freezes on long tools.** Only `tool_started` / `tool_finished`
   exist. Reattach `turn_status` polling can overwrite richer live state; shell
   has no stdout tail; browser has no step detail.
6. **Orphan `running` survives restart.** No server reconciler for
   `assistant_web_chat_turn_attempts`. Stale reclaim (120s) happens only on
   duplicate claim with the same `clientTurnId`. Runtime session lease TTL is
   **30s** but `TurnLeaseHeartbeatService` is registered and **not wired** into
   long turns.

### Explicit non-goals

- Reopening ADR-148 or changing warm-session pod reuse/cleanup semantics.
- Replacing soft-detach with “SSE death stops runtime”.
- Re-enabling cadence **`slow_avg`** or turning cadence watchdog back on for
  web chat. That path truncated healthy reasoning/tool turns and must remain
  **disabled and untouched** by this program.
- New browser thumbnail / native preview behavior (ADR-141 stays as-is).

## Founder invariants

1. **Soft-detach stays:** SSE/tab close/network loss ≠ stop. Runtime may finish
   and persist while the client is detached; reattach/status remain valid.
2. **Stop is the only user hard-cancel:** explicit Stop must abort the turn,
   cancel in-flight tool work where technically possible, release leases, and
   mark durable terminal state.
3. **Stop must be durable across API replicas:** no in-memory-only stop truth.
4. **Stop must be visible to the model on the next turn:** explicit
   `user_stopped` semantics in durable history/hydration — not a generic
   “interrupted before completion” marker alone.
5. **Long productive work must not die merely because `video_generate` exists
   in the worker-tool catalog.** Video wall clock applies to video jobs, not
   the entire turn budget.
6. **Any new stall watchdog must be progress-based and conservative.** No
   `slow_avg`. No average token-gap heuristics. Kill only when there is
   evidence of true stall (no provider chunks, no tool progress, no turn
   heartbeat) for a configured idle window.
7. **Activity improvements are additive and bounded.** Existing
   `tool_started` / `tool_finished` behavior and hidden media activity remain.
   Do not regress project-mode activity or media job chips.
8. **Orphan cleanup is server-owned and conservative.** Do not fail a turn that
   still has provable live lease, active sandbox job with heartbeat, or an
   attached stream owner without passing reconciliation guards.
9. **No legacy dual paths.** When durable stop lands, delete the in-memory
   registry and stale “local SSE abort stops server” comments/docs. One prod
   truth only.

## Decision

### 1. Durable stop control plane

Replace `WebChatTurnHardStopRegistry` with a **durable stop dispatch** layer:

- Key: `assistantId + clientTurnId` (+ authenticated `userId` guard).
- Storage: Redis (preferred) or equivalent shared coordination already used by
  API/runtime — not process memory.
- Writer: `POST /api/v1/assistant/chat/web/stop`.
- Consumer: the owning stream handler (primary POST stream) and any API replica
  that can forward abort to the active runtime fetch.

**API contract (breaking cleanup allowed — no legacy 204 silence):**

| Result | HTTP | Body |
|--------|------|------|
| Stop accepted and signaled | `200` | `{ "status": "stopped", "clientTurnId": "…" }` |
| Turn not found / not inflight | `404` | `{ "code": "turn_not_found", … }` |
| Already terminal | `200` | `{ "status": "already_done", "clientTurnId": "…" }` |
| Auth / assistant mismatch | `403` | typed error |

The web client must surface miss cases; Stop is not allowed to pretend success.

### 2. Mid-flight abort propagation

Stop must cancel work, not merely abort the API fetch:

| Layer | Requirement |
|-------|-------------|
| Runtime turn loop | honor `AbortSignal` between tool iterations and inside long tool calls |
| `shell` / `exec` | cancel sandbox job; target ≤2s best-effort process termination |
| `browser` | cancel in-flight bridge command / gateway wait |
| Provider stream | existing abort between chunks remains |
| Sandbox service | add `POST /api/v1/jobs/:jobId/cancel` (or equivalent) with idempotent semantics; terminal states `cancelled` / `failed` / `completed` |

**Lease integrity:**

- Wire `TurnLeaseHeartbeatService` for accepted turns so Redis session lease TTL
  (30s) does not expire mid-turn.
- On successful stop/interrupt/fail terminalization, lease release remains
  mandatory; `*_lease_not_released` should become exceptional, not routine on
  long turns.

### 3. Turn deadline model (split budgets)

Remove the coupling where **`video_generate` worker timeout sets the entire web
stream budget**.

New model:

| Budget | Scope | Default direction |
|--------|-------|-------------------|
| `turnWallClockMs` | whole turn hard ceiling | env-configured; default **≥ 30 min** for prod chat |
| `turnIdleStallMs` | kill only when stalled | env-configured; default **5 min** without progress |
| `workerToolTimeoutMs` | per worker tool (`video_generate`, etc.) | unchanged per-tool semantics |

**Progress definition for idle stall (all required to reset idle timer):**

- provider stream chunk / keepalive;
- runtime SSE heartbeat;
- `tool_started` / `tool_finished`;
- new `tool_progress` events (Slice S3).

**Forbidden:** re-enabling `cadence-watchdog` `slow_avg` or `silent` for web
chat in this program. Those modules may remain in repo but must stay disabled in
`resolveWebStreamCadenceWatchdogOptions`.

`resolveNativeRuntimeTurnTimeoutMs` must no longer use `max(workerTimeouts)+15s`
as the API stream ceiling. Worker timeouts inform per-tool execution only.

### 4. Live activity and tool progress

Add bounded runtime stream events:

```ts
interface RuntimeToolProgressEvent {
  type: "tool_progress";
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  kind: "stdout_line" | "stderr_line" | "browser_step";
  line?: string;       // max 200 chars, truncated
  step?: string;       // browser summary, max 120 chars
  seq: number;         // monotonic per toolCallId
}
```

Caps:

- max **30** `tool_progress` events per tool call;
- max **60** per turn;
- no persistence to `currentActivity` row (live/reattach buffer only).

Web client:

- show rolling last **3** shell lines in inline streaming status;
- show latest browser step in `detail`;
- fix reattach overwrite (`mergeLiveActivity`, not replace);
- clear live activity on `onCompleted`.

### 5. User-stop truth in next-turn context

When Stop succeeds:

- attempt terminal: `interrupted` + `errorCode: "user_stopped"` (replace
  generic `client_aborted` for explicit Stop path);
- persist a compact system/hydration fact consumed by
  `turn-context-hydration.service.ts`:

  > The user explicitly stopped the previous assistant turn before it finished.

Partial assistant text rules stay: if partial text exists, keep it with
`metadata.status: "partial"` plus the explicit stop fact.

### 6. Orphan reconciliation

Add API scheduler + runtime receipt reconciler:

**Web attempts (`assistant_web_chat_turn_attempts`):**

- candidates: `accepted` / `running` older than `ORPHAN_ATTEMPT_GRACE_MS`;
- default grace **20 min** prod;
- reconcile to `interrupted` with `errorCode: "orphan_reconciled"` only when:
  - no active stream owner registry entry,
  - no fresh attempt heartbeat/updatedAt,
  - no live runtime receipt `accepted` for bound request (when known).

**Runtime receipts (`runtime_turn_receipts`):**

- candidates: `accepted` older than `ORPHAN_RECEIPT_GRACE_MS` without terminal
  transition;
- reconcile to `interrupted`/`failed` with typed code;
- unblock idempotent replay.

Reconciler must be **idempotent** and **metrics-logged** before auto-fail in
prod (`orphan_reconcile_candidates`, `orphan_reconcile_applied`).

## Slice plan

### S0 — Audit lock and contract freeze

Parent-only.

- Lock baseline SHA, cluster log references, and this ADR.
- Reconcile `SESSION-HANDOFF`, `AGENTS.md`, `ARCHITECTURE.md` (stop/timeout
  paragraphs only if present), `API-BOUNDARY.md` (stop response contract),
  `TEST-PLAN.md` (new suites named).
- Confirm `slow_avg` / cadence watchdog remain disabled; document as frozen.
- No product code.

**Exit:** founder/parent sign-off to start S1.

### S1 — Durable stop + mid-flight abort + lease integrity

Single implementation slice — the core control plane.

**Deliver:**

- durable stop dispatch (Redis) replacing `WebChatTurnHardStopRegistry` entirely;
- new Stop API responses (`200 stopped` / `404 turn_not_found` / `200 already_done`);
- web client Stop handling for non-204 outcomes;
- runtime/tool/sandbox/browser cancel propagation;
- sandbox job cancel endpoint + runtime client;
- wire `TurnLeaseHeartbeatService` on accepted turns;
- terminal `user_stopped` attempt marking on explicit Stop;
- next-turn hydration marker for explicit user stop;
- delete in-memory registry + stale comments/docs claiming SSE abort stops server.

**Tests (minimum):**

- API: stop hit/miss/multi-replica simulation with shared Redis fake/real;
- API: stop aborts in-flight stream; attempt `interrupted` + `user_stopped`;
- runtime: tool abort cancels sandbox wait; browser cancel best-effort;
- runtime: lease heartbeat renews during long turn (unit/integration);
- web: `use-chat` Stop posts and handles `404`;
- hydration: next turn includes explicit stop fact.

**Exit:** parent CLEAN audit; focused suites green; no orphaned dual-path stop.

### S2 — Turn deadline split + progress-only stall watchdog

**Deliver:**

- replace `resolveNativeRuntimeTurnTimeoutMs` stream ceiling logic;
- env: `PERSAI_RUNTIME_TURN_WALL_CLOCK_MS`, `PERSAI_RUNTIME_TURN_IDLE_STALL_MS`;
- API stream client uses wall clock + idle stall detector (progress-based only);
- idle timer resets on provider chunk, runtime heartbeat, tool boundary,
  `tool_progress`;
- **do not** enable cadence `slow_avg` / `silent`;
- correct timeout log messages to resolved budgets;
- helm values for prod/dev defaults.

**Tests:**

- long tool-loop with periodic progress survives beyond old 615s cap;
- true stall (no progress) terminates with typed `turn_idle_stall` (or mapped
  public code) — not `runtime_timeout` unless wall clock exceeded;
- `video_generate` still respects 600s worker timeout without shrinking entire
  turn to 615s.

**Exit:** parent CLEAN audit; no false-positive stall tests on tool-inflight spans.

### S3 — Tool progress activity + client live-state fixes

**Deliver:**

- runtime emits `tool_progress` for `shell`/`exec` (stdout/stderr tail) and
  `browser` (step summary);
- API maps to SSE `tool_progress`;
- web inline status + badge `detail` rendering;
- reattach/status merge fixes; `onCompleted` clears live activity;
- optional small reattach ring buffer for last N progress lines.

**Tests:**

- runtime shell progress bounded/truncated;
- web renders rolling shell lines;
- reattach no longer clobbers merged live state;
- existing `tool_started`/`tool_finished` tests remain green.

**Exit:** parent CLEAN audit; no regression in project-mode/media activity.

### S4 — Orphan reconciliation

**Deliver:**

- API scheduler for stale web attempts;
- runtime receipt reconciler;
- conservative guards (lease/stream owner/sandbox heartbeat);
- metrics logs;
- helm-configured grace intervals.

**Tests:**

- simulated API pod death → reconciler marks orphan after grace;
- active turn with heartbeat **not** reconciled;
- idempotent reconcile;
- replay unblocked after receipt reconciliation.

**Exit:** parent CLEAN audit.

### S5 — Parent gate, deploy, live acceptance

Parent-supervised.

**Local gate (full repo):**

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck`
6. focused + affected test suites for S1–S4
7. OpenAPI/contracts regenerate with zero diff if touched

**Live acceptance (founder):**

1. long `shell`/`pip` turn shows live stdout lines; Stop kills within ~2s; next
   turn assistant acknowledges user stop;
2. soft-detach: close SSE, runtime continues, reattach shows progress;
3. tool-loop turn >10 min with progress is **not** killed at 615s;
4. simulated stale `running` attempt reconciles after grace without blocking new
   message;
5. browser turn Stop cancels in-flight step (best-effort proof).

**Closure:** update ADR status, `CHANGELOG.md`, `SESSION-HANDOFF.md`, `AGENTS.md`.

## Consequences

### Positive

- Stop becomes a real prod control, including multi-replica API.
- Users see what long shell/browser work is doing.
- Productive agent turns are not capped by video worker timeout.
- Restart/deploy leaves fewer zombie `running` rows.
- Model gets honest “user stopped” context.

### Risks / residuals

- Sandbox cancel may be best-effort for already-finished jobs — must be idempotent.
- Browser bridge cancel depends on extension connectivity; document residual.
- Orphan reconciler tuning: start with conservative grace; metrics before
  tightening.
- Wall-clock turn ceiling still exists (intentionally high) for runaway turns.

## References

- Cluster log audit 2026-07-15 (`runtime_timeout` ~615s, tool-loop iterations 35/34)
- `apps/api/.../web-chat-turn-hard-stop-registry.service.ts` (to be removed)
- `apps/api/.../native-runtime-turn-timeout.ts` (to be replaced for stream ceiling)
- `apps/api/.../stream-web-chat-turn.service.ts` (`resolveWebStreamCadenceWatchdogOptions` — leave disabled)
- `apps/runtime/.../turn-lease-heartbeat.service.ts` (to be wired)
- `docs/ADR/148-sandbox-session-warmth-and-fail-closed-cleanup.md` (closed; out of scope)
