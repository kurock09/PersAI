# ADR-024: Plan catalog and entitlement model (Step 7 P1)

## Status

Accepted

## Context

Step 6 established governance controls (memory/tasks), but commercial packaging and plan truth were still implicit (`quotaPlanCode` as a loose field without canonical catalog ownership).

Step 7 P1 requires explicit, provider-agnostic control-plane truth for:

- plan catalog
- default first-registration plan selection
- trial plan semantics (including duration)
- entitlement grouping for capabilities, tool classes, channels/surfaces, and limits permissions

The model must not couple PersAI to a billing vendor and must not introduce billing workflow logic in this slice.

## Decision

1. Add canonical plan catalog table `plan_catalog_plans` with:
   - unique `code`
   - lifecycle `status` (`active|inactive`)
   - `isDefaultFirstRegistrationPlan` flag
   - `isTrialPlan` flag
   - `trialDurationDays` input/value (required when trial=true, null otherwise)
   - `billingProviderHints` JSON for provider-agnostic future adapter hints

2. Add canonical entitlement table `plan_catalog_entitlements` (1:1 by `plan_id`) with explicit grouped JSON fields:
   - `capabilities`
   - `toolClasses`
   - `channelsAndSurfaces`
   - `limitsPermissions`

3. Keep all entitlement semantics in the plan catalog boundary for now (no distribution into unrelated modules, no enforcement engine in P1).

4. On assistant governance baseline creation, resolve `quotaPlanCode` from the active catalog plan flagged `isDefaultFirstRegistrationPlan=true` (nullable fallback when catalog is empty).

## Consequences

### Positive

- Plans and entitlements become explicit control-plane truth with stable persistence.
- Trial/default registration behavior is modeled without selecting a billing provider.
- Existing Step 2/Step 6 behavior remains intact; no runtime behavior leakage into backend.

### Negative

- P1 stores entitlement truth but does not yet enforce it at runtime/control decision points.
- Catalog management UX and billing lifecycle remain future slices.

## Out of scope (P1)

- billing vendor workflows (subscription checkout, invoices, webhooks)
- entitlement enforcement engine
- admin plan management UI
- quota accounting and meter pipelines
