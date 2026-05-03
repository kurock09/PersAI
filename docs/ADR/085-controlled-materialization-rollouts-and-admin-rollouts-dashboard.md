# ADR-085: Controlled materialization rollouts and Admin Rollouts dashboard

## Status

Accepted; implementation pending.

Current continuation state:

- **Purpose:** replace unsafe synchronous/global reapply behavior and the obsolete JSON governance rollout UI with a production materialization rollout dashboard.
- **Production posture:** `/admin/rollouts` is an operational dashboard for controlled materialization and runtime config propagation, not a generic JSON patch editor.
- **Do not preserve:** the old `Admin > Rollouts` JSON governance patch workflow is retired from the active product path.
- **Relationship to billing:** ADR-083/ADR-084 immediate activation must use this controlled rollout/materialization mechanism instead of all-at-once reapply or unbounded lazy rematerialization.

## Date

2026-05-03

## Relates to

ADR-042, ADR-050, ADR-078, ADR-082, ADR-083, ADR-084

## Context

PersAI currently has two separate operational mechanisms that are no longer enough for production scale:

1. `Admin > Rollouts` from ADR-042: a JSON `assistant_governance` patch rollout with percentage targeting and rollback.
2. `Force reapply all`: a synchronous admin action under runtime/admin APIs that loops through all assistants and reapplies their latest published version.

The founder has not used the old JSON governance patch rollout and does not want to carry it as active product truth. It is a technical artifact from an earlier migration/control-plane phase.

The production problem is broader than billing. Any global change can require many assistants to receive a fresh materialized runtime bundle:

- plan/tariff changes
- system prompt and Prompt Constructor changes
- runtime provider/model settings
- tool policy changes
- Skill/Knowledge access policy changes
- sandbox/worker tool policy changes
- billing lifecycle changes from ADR-083/ADR-084
- manual operator reapply

The current lazy rematerialization model is useful for correctness, but it can create a stampede. If 1,000+ users become active after a global generation bump, the first user turns may all try to rematerialize and warm runtime bundles at once. A synchronous `Reapply all` has the opposite problem: it can block or overload API/runtime by trying to process everything immediately.

The needed product is not a JSON patch tool. It is an admin-visible operational dashboard that answers:

- what changed
- why materialization is running
- how many assistants/workspaces are affected
- how much is pending/running/succeeded/failed/skipped
- which items failed and why
- whether retry/cancel is needed
- whether next turns are using fresh enough truth

## Decision

PersAI will introduce controlled materialization rollouts as first-class operational truth.

Core decisions:

1. Retire the old `/admin/rollouts` JSON governance patch UI from the active product path.
2. Reuse `/admin/rollouts` as the system rollout dashboard for materialization/config propagation.
3. Replace synchronous `Force reapply all` with a `manual_reapply` materialization rollout job.
4. Automatically create materialization rollout jobs when global changes require broad runtime/config propagation.
5. Process rollout items through a bounded queue with concurrency limits, rate limits, retries, backoff, and per-assistant locking.
6. Keep the next-turn freshness gate, but prevent it from becoming an unbounded lazy rematerialization stampede.
7. Preserve auditability and admin visibility for every rollout reason and item outcome.

The target invariant is:

```text
global/system change
-> config generation bump
-> scoped materialization rollout job
-> controlled queue processing
-> runtime bundle warmup
-> next turn uses fresh-enough truth or a clear activation state
```

## Product semantics

### Admin Rollouts

`Admin > Rollouts` becomes a dashboard/control center.

It should show:

- rollout reason
- trigger source: admin, system, billing lifecycle, provider settings, plan settings, prompt settings
- target config generation
- scope
- total items
- pending/running/succeeded/failed/skipped/cancelled counts
- progress bar
- started by
- started at / updated at / finished at
- current concurrency/rate-limit state when useful
- failed items with error code/message
- retry failed
- cancel pending

It should not expose the old raw JSON governance patch editor as active UI.

### Rollout types

Initial rollout types:

- `manual_reapply`
- `plan_change`
- `system_prompt_change`
- `runtime_provider_settings_change`
- `tool_policy_change`
- `skill_policy_change`
- `billing_lifecycle_change`
- `single_assistant_reapply`

The exact enum can evolve, but rollout type must be explicit and visible. Operators should not need to infer the cause from raw JSON.

### Scope

Rollout scope is explicit:

- all published assistants
- one assistant
- assistants/workspaces on a specific effective plan
- assistants using a provider/model profile
- recent-active assistants first
- affected assistants computed from a specific changed policy

Cold/inactive assistants do not need immediate warmup unless the change is hard critical. They can remain queued or be materialized on first use through the same controlled path.

### Criticality

Rollouts carry criticality:

- `hard`: paid access, paid limits, tool access, security, provider secret access, billing lifecycle access changes
- `soft`: system prompt/copy/routing hints where brief old-bundle use may be acceptable
- `maintenance`: manual/admin reapply, cleanup, non-user-facing refresh

Hard-critical changes must not allow the next paid-sensitive turn to proceed with stale plan/tool/security truth. The turn may wait briefly, enqueue/boost its rollout item, or return a clear "settings are activating" state.

Soft changes should still be queued and visible, but should not overload the system by forcing all inactive assistants to refresh instantly.

## Queue and worker semantics

Materialization rollout processing should be queue-based.

Each rollout item should include:

- rollout id
- assistant id
- workspace id
- user id when applicable
- target generation
- rollout type
- criticality
- priority
- status: `pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled`
- attempts
- next retry time
- last error code/message
- started/finished timestamps
- resulting materialized spec id/content hash/bundle hash when available

Workers must enforce:

- global concurrency limit
- per-assistant lock
- retry with backoff
- idempotency by `(assistantId, targetGeneration, rolloutType/scope key)` or equivalent
- skip when a fresh-enough materialized spec already exists
- no all-at-once synchronous loops over every assistant in request/response path

Runtime bundle warmup should also be controlled. Warming recent/active assistants first is preferable to instantly warming every cold assistant.

## Next-turn freshness gate

The existing `EnsureAssistantMaterializedSpecCurrentService` style of freshness check remains valuable, but target behavior changes:

1. If the assistant already has a fresh-enough spec, use it.
2. If a rollout item is pending/running, the turn may wait briefly within a bounded timeout.
3. If the change is hard critical and freshness is still missing, block or return a clear activation/retry state.
4. If the change is soft and the current spec is acceptable, the turn may proceed while the rollout remains visible.
5. The turn path may enqueue or boost a missing item, but must not start an unbounded materialization storm.

## Data model direction

The old `AssistantPlatformRollout` tables were designed for JSON governance patch rollout. They may be replaced, migrated, or renamed during implementation. They must not remain the product truth if doing so keeps obsolete JSON patch semantics alive.

Target persisted concepts:

### Materialization rollout

- id
- rollout type
- trigger source
- target generation
- scope type and scope metadata
- criticality
- status
- total/pending/running/succeeded/failed/skipped/cancelled counts
- concurrency/rate-limit settings snapshot
- created by user id when admin-triggered
- created/updated/finished timestamps

### Materialization rollout item

- rollout id
- assistant id
- workspace id
- user id when applicable
- target generation
- priority
- status
- attempts
- next retry at
- last error code/message
- materialized spec id/content hash/bundle hash
- started/finished timestamps

### Audit events

Audit events should capture:

- rollout created
- rollout item failed
- rollout completed
- rollout cancelled
- retry failed items
- manual reapply requested

## API and UI direction

### API

Add or replace admin APIs for:

- list materialization rollouts
- create manual rollout (`manual_reapply`, single assistant, affected scope)
- cancel pending rollout
- retry failed items
- inspect failed items
- read rollout queue status

Global config-changing services should create rollout jobs automatically after generation bump when the change affects materialized runtime truth.

### UI

`/admin/rollouts` should be redesigned around operational status:

- top summary cards: active, failed, recently completed
- progress bars per rollout
- clear reason/source labels
- affected scope
- target generation
- failed item drawer
- retry/cancel controls
- manual `Reapply all` / `Reapply selected scope` actions as queued jobs

No raw JSON governance patch text area should remain in the active product UI.

## Implementation plan and status

Implement in production-grade slices.

| Slice                                                   | Status    | Purpose                                                                                            | Main affected areas                                                                    | Completion criteria                                                                                                                                             |
| ------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ADR and product decision                             | Completed | Retire old JSON rollout product truth and lock the target controlled materialization dashboard.    | `docs/ADR/085-*`, handoff, changelog                                                   | ADR accepted; old JSON governance rollout UI is explicitly out of active product scope.                                                                         |
| 2. Data model and service boundary                      | Pending   | Add first-class materialization rollout/job concepts.                                              | Prisma schema, repositories, rollout services, audit events                            | Rollouts/items can be created, listed, marked running/succeeded/failed/skipped/cancelled, and associated with target generation and reason.                     |
| 3. Controlled worker and queue semantics                | Pending   | Process materialization jobs safely.                                                               | API workers/scheduler, materialization service, runtime bundle warmup                  | Queue uses concurrency limits, per-assistant locks, retry/backoff, idempotency, skip-if-fresh, and does not run all assistants synchronously in request path.   |
| 4. Automatic rollout creation from global config change | Pending   | Replace hidden lazy-storm behavior with visible system rollouts.                                   | Admin Plans, Runtime settings, prompt/system config, tool/Skill policy writers         | Global changes bump generation and create scoped rollout jobs with reason/scope/criticality.                                                                    |
| 5. Admin Rollouts dashboard replacement                 | Pending   | Replace old JSON patch UI with operational rollout dashboard.                                      | `apps/web/app/admin/rollouts`, admin APIs/contracts                                    | Dashboard shows active/completed rollouts, progress bars, statuses, failed items, retry/cancel, and manual reapply as queued jobs.                              |
| 6. Next-turn freshness gate                             | Pending   | Prevent stale hard-critical turns without causing stampedes.                                       | inbound runtime context, materialization freshness checks, runtime error/copy handling | Hard-critical stale state blocks/waits/activates clearly; soft changes can proceed when allowed; turn path can enqueue/boost but not unboundedly rematerialize. |
| 7. Remove obsolete legacy paths                         | Pending   | Delete old active JSON governance rollout and synchronous force-reapply-all product paths cleanly. | old rollout services/controllers/contracts/UI, runtime admin endpoint                  | No active UI/API exposes raw JSON governance patch rollout or synchronous all-assistant reapply as product behavior; migrations/docs explain replacement.       |

### Execution rules

- Start implementation with a code audit of the current rollout, reapply, materialization, generation bump, runtime freshness, and admin UI paths before changing behavior.
- Do not parallelize old and new product behavior. Implement one coherent production path, then remove obsolete active paths.
- Do not ship an intermediate "both systems are product truth" state.
- Do not keep the old JSON governance patch UI as an active product path.
- Do not keep synchronous `Force reapply all` as the normal production mechanism.
- Do not create unbounded lazy rematerialization storms from user turns.
- Do not make billing-specific rollout logic separate from the system materialization rollout pipeline.
- Do not hide materialization progress from admins.
- Do not hard-code rollout scope decisions when the changed entity can determine affected assistants/workspaces.
- Keep rollback semantics only where a real rollback truth exists; materialization refresh jobs are usually retry/cancel/replace, not semantic rollback.

### Prompt for a future implementation session

```text
Continue PersAI control-plane hardening from ADR-085.

Read before coding:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/085-controlled-materialization-rollouts-and-admin-rollouts-dashboard.md
5. docs/ADR/083-subscription-lifecycle-trial-fallback-and-billing-ops.md
6. docs/ADR/084-billing-provider-readiness-pricing-checkout-and-payment-tools.md
7. docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md
8. docs/ARCHITECTURE.md
9. docs/API-BOUNDARY.md
10. docs/DATA-MODEL.md
11. docs/TEST-PLAN.md

Current active ADR-085 slice should be chosen from the Implementation plan and status table.

Mandatory first step:
- audit existing rollout/reapply/materialization/generation-bump/runtime-freshness/admin-rollouts code paths before implementation
- identify every active old JSON governance rollout and synchronous reapply entry point
- produce a short implementation map before editing code

Production rules:
- build one production-grade controlled materialization rollout path, not a temporary hybrid
- do not parallelize old JSON rollout product behavior with the new materialization dashboard
- remove the old Admin Rollouts JSON governance patch workflow from active product truth
- turn Reapply all into a controlled queued materialization rollout, not a synchronous loop
- automatic global changes must create visible rollout jobs
- use concurrency/rate limits, per-assistant locks, retry/backoff, and skip-if-fresh
- Admin Rollouts must be a dashboard for what is happening, why, progress, failures, and retry/cancel
- billing lifecycle/materialization from ADR-083/084 must reuse this system pipeline

Before ending:
- run focused checks for changed code
- run AGENTS verification gates when code/contracts changed
- update docs/SESSION-HANDOFF.md and docs/CHANGELOG.md
- state the next recommended ADR-085 slice
```

## Verification requirements

Focused checks should prove:

1. Old JSON governance rollout UI is not exposed in active `/admin/rollouts`.
2. Manual Reapply all creates a queued rollout job rather than synchronously applying every assistant.
3. Plan/runtime/system prompt changes create automatic scoped rollout jobs after generation bump.
4. Rollout workers respect concurrency limits and per-assistant locking.
5. Fresh-enough items are skipped idempotently.
6. Failed items are visible and retryable.
7. Admin dashboard shows progress and item outcomes.
8. Hard-critical stale turns do not proceed with stale paid/tool/security truth.
9. Soft changes do not create a user-turn materialization stampede.
10. Audit events exist for admin/system rollout actions.

## Non-goals

- No preservation of the old JSON governance patch editor as active product UX.
- No billing provider/payment implementation in this ADR.
- No replacement of ADR-083 lifecycle policy.
- No ordinary-user rollout UI.
- No all-at-once synchronous reapply for production use.

## Consequences

### Positive

- Admins can see what is happening after global changes.
- Materialization becomes safe for 1,000+ users.
- Billing activation, plan changes, system prompt changes, and runtime settings share one propagation mechanism.
- Manual Reapply all becomes safe and observable.
- Runtime/user-turn latency is protected from lazy rematerialization storms.

### Negative

- Requires new queue/persistence/worker semantics.
- `/admin/rollouts` must be redesigned instead of patched.
- Existing ADR-042 rollout code becomes legacy and needs clean removal or migration.
- Some changes may show "activating" briefly instead of pretending they are instantly complete.

## Current code audit notes

Current implementation observations that this ADR intentionally changes:

- `apps/web/app/admin/rollouts/page.tsx` is still a JSON `targetPatch` editor for old governance patch rollout.
- `ManagePlatformRolloutsService` synchronously applies JSON patches to targeted assistants and calls `ApplyAssistantPublishedVersionService` inline.
- `ForceReapplyAllService` synchronously bumps generation and loops through all assistants.
- `EnsureAssistantMaterializedSpecCurrentService` can lazily refresh stale materialized specs, but it is not a bounded rollout queue.
- Runtime can request a fresh spec and warm a bundle, but this is still reactive and not an admin-visible materialization rollout pipeline.
