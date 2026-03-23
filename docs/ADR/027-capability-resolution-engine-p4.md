# ADR-027: Capability resolution engine (Step 7 P4)

## Status

Accepted

## Context

P1-P3 introduced plan catalog entitlements, admin management, and subscription state, but there was no single engine deriving effective assistant capabilities.

Enforcement layers and OpenClaw materialization need one explicit reusable truth source for allowed tool classes, channels/surfaces, media classes, and governed features.

## Decision

1. Add centralized backend capability resolution service:
   - `ResolveEffectiveCapabilityStateService`
   - output schema: `persai.effectiveCapabilities.v1`

2. Resolution inputs:
   - effective subscription state (P3 resolver)
   - plan catalog entitlements
   - assistant governance capability envelope

3. Resolution precedence:
   - derive base allow-list from plan entitlements selected by effective subscription plan code
   - apply governance as restrictive guardrail (deny/false can reduce allowances; governance does not grant plan-denied capabilities in P4)

4. Materialization integration:
   - embed `effectiveCapabilities` in materialization layers governance snapshot
   - embed `effectiveCapabilities` in OpenClaw bootstrap/workspace documents so runtime receives explicit availability truth

## Consequences

### Positive

- Single reusable capability truth for future enforcement layers.
- OpenClaw receives explicit capability availability from backend materialization.
- No routing-monster behavior logic added to backend.

### Negative

- P4 defines capability truth and propagation but does not enforce every endpoint/action yet.
- Governance envelope parsing is MVP-level and intentionally narrow.

## Out of scope (P4)

- distributed enforcement at every API path
- provider-level feature routing
- quota accounting and overage handling
