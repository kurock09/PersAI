# ADR-091: Production-Grade Background Scheduler Architecture

**Status:** Proposed  
**Date:** 2026-05-10  
**Relates to:** ADR-074 (Slice M2 background compaction), ADR-088 (Unified Notification Platform), ADR-090 (Idle Re-Engagement Prod Hardening)  
**Supersedes (operationally, not by deletion):** ADR-090 §1 (`pg_try_advisory_xact_lock` held across runtime HTTP) — keep ADR-090 as the historical fix; this ADR replaces the locking pattern with a lease-based model.

## Context

PersAI runs four polling background schedulers in `apps/api`:

| Scheduler | Service | Tick | Batch | Drain-loop | Workload character |
|---|---|---|---|---|---|
| Idle re-engagement | `PersaiIdleReengagementSchedulerService` | 15 min | 12 | **NO** | LLM call per candidate (~30–60s each) |
| Background tasks (reminders) | `PersaiBackgroundTaskSchedulerService` | 5 sec | 8 | YES | LLM call per due task |
| Background compaction | `PersaiBackgroundCompactionSchedulerService` | 5 sec | 8 | YES | LLM call only when token threshold exceeded |
| Media jobs | `AssistantMediaJobSchedulerService` | 5 sec | 4 | YES | Direct provider call (image / video gen) |

ADR-090 hardened the first three by wrapping each `tick()` in a Postgres `$transaction` and using `pg_try_advisory_xact_lock` for single-leader semantics. The transaction stays open for the entire drain pass — including outbound HTTP to the runtime LLM. This is **safe and correct** but pins one Prisma pool connection per leader for up to 10 minutes per tick. At 1000+ users this becomes a real operational risk:

- During provider degradation (slow OpenAI), each pinned scheduler connection is held until its own internal HTTP timeout expires.
- All three locked schedulers can pin connections simultaneously on the same pod.
- Pool starvation cascades to user-facing API requests on the same API pod.

Additionally:

- **Idle scheduler** has no drain-loop, processing at most 12 candidates per 15-minute tick. At 1000 users with synchronized idle waves (e.g. evening-to-morning), backlog drains in 5+ hours, sending re-engagement messages with multi-hour latency.
- **Media jobs scheduler** has no single-leader guard at all (relies solely on `FOR UPDATE SKIP LOCKED`). Correct under normal conditions but inconsistent with the pattern used by the other three schedulers — operators cannot reason about scheduler behavior uniformly.
- **No scheduler observability**: no metric for tick duration, candidates/min, lease holder identity, or pool-pinning duration.
- **Pool sizing is implicit** (Prisma default ≈ `cpu_count × 2 + 1`) and not documented anywhere.

This ADR delivers a single, clean, production-grade architecture across all four schedulers. **No transitional modes. No `pg_try_advisory_xact_lock`-in-transaction code path remains.** All four schedulers use the same lease-based pattern; pool connections are released the moment lease acquisition commits.

## Decision

### A. Universal lease-based single-leader pattern (all four schedulers)

Introduce a new shared infrastructure piece: `SchedulerLeaseService`.

#### Data model

A new Prisma model `SchedulerLease` (single row per scheduler kind). Pattern follows existing `AssistantWorkspaceLease`:

```prisma
model SchedulerLease {
  /// Stable scheduler identifier — one row per scheduler kind. Examples:
  /// "idle_reengagement", "background_task", "background_compaction", "media_job".
  schedulerKey  String    @id @map("scheduler_key") @db.VarChar(64)
  /// Pod-unique holder id (e.g. process uuid + pod name). Used to validate
  /// heartbeat updates so a stale leader cannot extend an expired lease.
  holderId      String    @map("holder_id") @db.VarChar(255)
  /// Random per-acquisition token. The leader checks this token on every
  /// heartbeat / release; another pod that took over after expiry uses a new
  /// token and the previous leader's heartbeat will silently fail.
  leaseToken    String    @map("lease_token") @db.VarChar(128)
  /// Hard deadline. After this point any pod may acquire the lease.
  expiresAt     DateTime  @map("expires_at") @db.Timestamptz(6)
  /// Last time the leader confirmed it is still alive.
  lastHeartbeat DateTime  @map("last_heartbeat") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([expiresAt])
  @@map("scheduler_leases")
}
```

#### Lease lifecycle

```
acquire():
  short tx (< 50 ms total, no HTTP):
    UPDATE scheduler_leases
       SET holder_id = :selfId, lease_token = :newToken,
           expires_at = NOW() + :ttl, last_heartbeat = NOW()
     WHERE scheduler_key = :key
       AND (expires_at < NOW() OR holder_id IS NULL)
     RETURNING lease_token;
  -- If returning row exists → we are leader.
  -- If no row updated → another leader is alive; this tick exits.
  -- INSERT ON CONFLICT DO NOTHING runs once on first ever boot to seed the row.

heartbeat(token):
  UPDATE scheduler_leases
     SET expires_at = NOW() + :ttl, last_heartbeat = NOW()
   WHERE scheduler_key = :key AND lease_token = :token;
  -- If 0 rows updated → another pod took over; current leader must abort.

release(token):
  UPDATE scheduler_leases
     SET expires_at = NOW(), holder_id = NULL
   WHERE scheduler_key = :key AND lease_token = :token;
  -- Idempotent. Always called in finally.
```

#### Tick shape (applies to all four schedulers)

```
tick():
  if !await acquire():
    return
  let token = currentToken
  let heartbeat = setInterval(
    () => heartbeat(token).catch(abortDrain),
    LEASE_HEARTBEAT_INTERVAL_MS
  )
  try:
    drainLoop()  // <-- NO outer DB transaction. Each candidate processed in its own short tx.
  finally:
    clearInterval(heartbeat)
    await release(token)
    scheduleNext()
```

#### Why this is strictly better than `pg_try_advisory_xact_lock`-in-tx

1. No DB connection is pinned during outbound HTTP. Pool stays warm for user traffic.
2. Lease TTL bounds leader-failure recovery time deterministically (`LEASE_TTL_MS = 90_000` — see §G).
3. Operators see lease state directly in `scheduler_leases` (who holds, since when, when expires) — no opaque `pg_locks` introspection.
4. Heartbeat is a 1-row index-targeted UPDATE — measurable cost ≈ 1 ms.

#### Constants (per scheduler kind, no magic numbers)

```
LEASE_TTL_MS = 90_000               // hard expiry; survives single missed heartbeat
LEASE_HEARTBEAT_INTERVAL_MS = 20_000 // 4× safety margin vs TTL
LEASE_ACQUIRE_TIMEOUT_MS = 5_000     // refuse to wait longer to acquire
```

### B. Idle scheduler throughput

After §A is in place, the idle scheduler also gets:

- **Drain-loop** identical in shape to background-task and compaction schedulers: keep claiming batches until `count < BATCH_SIZE`.
- **`IDLE_REENGAGEMENT_BATCH_SIZE` raised from 12 → 24.** The batch is no longer the throughput cap (drain-loop is), but a single tick should still be able to clear a typical evening idle wave on a single drain pass.
- **`IDLE_REENGAGEMENT_POLL_INTERVAL_MS` reduced from 15 min → 5 min.** With drain-loop and lease-based locking the cost of an empty tick is negligible (a single advisory-style UPDATE). 5 min gives the system at least 12 attempts to drain the queue per hour.

These three together raise theoretical idle throughput from ~1 152/day to ~14 000/day with no LLM-call increase per user (still capped by `MAX_ATTEMPTS = 2` per idle window).

> **Out of scope for this ADR (intentionally separated):** the inherited `findDueCandidates` SQL bug — `assistant.findMany({ where: {}, orderBy: updatedAt asc, take: 12 })` — that loads globally-oldest assistants regardless of idle status. This is a pre-ADR-090 footgun and is being fixed in a **separate** session immediately after this ADR lands so the diff is small and reviewable. After both this ADR and that fix land, the idle scheduler is fully correct and scalable.

### C. Media jobs scheduler — single-leader parity

`AssistantMediaJobSchedulerService` is migrated to the same lease pattern (§A). `FOR UPDATE SKIP LOCKED` in `claimDueJobs` is **kept** as the second line of defence (correct for parallel workers within a leader's drain pass; defensive against a misconfiguration where the lease pattern is bypassed during a deploy). All four schedulers now use exactly the same control-plane shape, so operators reason about them uniformly.

### D. No transitional modes

When this ADR lands:

- All `pg_try_advisory_xact_lock` call sites are deleted from the four scheduler files. No `if (FEATURE_FLAG)` branches.
- All `BACKGROUND_*_SCHEDULER_LOCK_ID` constants are deleted.
- The pool-vs-HTTP trade-off comment blocks added to ADR-090 are deleted (superseded by §A in this ADR).
- The outer `$transaction(async (tx) => …, { timeout: SCHEDULER_TICK_TRANSACTION_TIMEOUT_MS })` wrappers in all four schedulers are deleted. Per-candidate transactions inside `processClaimedX` remain (they are short and correct).
- A single Prisma migration adds `SchedulerLease` and seeds four rows (one per scheduler kind) with `expires_at = NOW()` so the first pod to boot acquires immediately.

### E. Observability

A new `BackgroundSchedulerMetricsService` exposes the following per scheduler kind:

| Metric | Type | Description |
|---|---|---|
| `scheduler_tick_total` | counter | total ticks attempted |
| `scheduler_tick_acquired_total` | counter | ticks where lease was acquired (= leader chosen) |
| `scheduler_tick_skipped_total` | counter | ticks where another pod was leader |
| `scheduler_tick_duration_ms` | histogram | leader's tick duration end-to-end |
| `scheduler_drain_candidates_total` | counter | candidates processed (success + failure) |
| `scheduler_lease_lost_total` | counter | heartbeat failed → drain aborted |
| `scheduler_lease_expired_recovered_total` | counter | another pod recovered an expired lease |

Metrics are exposed via the existing health-controller surface (no new endpoint type). Cloud Logging structured logs already cover per-event detail; this is for at-a-glance health.

### F. Pool sizing — explicit, documented

`apps/api`'s Prisma datasource URL must include `connection_limit` based on the deployed pod CPU count. Documented constant:

```
CONNECTIONS_PER_POD = max(10, cpu_count × 4)
```

Rationale (post §A there is **no scheduler-pinned connection budget** to subtract):
- 4 schedulers × ≤ 1 short-lived UPDATE per heartbeat (every 20 s) ≈ negligible
- User-facing API traffic + read-heavy admin traffic dominates the pool

Documented in `docs/ARCHITECTURE.md` under "Database connection pool sizing" (new subsection). Deploy manifest (`infra/dev/gke/`) gets an explicit `PRISMA_CONNECTION_LIMIT` env var so ops can tune without code changes.

### G. Failure model — explicit and testable

| Failure | Behavior |
|---|---|
| Leader pod hard-crashes mid-drain | Lease expires after `LEASE_TTL_MS` (90 s); next tick on any pod acquires; in-flight per-candidate work was per-candidate-tx so no row is left in inconsistent state. |
| Leader pod loses DB connectivity for > 1 heartbeat | Heartbeat UPDATE returns 0 rows → drain aborts; the partially-processed candidates (each in its own tx) keep their results; remaining candidates wait for next leader. |
| Leader pod's network to OpenAI hangs | Per-candidate HTTP timeout (already configured per client) fires; that candidate is marked failed/deferred per existing rules; drain continues; lease unaffected. |
| Two pods think they are leader (clock skew + missed heartbeat) | Lease-token check on heartbeat means at most one pod gets `1 row updated` and continues; the other's next heartbeat fails and it aborts. |
| Lease row missing (e.g. wiped manually) | Acquire path's `UPDATE … WHERE expires_at < NOW() OR holder_id IS NULL` returns 0 rows → tick exits silently. The seed migration plus boot-time `INSERT … ON CONFLICT DO NOTHING` guards re-create the row. |

## Out of scope

- The `findDueCandidates` qualification SQL bug — separate session immediately after this ADR.
- LLM cost / behavioral changes inside any scheduler's processing logic.
- Sandbox / `AssistantWorkspaceLease` semantics — unchanged.
- Idempotency of compaction `superseded` semantics — unchanged.
- Notification delivery worker (different control plane).

## Execution plan (sessions for sonnet 4.6 agents)

Three sessions. Each one is a coherent reviewable unit, not micro-fragments.

### Session 1 — `lease-foundation`

- Prisma migration + `SchedulerLease` model.
- New module `BackgroundSchedulerInfrastructureModule`.
- New service `SchedulerLeaseService` with `acquire / heartbeat / release` and unit tests covering all 5 scenarios in §G.
- New service `BackgroundSchedulerMetricsService` (counters + histograms; no-op exporter behind a small interface so tests can assert recorded values).
- Constants (`LEASE_TTL_MS`, `LEASE_HEARTBEAT_INTERVAL_MS`, `LEASE_ACQUIRE_TIMEOUT_MS`) defined once in `scheduler-lease.constants.ts` and imported.
- `docs/ARCHITECTURE.md` "Database connection pool sizing" subsection.
- Verification gate: full lint / format:check / API typecheck / API test.

**Deliverable:** infrastructure ready; no scheduler touched yet.

### Session 2 — `apply-lease-to-all-four`

- Refactor `PersaiIdleReengagementSchedulerService`: drop `pg_try_advisory_xact_lock` and outer `$transaction`; use `SchedulerLeaseService`; add drain-loop; raise `IDLE_REENGAGEMENT_BATCH_SIZE` to 24; reduce `IDLE_REENGAGEMENT_POLL_INTERVAL_MS` to 5 min.
- Refactor `PersaiBackgroundTaskSchedulerService`: drop `pg_try_advisory_xact_lock` and outer `$transaction`; use `SchedulerLeaseService`. Drain-loop and per-candidate transactions stay.
- Refactor `PersaiBackgroundCompactionSchedulerService`: drop `pg_try_advisory_xact_lock` and outer `$transaction`; use `SchedulerLeaseService`.
- Refactor `AssistantMediaJobSchedulerService`: add `SchedulerLeaseService` (was previously bare `FOR UPDATE SKIP LOCKED`).
- Wire `BackgroundSchedulerMetricsService` into all four `tick()` paths.
- Update existing unit tests that asserted advisory-lock query strings.
- New tests: per-scheduler "lease lost mid-drain → drain aborts" and "another pod is leader → tick exits silently".
- Verification gate: full lint / format:check / API typecheck / runtime typecheck / full API test suite.

**Deliverable:** all four schedulers on the unified pattern. Production-deployable.

### Session 3 — `mandatory-final-audit`

> **This session is mandatory. The ADR is not considered shipped until this session passes.**

Three independent readonly subagents run in parallel, each focused on a different surface area. Each must explicitly answer:

1. **Code-cleanliness audit**
   - Is there any leftover `pg_advisory` reference, `BACKGROUND_*_SCHEDULER_LOCK_ID` constant, or pool-vs-HTTP comment block? (Must be: no.)
   - Are all magic numbers in scheduler files extracted to named constants?
   - Are heartbeat / acquire / release call sites identical in shape across all four schedulers (no copy-paste drift)?
   - Is every outer `$transaction(...)` wrapping HTTP calls gone?
   - Is every `tick()` `catch` block logging the stack?

2. **Inherited-bug sweep** (this is the user-mandated permanent step)
   - Find any `findMany({ where: {} })` or comparable wide-net query in scheduler files. (User-flagged the existing one; we must hunt for any others.)
   - Find any N+1 query pattern in candidate qualification.
   - Find any in-JS filtering that should have been a SQL `WHERE` clause.
   - Find any candidate-selection ordering that depends on a non-deterministic column (e.g. `updatedAt` of a parent that doesn't change when relevant state changes).
   - Find any assumption that two pods cannot enter the same code path at the same time without explicit lease/lock.

3. **Failure-model audit**
   - Verify the 5 scenarios in §G are covered by at least one explicit test.
   - Verify lease state is observable in `scheduler_leases` and metrics — operators do not need to read source code to diagnose a stuck scheduler.
   - Verify pool sizing doc in `ARCHITECTURE.md` matches the env var default in deploy manifests.

Findings are tracked as ADR-091 follow-ups. **Critical findings (correctness bugs, leftover legacy references, missing tests for §G scenarios) block release.** Quality findings are addressed in the same session unless explicitly deferred with a noted reason.

**Deliverable:** production sign-off. Update `docs/CHANGELOG.md` with audit findings summary, `docs/SESSION-HANDOFF.md` with completion record, this ADR's status moves `Proposed → Accepted`.

## Consequences

### Positive

- Pool connection pinning during HTTP eliminated. User-facing API latency stays flat under provider degradation.
- Idle backlog drains in minutes, not hours, even under synchronized idle waves.
- All four schedulers use the same control plane — operators learn once.
- Failure modes are explicit and testable.
- Future scheduler additions reuse `SchedulerLeaseService` directly.

### Negative

- One additional Prisma model + migration + service + module (worth it; it is the central control plane).
- Lease TTL means absolute worst-case leader-failure recovery is `LEASE_TTL_MS = 90 s` (acceptable; the previous `pg_try_advisory_xact_lock` was instantaneous on commit but had the much larger pool-pinning downside).

### Neutral

- ADR-090's locking decision is now historical. ADR-090 stays in `docs/ADR/` as the record of the immediate fix that stopped the spam; this ADR is the long-term architecture.

## Files changed (planned)

- `docs/ADR/091-production-grade-background-scheduler-architecture.md` (this file)
- `docs/ARCHITECTURE.md` (new "Database connection pool sizing" subsection)
- `apps/api/prisma/schema.prisma` (`SchedulerLease` model)
- `apps/api/prisma/migrations/<timestamp>_adr091_scheduler_leases/migration.sql`
- `apps/api/src/modules/workspace-management/application/scheduler-lease.service.ts` (new)
- `apps/api/src/modules/workspace-management/application/scheduler-lease.constants.ts` (new)
- `apps/api/src/modules/workspace-management/application/background-scheduler-metrics.service.ts` (new)
- `apps/api/src/modules/workspace-management/application/persai-idle-reengagement-scheduler.service.ts` (refactor)
- `apps/api/src/modules/workspace-management/application/persai-background-task-scheduler.service.ts` (refactor)
- `apps/api/src/modules/workspace-management/application/persai-background-compaction-scheduler.service.ts` (refactor)
- `apps/api/src/modules/workspace-management/application/assistant-media-job-scheduler.service.ts` (refactor)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` (provider wiring)
- `apps/api/test/scheduler-lease.service.test.ts` (new)
- `apps/api/test/background-scheduler-metrics.service.test.ts` (new)
- `apps/api/test/persai-idle-reengagement-scheduler.service.test.ts` (lease-aware rewrite)
- `apps/api/test/persai-background-task-scheduler.service.test.ts` (lease-aware rewrite)
- `apps/api/test/persai-background-compaction-scheduler.service.test.ts` (lease-aware rewrite)
- `apps/api/test/assistant-media-job-scheduler.service.test.ts` (lease-aware rewrite)
- `infra/dev/gke/` deploy manifest (add `PRISMA_CONNECTION_LIMIT` env var)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`
