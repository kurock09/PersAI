# ADR 030: Step 7 P7 plan visibility read models

Date: 2026-03-26
Status: Accepted

## Context

P1-P6 established plan catalog, entitlements, subscription state, capability resolution, quota accounting, and enforcement.
P7 requires this truth to be visible to users and admins in calm product language without exposing raw backend internals or building a billing console.

## Decision

Introduce dedicated read-model visibility endpoints:

- `GET /api/v1/assistant/plan-visibility` (user-facing)
- `GET /api/v1/admin/plans/visibility` (owner/admin-facing)

User-facing visibility model:

- effective plan identity and subscription state
- key commercial limits shown as percentages only:
  - token budget
  - cost-driving tool class usage
  - active web chats cap usage
- explicit tasks/reminders commercial-quota exclusion flag

Admin-facing visibility model:

- effective plan state and catalog state snapshot
  - effective plan code/display/status
  - default registration plan code
  - active/inactive plan counts
- usage pressure percentages for the same key dimensions
- derived pressure band (`low|elevated|high`)
- effective entitlement snapshot (tool classes, channels/surfaces, governed features)

Read models are resolved from existing control-plane services/repositories only:

- effective subscription resolution
- effective capability resolution
- plan catalog
- quota accounting state

## Consequences

Positive:

- users get clear plan/limit visibility without technical implementation details
- admins get practical pressure + entitlement visibility for governance decisions
- no duplicate business rules outside established plan/capability/quota boundaries

Intentional limits:

- no billing provider dashboard, invoices, or payment operations
- no per-tool catalog visibility in P7 (class-level remains sufficient)
- no historical BI/reporting timelines; snapshot visibility only
