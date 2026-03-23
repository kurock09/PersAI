# ADR-026: Subscription state and billing abstraction boundary (Step 7 P3)

## Status

Accepted

## Context

P1/P2 established plan catalog and admin management, but there was no canonical subscription state model and no provider-agnostic billing boundary for future integration.

Step 7 P3 must define subscription truth and effective resolution without coupling PersAI to a billing vendor.

## Decision

1. Add canonical workspace-scoped subscription state persistence:
   - `workspace_subscriptions`
   - status enum:
     - `trialing`
     - `active`
     - `grace_period`
     - `past_due`
     - `paused`
     - `canceled`
     - `expired`

2. Add provider-agnostic billing abstraction port in application layer:
   - `BillingProviderPort`
   - `pullWorkspaceSubscription(workspaceId)` hook returning normalized snapshot or `null`
   - default adapter in this slice is a null/no-op implementation

3. Define effective subscription resolution precedence for assistant context:
   - workspace subscription row (authoritative)
   - assistant governance quota plan fallback
   - catalog default first-registration fallback
   - none

4. Represent unresolved fallback as `status="unconfigured"` in effective resolution output (control-plane computed state).

## Consequences

### Positive

- Subscription truth is explicit and provider-agnostic.
- Future billing integration can plug into a stable port without redesigning plans/subscriptions.
- P1/P2 plan model remains intact.

### Negative

- P3 does not yet synchronize from a real provider.
- Effective subscription state is defined in backend service logic, not exposed as a new user/admin API surface in this slice.

## Out of scope (P3)

- concrete billing provider integration
- invoicing/tax/payment operations
- webhook processors and subscription event pipelines
- entitlement/quota enforcement engine
