# ADR-070: Scaling readiness program and clean delivery discipline

## Status

Accepted

## Context

PersAI now has a substantial runtime/control-plane foundation, but the repo does not yet have one explicit program-level decision for how the system will become production-ready for `1000–5000` online users.

The current state has three risks:

1. Scaling work can sprawl across infrastructure, API, OpenClaw, storage, media, quotas, and observability without one canonical sequence.
2. Different sessions and Cursor agents can carry partial context and accidentally deepen temporary compatibility paths, duplicate work, or leave stale rollout branches behind.
3. Risky deploys can pile up without a fixed `deploy -> observe -> verify` rhythm, making regressions harder to attribute and rollback.

This repository already uses ADRs, roadmap slices, execution-plan docs, and session handoffs effectively for bounded architecture programs. Scaling readiness should follow the same discipline instead of creating an informal parallel process.

## Decision

Use one explicit scaling-readiness program with a docs-first control layer.

### 1. One architecture source and one execution source

Scaling readiness is governed by:

- this umbrella ADR for architecture, guardrails, and anti-scope rules
- one central execution-plan document for ordered slices, gates, and handoff protocol
- `docs/ROADMAP.md` for milestone visibility only
- `docs/TEST-PLAN.md` for verification/load-test gates only
- `docs/SESSION-HANDOFF.md` for session progress only

`SESSION-HANDOFF.md` must not become the canonical program spec.

### 2. The program is delivered in bounded tracks

The readiness program is split into bounded tracks, each delivered through narrow slices:

- platform observability and readiness
- GKE production baseline
- API concurrency and dependency hardening
- OpenClaw runtime throughput and multi-replica correctness
- sandbox/dind capacity hardening
- storage/workspace path hardening
- media pipeline capacity hardening
- webhook/realtime burst hardening
- billing/quota correctness under concurrency
- capacity validation and production gate

### 3. Evidence-first rule

Every scaling claim must be classified as one of:

- confirmed bottleneck
- plausible bottleneck / hypothesis
- accepted known risk

No slice may claim success for production-readiness behavior without explicit evidence:

- static verification where applicable
- deploy smoke in the target environment
- observation interval with metrics/log review
- targeted load or burst validation when the slice affects scale paths

### 4. Clean delivery rule

Scaling slices must be delivered "на чисто".

Do not leave behind:

- indefinite temporary compatibility paths
- duplicate old/new read or write paths without a sunset plan
- undocumented flags/toggles with no owner or removal condition
- stale rollout branches after a cutover is proven

If a temporary path is required, it must have:

- explicit naming
- a bounded lifetime
- a removal slice
- clear exit criteria

### 5. One session = one bounded slice

For agent-driven work:

- one session should own only one slice or one named sub-slice
- new architecture discovered mid-slice must be recorded as a future slice or a new ADR-backed decision
- parent agent owns canonical docs updates; subagents return evidence, not canonical state

### 6. Deploy cadence is explicit

Every risky slice must define:

- pre-deploy checks
- deploy scope
- immediate smoke checks
- observation window
- post-window decision

Do not stack multiple unrelated risky changes into one deploy window by default.

Avoid combining in one deploy unless explicitly justified:

- GKE topology changes
- API concurrency semantics
- OpenClaw queue/sandbox changes
- storage/quota algorithm changes

### 7. Production-readiness target model

The target state for this program is:

- free tier cannot destabilize shared infrastructure
- paid shared is comfortable but explicitly bounded
- paid isolated reduces blast radius materially
- quotas, rate limits, and concurrency degrade predictably
- capacity limits are known for `1000`, `3000`, and `5000` online users
- go/no-go decisions are based on measured evidence, not optimistic inference

## Consequences

### Positive

- Scaling work becomes a controlled program instead of an ad hoc sequence of fixes.
- Cursor-agent sessions can resume reliably from docs without reconstructing intent from chat history.
- Temporary rollout paths must either be removed or explicitly justified.
- Production-readiness claims become tied to concrete evidence and gates.

### Negative

- More documentation discipline is required before and after slices.
- Some fast tactical changes will need to wait until they fit a named slice.
- Temporary compatibility logic becomes more expensive to justify because it must carry a removal plan.

## Alternatives considered

- Keep scaling work distributed across `ROADMAP`, `SESSION-HANDOFF`, and ad hoc notes only (rejected: weak source-of-truth and high agent-context loss risk).
- Treat scaling as one broad refactor (rejected: too much scope, poor rollback, high drift risk).
- Leave rollout/deploy timing informal per session (rejected: makes attribution and rollback unreliable for infra/runtime work).
