# ADR-071: OpenClaw SaaS context and runtime optimization

## Status
Accepted

## Context
PersAI is preparing for a realistic `1000+` user SaaS baseline where token cost, long-thread latency, and background runtime noise matter as much as raw feature completeness.

The current architecture already establishes:

- PersAI as the control plane for policy, materialization, routing, quotas, and admin UX.
- OpenClaw as the execution plane for runtime turns, sessions, tools, and channel delivery.
- Tiered runtime topology through `ADR-063`.
- Scaling-readiness discipline through `ADR-070`.

However, the current runtime optimization story is still incomplete and too implicit:

- heartbeat behavior can appear noisy because operators see `HEARTBEAT.md`-driven work without one explicit PersAI-owned policy surface
- pool `openclaw.json` generation does not yet carry one clear baseline for heartbeat, context pruning, compaction, and OpenAI-specific tuning
- long-thread context economy is not yet a first-class SaaS control-plane concern
- admin runtime UI is provider-centric today and does not yet expose the optimization knobs operators need for polish
- bootstrap/persona budget is a tempting cost target, but cutting that first risks flattening assistant humanity before higher-leverage background/context waste is addressed

The repo also has a strict boundary rule in `AGENTS.md`: prefer PersAI-only fixes when the problem is control-plane, config generation, UI, deploy wiring, or product policy, and touch native OpenClaw core only when runtime execution behavior truly cannot be expressed through existing seams.

## Decision
PersAI will treat OpenClaw SaaS optimization as an explicit control-plane program with the following ordering and ownership rules.

### 1. Optimization order
The optimization order is:

1. heartbeat hygiene
2. context economy baseline
3. OpenAI runtime tuning policy
4. admin/runtime UI exposure
5. compaction suggestion UX
6. bootstrap budget pass only after the earlier wins land

This order is mandatory unless live evidence disproves it.

### Audit status note
Repository audit status as of `2026-04-09`:

- slices 1-4 are materially implemented through the intended PersAI control-plane path, although Helm/runtime-pool defaults still remain as a transitional baseline
- slice 5 currently keeps only the web compaction state/manual compact surface live; the temporary Telegram hint/manual `/compact` path was removed from the active product boundary and should return only after the shared Step 15 compaction capability exists
- the "cheaper compaction model path" in this ADR remains directional, not delivered, until PersAI exposes and verifies that policy path explicitly

### 2. Ownership boundary
PersAI owns:

- optimization policy and defaults by runtime tier
- materialization policy for `HEARTBEAT.md` and related bootstrap documents
- generated runtime config defaults in Helm/configmap generation
- admin/runtime API and UI controls
- product-level compaction suggestion UX
- rollout discipline, observability requirements, and verification

OpenClaw owns:

- actual heartbeat/session/tool execution semantics
- context pruning/compaction behavior once configured
- provider/runtime transport behavior
- channel/runtime delivery behavior

Native OpenClaw changes are allowed only when PersAI config/admin/materialization seams are insufficient for the required behavior or observability.

### 3. Humanity preservation rule
Persona and assistant feel are not the primary optimization budget.

The first cuts must target:

- unnecessary background turns
- long-thread context waste
- non-critical high-latency/high-cost provider defaults

Bootstrap/persona reduction is deferred until after those wins are measured.

### 4. Heartbeat policy rule
Heartbeat must become an explicit policy surface rather than an accidental side effect of default materialized text.

The control-plane baseline is:

- no active default `HEARTBEAT.md` work prompt when the assistant does not actually have task/reminder policy enabled
- explicit runtime defaults for interval, `lightContext`, and `isolatedSession`
- explicit reason-level observability for `interval`, `wake`, `hook`, `exec-event`, and `cron` sources before broad tuning claims are made

### 5. Context economy rule
Long-thread optimization should prefer pruning and compaction before bootstrap trimming.

The baseline direction is:

- tier-aware `contextPruning`
- tier-aware auto-compaction
- cheaper compaction model path where supported
- explicit user/admin-facing policy for when compaction is automatic, suggested, or manual

Current product policy clarification:

- web chat should prefer **manual** compaction UX over background threshold auto-compaction
- Telegram/multi-channel compaction UX should be reintroduced only as a shared runtime/tool capability after Step 15, not as a channel-specific slash-command seam

### 6. OpenAI tuning rule
OpenAI-specific knobs are policy-controlled by tier and use case, not globally enabled without distinction.

Baseline guidance:

- `fastMode` is preferred for heartbeat/background and other non-critical low-latency paths first
- `serviceTier` priority processing is reserved for premium or explicitly latency-critical paths
- `responsesServerCompaction` is the preferred long-thread optimization for direct OpenAI Responses models
- `openaiWsWarmup` is a transport optimization, not the primary SaaS cost lever

### 7. UI exposure rule
Important optimization controls should be exposed through the existing admin runtime surface as policy controls, not infrastructure details.

The UI should expose:

- heartbeat policy
- context pruning / compaction policy
- OpenAI tuning policy
- advanced bootstrap budgets only after the earlier slices prove necessary

The UI should not expose:

- pod names
- Kubernetes service names
- raw topology internals as product settings

## Consequences
### Positive
- Token and latency optimization becomes an explicit PersAI-owned program instead of scattered runtime folklore.
- The repo gets one honest order of operations that protects assistant humanity.
- Most changes stay in PersAI docs, config generation, materialization, contracts, and admin UX.
- Operators gain a path to tune runtime polish without hand-editing Helm forever.
- Native OpenClaw changes stay bounded and easier to justify.

### Negative
- This adds one more architectural document and one more policy layer that must stay synchronized with runtime plans and scaling-readiness docs.
- Some optimizations will intentionally wait behind docs-first alignment and bounded slices instead of being shipped ad hoc.
- The admin/runtime contracts will likely grow, which increases coordination cost across API, web, and generated contracts.

## Alternatives considered
- Cut bootstrap/persona first to reduce prompt size quickly.
  - Rejected because it risks visible quality loss before removing larger background and long-context waste.
- Put all optimization logic directly into native OpenClaw.
  - Rejected because most of the problem is policy, config propagation, materialization, and operator UX, which belong in PersAI.
- Keep optimization as informal notes in `OPENCLAW-SAAS-RUNTIME-PLAN.md` only.
  - Rejected because this is an architecture/policy decision that changes ownership, rollout order, and UI scope, so it needs its own ADR.
