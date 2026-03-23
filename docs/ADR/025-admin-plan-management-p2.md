# ADR-025: Admin plan management UI and API (Step 7 P2)

## Status

Accepted

## Context

P1 introduced canonical plan catalog and entitlement persistence, but plan packaging still required direct data edits.

P2 requires a serious admin control surface to create/edit plan metadata and commercial rules without exposing raw DB mechanics and without building billing-vendor workflow UI.

## Decision

1. Add owner-gated admin plan management API under `api/v1/admin/plans`:
   - `GET /api/v1/admin/plans`
   - `POST /api/v1/admin/plans`
   - `PATCH /api/v1/admin/plans/{code}`

2. Keep plan editing in one dedicated admin section in web `/app` (workspace owner only), not scattered across unrelated admin areas.

3. Expose useful admin controls (not raw DB fields):
   - plan naming/description/status
   - default-on-registration flag
   - trial flag + trial duration
   - entitlement controls for capabilities, tool classes, channels/surfaces, limits permissions
   - high-level provider-agnostic metadata (`commercialTag`, notes)

4. Keep billing provider workflow out of scope:
   - no checkout/subscription webhooks
   - no invoice/provider console fields
   - no vendor-specific coupling

## Consequences

### Positive

- Plan management becomes operable in-product with explicit admin actions.
- Catalog remains provider-agnostic and aligned with Step 7 boundaries.
- Existing assistant/runtime boundaries are preserved.

### Negative

- P2 does not include entitlement enforcement engine or quota accounting.
- Ownership guard is workspace-owner based, not full admin RBAC scope (deferred to Step 9).

## Out of scope (P2)

- billing provider UI/workflow
- subscription lifecycle state machine
- entitlement enforcement/rate/quota runtime engines
- admin-wide RBAC expansion
