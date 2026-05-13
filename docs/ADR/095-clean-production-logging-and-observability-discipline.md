# ADR-095: Clean production logging and observability discipline for a multi-user system

**Status:** Proposed  
**Date:** 2026-05-13  
**Relates to:** [ADR-070](070-scaling-readiness-program-and-clean-delivery-discipline.md) (clean delivery discipline), [ADR-091](091-production-grade-background-scheduler-architecture.md) (production-grade operational discipline), [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md) (evidence-first launch hardening)  
**Deploy truth:** [infra/dev/gitops/README.md](../../infra/dev/gitops/README.md), [infra/dev/gke/RUNBOOK.md](../../infra/dev/gke/RUNBOOK.md)

## Context

PersAI is now a real multi-user system with user-facing chat traffic, runtime fan-out, provider calls, background work, sandbox execution, admin surfaces, and cluster-level operational dependencies. Logging is no longer a developer convenience; it is part of the production control plane.

The current repository truth already has a good foundation:

- backend services use structured JSON logging through `@persai/logger` / pino
- `apps/api` emits bounded `request_completed` access-style lines
- runtime and provider-gateway already emit stream and turn traces
- Kubernetes stdout/stderr is the active transport path

But the current state is still operationally noisy for a scaled multi-user product:

1. **Success-path logs are too chatty** on hot paths.
2. **One logical turn can produce several info logs** across layers (`api`, `runtime`, `provider-gateway`).
3. **Health and readiness probes** still contribute to steady-state log volume.
4. **Observability responsibility is split unclearly** between logs, metrics, and targeted traces.
5. **Some services are not fully aligned** with the shared logger contract (notably sandbox).
6. There is **no explicit system-wide policy** for what is forbidden to log, what must be sampled, and what must move to metrics instead.

At low traffic, this is mostly an annoyance and cost issue. At higher traffic, it becomes a production risk:

- unnecessary CPU and I/O on hot paths
- unnecessary network and sink pressure for log shipping
- growing ingestion/storage/indexing cost
- lower operator signal-to-noise ratio
- possible backpressure if stdout or collector throughput becomes the bottleneck

This ADR is intentionally not "about one bug" or "about one service". It defines one clean production logging discipline for the active PersAI path.

## Goals

1. Make production logs **clean, bounded, and operator-useful**.
2. Ensure logging remains safe and comprehensible for a **multi-user** system under sustained concurrency.
3. Move routine observability away from log floods and toward **metrics first, traces second, logs third**.
4. Standardize service behavior so `api`, `runtime`, `provider-gateway`, and `sandbox` follow the same logging contract.

## Non-goals

- Replacing all existing observability in one unsafe "big bang" without validation.
- Turning off logs entirely.
- Hiding failures, retries, or user-visible incidents.
- Introducing long-lived transitional logging modes without a removal plan.

## Decision

### 1. Production logging policy becomes explicit system truth

PersAI adopts the following production rule:

> **Logs are for bounded, operator-relevant events. Metrics are for counting. Traces are for deep request debugging.**

Logs must not be used as the default mechanism for high-frequency traffic accounting.

### 2. One bounded success event per meaningful request/turn

For normal success paths:

- `apps/api` keeps **one** short structured completion event per meaningful external request
- `runtime` keeps **one** short structured event per meaningful execution/turn boundary
- `provider-gateway` keeps **one** short structured event per meaningful upstream call boundary
- inner-layer duplicate success chatter must be removed or downgraded behind trace-only or sampling rules

This means one logical user turn must not produce an uncontrolled cascade of repetitive `info` lines across multiple layers unless a trace flag or explicit sampling policy allows it.

### 3. Probe and infrastructure noise must not live at normal info level

The following must not generate routine `info` logs in production:

- `/health`
- `/ready`
- similar liveness/readiness probe traffic
- repetitive internal keepalive noise

These may be:

- excluded entirely from access-style logs, or
- emitted only at debug/trace during explicit troubleshooting

Cloud SQL sidecar structured logs remain infrastructure truth, but application-level policy must not add matching avoidable noise on top.

### 4. Payload-heavy logging is forbidden on hot paths

The following are forbidden in production success-path logs:

- full prompts
- full model outputs
- full retrieval chunks
- full tool payloads
- raw document text
- large request/response bodies
- unbounded query strings

Permitted fields are bounded metadata only:

- request or trace id
- assistant/workspace/user ids where needed
- route/method/status
- latency
- model/tool names
- counts
- sizes
- boolean or enum state
- short error/failure codes

If a field can grow with user content or document size, it must either be clipped by a strict limit or removed from normal logs.

### 5. Metrics-first observability for high-frequency operational truth

The following classes of information must move to metrics rather than repetitive logs:

- request count and status distribution
- latency distributions
- queue depth and scheduler throughput
- tool loop count
- retrieval hit/miss counts
- provider response timing
- stream first-byte / first-delta timing
- retry/fallback counters

Logs remain for:

- failures
- degradations
- unusual retries
- state transitions worth auditing
- sampled success exemplars

### 6. Tracing or trace-gated diagnostics for deep debugging

Detailed stream or turn internals are allowed only when one of these is true:

1. an explicit trace/debug flag is enabled for the request, or
2. the event is part of a bounded sampling strategy, or
3. the event represents an anomaly, timeout, retry, or failure

Deep stream diagnostics must not remain always-on `info` in production.

### 7. Unified service contract

The active path services must align on one contract:

- `api`
- `runtime`
- `provider-gateway`
- `sandbox`

Each must:

- honor `LOG_LEVEL`
- use the shared structured logger path
- follow the same bounded success/failure policy
- avoid service-specific ad hoc console noise

`sandbox` must be brought into the same logger bootstrap model as the other backend services so the Helm `LOG_LEVEL` truth actually matches runtime behavior.

### 8. Query-string and path hygiene

`request_completed` style logs must avoid unbounded `originalUrl` truth in production.

Decision:

- access-style logs use normalized route/path shape without raw query strings
- if query-derived fields are genuinely needed, they must be extracted into small bounded structured fields

### 9. Sampling policy

Production success-path logs may be sampled when frequency is high and value is repetitive.

Minimum policy:

- no sampling for errors/failures
- no sampling for critical state transitions
- allowed sampling for repetitive success path telemetry
- sampling ratios must be explicit and documented, not hidden magic numbers

### 10. Retention and sink policy are part of production readiness

Retention, exclusion, and sink strategy may live in platform tooling rather than this repository, but PersAI now treats them as **required production policy**, not an implicit afterthought.

At minimum, production operations must define:

- retention windows by log class
- exclusion/drop rules for probe noise
- index/ingest treatment for high-volume low-value lines
- cost ownership for application logs

## Required implementation phases

### Phase 1 — eliminate obvious noise and align contracts

1. Stop emitting routine probe logs at normal info level.
2. Normalize `request_completed` path shape to avoid raw query-string noise.
3. Reduce duplicated success logs across `runtime` and `provider-gateway`.
4. Align `sandbox` with the shared logger bootstrap.
5. Document the system-wide production logging policy in code comments where hot-path logs remain.

### Phase 2 — move hot-path observability to metrics

1. Ensure the key high-frequency operational truths are exposed as metrics.
2. Remove or downgrade redundant success-path log lines once metric parity exists.
3. Keep anomaly and failure logs intact.

### Phase 3 — trace/sampling hardening

1. Gate deep stream diagnostics behind trace/debug mode or bounded sampling.
2. Make sampling explicit in code and docs.
3. Ensure operator workflows can still debug one request end to end without reintroducing log spam.

### Phase 4 — production retention and sink review

1. Verify the actual sink policy in the deployed environment.
2. Exclude low-value repetitive logs.
3. Validate cost and operator readability against a multi-user workload.

## Forbidden patterns after ADR-095 implementation

The following patterns are forbidden unless explicitly documented as temporary and tied to a removal slice:

- repeated success logs for the same logical event across multiple layers
- full payload logging on user traffic paths
- probe logs at info
- query-string-heavy access logs
- ad hoc `console.log` or equivalent backend hot-path debug spam
- service-specific logger behavior that ignores the shared logging contract
- using logs as the primary mechanism for dashboards or counting

## Consequences

### Positive

- Lower steady-state log volume and cost
- Better operator signal-to-noise ratio
- Less risk of log-induced backpressure on hot paths
- Clearer service contract across the active PersAI path
- Better fit for a scaled multi-user system

### Negative

- Requires coordinated cleanup across several services
- Metrics and trace coverage must improve before some logs can be safely removed
- Some debugging habits must change; operators cannot rely on verbose always-on success logs

## Alternatives considered

- **Keep current logging and only raise infrastructure capacity** — rejected: this pays for noise and preserves unclear operational truth.
- **Turn logging down globally and hope for the best** — rejected: removes signal without replacing it with metrics/traces.
- **Per-service local cleanups without a global policy ADR** — rejected: leads to drift and inconsistent behavior across the system.
