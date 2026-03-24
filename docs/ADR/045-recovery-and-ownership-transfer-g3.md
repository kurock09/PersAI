# ADR 045: Recovery and Ownership Transfer Flows (Step 10 G3)

## Status

Accepted

## Context

Step 10 G3 requires explicit recovery and ownership transfer flows without collapsing semantics between:

- reset (assistant content lifecycle action)
- delete (destructive data removal action)
- ownership transfer/recovery (identity rebinding action)

The platform also needs support/admin-operated recovery paths that preserve existing audit/RBAC assumptions and keep ownership changes governed.

## Decision

Implement admin-governed ownership flows in `apps/api`:

- `POST /api/v1/admin/assistants/ownership/transfer`
- `POST /api/v1/admin/assistants/ownership/recover`

Both flows are modeled as dangerous admin actions with step-up:

- `admin.assistant.transfer_ownership`
- `admin.assistant.recover_ownership`

Dangerous-role requirement follows ops-tier controls (`ops_admin|super_admin`, with existing legacy owner fallback).

Guardrails:

- assistant must belong to admin workspace scope
- target owner must already be a member of the same workspace
- target owner must not already own another assistant under MVP one-user-one-assistant invariant
- transfer flow validates `currentOwnerUserId` match to prevent blind reassignment

Resource consequence policy is explicit and returned/audited:

- reset is not triggered
- deletion is not triggered
- lifecycle/published version history is preserved
- memory/chat/task ownership links rebind through assistant owner relation
- channel bindings and governance SecretRef metadata remain assistant-attached
- existing audit history remains immutable; ownership flow appends new audit events

Audit events:

- `assistant.ownership_transferred`
- `assistant.ownership_recovered`

## Consequences

Positive:

- ownership recovery and ownership transfer are explicit, governed, and step-up protected
- ownership boundary remains enforceable without introducing hidden reset/delete side effects
- attached resource behavior is deterministic and observable in API/audit payloads

Trade-offs / non-goals:

- no user self-service ownership transfer flow in G3
- no cross-workspace ownership migration in G3
- no automatic runtime publish/reset/reapply mutation is introduced by ownership flows
