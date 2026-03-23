# ADR-037: Append-only audit log hardening (Step 9 F1)

## Status
Accepted

## Context

Step 8 completed capability/binding/runtime-projection hardening, but there was no canonical append-only audit stream for critical control-plane and runtime transition truth.

Step 9 F1 requires traceability for high-value events without turning audit into a noisy raw event dump.

## Decision

1. Add canonical append-only audit persistence in backend control plane:
   - table: `assistant_audit_events`
   - immutable row policy enforced in DB (reject `UPDATE`/`DELETE` via trigger)

2. Keep audit scope explicit and high-signal only in F1. Write events for:
   - assistant lifecycle milestones:
     - `assistant.created`
     - `assistant.draft_updated`
     - `assistant.published`
     - `assistant.rollback_published`
     - `assistant.reset_published`
     - `assistant.reapply_requested`
   - runtime apply transitions:
     - `assistant.runtime.apply_in_progress`
     - `assistant.runtime.apply_succeeded`
     - `assistant.runtime.apply_failed`
     - `assistant.runtime.apply_degraded`
   - admin plan actions:
     - `admin.plan_created`
     - `admin.plan_updated`
   - policy/control changes:
     - `assistant.memory_forget_marker_appended`
   - channel binding and related secret-fingerprint changes:
     - `assistant.telegram_connected`
     - `assistant.telegram_config_updated`
     - `assistant.telegram_token_fingerprint_updated`

3. Keep payload practical for operators:
   - actor and target identifiers (`actorUserId`, `assistantId`, `workspaceId` when available)
   - normalized event category/code/outcome
   - concise summary
   - bounded JSON details

4. Keep architecture boundaries unchanged:
   - backend remains governance/control plane
   - OpenClaw remains behavior/runtime plane
   - no backend runtime routing expansion in F1

## Consequences

### Positive
- Critical lifecycle, runtime-transition, admin, policy, and binding actions are now traceable in an append-only store.
- Audit remains operationally useful by avoiding low-value chat/token delta dumps.

### Negative
- F1 does not yet expose a read/query API surface for audit data.
- Coverage is action-based; broad infra/runtime telemetry remains outside this slice.

## Out of scope (F1)
- Admin RBAC/step-up actions (F2).
- Ops/business cockpit read surfaces (F3/F4).
- Full secret lifecycle workflow and secret-value mutation APIs (Step 10 G1).
