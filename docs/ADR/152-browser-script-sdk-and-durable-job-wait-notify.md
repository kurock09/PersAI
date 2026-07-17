# ADR-152: Browser Script SDK and Durable Job Wait/Notify

## Status

**Approved architecture checkpoint, open for staged implementation.** S0 evidence
and founder approval are recorded in `docs/SESSION-HANDOFF.md`. This ADR is
documentation-only at its opening; it claims no implementation, migration,
deployment, or live acceptance.

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

- `await({ action: "wait", jobRef, timeoutMs })` resolves terminal state before
  blocking, clamps `timeoutMs` to at most 60 seconds, and permits at most one
  blocking wait for a job in a turn. Timeout returns pending and never cancels
  the canonical job. Repeated model polling is rejected with guidance to use
  `notify`. Stop aborts only the wait and turn; it does not cancel media or
  document work.
- `await({ action: "notify", jobRef })` creates a durable subscription and is
  terminal for the current turn: there is no next provider loop. API returns
  localized static acknowledgement/activity only. A later terminal job creates
  one full model continuation in the exact originating chat and channel, with
  fresh Role, effective-Skill, Scenario, todo, and bundle hydration. Existing
  file delivery is not repeated.

If the job became terminal before the call, `notify` returns terminal facts
inline and creates no continuation. The continuation chain has a hard maximum
depth of **4** unattended continuations per originating user turn; the
implementation must prove and name its exact enforcement constant before
release.

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

Initial adapters are only:

- `assistant_media_jobs`;
- `assistant_document_render_jobs`.

Only `delivered` is terminal success. `completion_pending` and
`ready_for_delivery` remain pending. The adapter contract is deliberately
extensible to other canonical long jobs, so background runs are not forgotten.
Current `assistant_background_task_runs`, however, does not expose the concrete
immutable run identity required to mint and resolve a safe handle. It is
therefore deferred until that canonical prerequisite exists; a recurring
`assistant_background_tasks` row never qualifies as a `jobRef`. Sandbox,
indexing, safety, and rollout work are excluded.

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
volatile structured completion facts, persists only assistant output, and does
not manufacture a persisted user message or re-deliver files.

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
Browser page payloads never enter Postgres, `SandboxJob`, GCS, or logs. Small
platform Node/Python wrappers and a CLI live in the existing sandbox image:
there is no new image contour, pod, or NetworkPolicy. Broker loss/restart fails
the active Script closed; arbitrary-code execution never durably resumes.

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
- sandbox/indexing/safety/rollout handle adapters.

## Implementation checkpoints

These are flow checkpoints, not separately deployable products and do not
authorize intermediate deploys:

1. contracts plus handle and `await wait`;
2. durable `notify`;
3. browser SDK and broker;
4. Admin/MCP manifest authoring and contracts;
5. independent audits, full gate, one push, deploy, and live acceptance.

Independent second allowed-model audits are required for wait/notify, browser,
and final integration. The parent agent audits and commits only; product
implementation is delegated only to `gpt-5.6-terra-medium` or
`claude-sonnet-5-thinking-high`.

## Rollback

Rollback is additive: stop projecting `await` and stop its scheduler while
preserving existing canonical jobs and handles. Existing file delivery remains
intact, and unsubscribed legacy framing remains unchanged. No destructive
rollback migration, compatibility alias, or TODO scaffold is permitted.

## Production exit gates

The approved founder gates are:

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
2. one blocking wait per job per turn;
3. dispatch-time entitlement recheck;
4. bounded unattended-continuation chain;
5. Redis-outage fail-closed behavior while ordinary Script execution remains
   unaffected.
