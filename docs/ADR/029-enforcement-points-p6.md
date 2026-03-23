# ADR 029: Step 7 P6 enforcement points baseline

Date: 2026-03-26
Status: Accepted

## Context

P1-P5 introduced plan catalog, subscription abstraction, capability resolution, and quota accounting.
P6 requires these to become explicit product rules at control-plane boundaries without turning backend into runtime behavior routing.

## Decision

Introduce centralized enforcement layer:

- `EnforceAssistantCapabilityAndQuotaService`

Active enforcement points in P6:

- web chat sync send path (`SendWebChatTurnService`)
- web chat stream prepare path (`StreamWebChatTurnService.prepare`)

Enforcement checks applied in one place:

- capability checks:
  - web chat channel availability
  - text media class availability
  - utility tool-class availability
- quota checks:
  - active web chats cap for new-thread creation
  - token budget limit
  - cost/token-driving tool-class quota limit (when class is quota-governed)

Tool availability truth for runtime materialization:

- materialization now includes explicit `toolAvailability` snapshot (`persai.effectiveToolAvailability.v1`) in:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document

The snapshot is class-level in P6 and intentionally does not introduce per-tool catalog routing.

## Consequences

Positive:

- plan/entitlement/capability/quota rules are enforced at agreed control-plane boundaries
- checks are centralized and reusable (no ad hoc scattered guards)
- OpenClaw receives explicit tool-availability truth and does not need to infer unavailable tools

Intentional limits:

- backend still does not route behavior/tools execution
- no billing-vendor behavior introduced
- per-tool activation catalog remains Step 8 scope
- no new public quota/enforcement API endpoints in P6
