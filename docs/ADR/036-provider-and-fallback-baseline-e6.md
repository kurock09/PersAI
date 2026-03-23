# ADR-036: Provider and fallback baseline (Step 8 E6)

## Status
Accepted

## Context

E1-E5 established governed tools, capability envelopes, channel/surface bindings, and Telegram connect UX. Runtime provider/model routing baseline remained implicit.

E6 requires explicit primary/fallback baseline so runtime behavior is resilient while user-facing complexity stays minimal.

## Decision

1. Add explicit runtime provider routing projection in control-plane materialization:
   - `runtimeProviderRouting`
   - schema: `persai.runtimeProviderRouting.v1`
   - embedded into `openclawCapabilityEnvelope`

2. Baseline keeps runtime-managed provider ownership:
   - primary provider key: `openclaw_managed_default`
   - no user-facing provider picker
   - no provider marketplace expansion

3. Define explicit fallback matrix:
   - provider failure/timeout -> fallback model path
   - runtime degraded -> safe-mode degrade model path
   - cost-driving restricted -> constrain tools path

4. Align routing with governance and entitlements:
   - effective capabilities gates (channels, text media)
   - cost-driving allowed/quota-governed flags
   - optional policy envelope override (`policyEnvelope.runtimeProviderRouting`) for model keys and fallback-disable flag

## Consequences

### Positive

- Runtime receives explicit primary/fallback truth instead of implicit assumptions.
- Governance and entitlement constraints are reflected directly in routing eligibility.
- User-facing complexity remains minimal (no picker, no marketplace UI).

### Negative

- E6 baseline stays provider-agnostic and runtime-managed; no explicit vendor selection UX.
- Fallback model keys are baseline control-plane hints, not a full provider orchestration system.

## Out of scope (E6)

- user-facing provider picker
- provider marketplace/business logic
- full provider orchestration engine with vendor-level routing rules
