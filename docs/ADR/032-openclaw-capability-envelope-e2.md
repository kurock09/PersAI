# ADR-032: OpenClaw capability envelope hardening (Step 8 E2)

## Status
Accepted

## Context

E1 introduced governed tool catalog and plan activation truth, but runtime-facing capability projection still relied on separate payload fragments (`effectiveCapabilities`, `toolAvailability`) rather than one explicit envelope shaped for OpenClaw consumption.

E2 requires explicit materialized truth for:

- per-tool and per-group allow/deny
- per-surface allowances
- quota-related capability restrictions for cost-driving features
- explicit suppression of unavailable tools so runtime cannot infer/invent them

## Decision

1. Add a dedicated OpenClaw-facing capability envelope in materialization:
   - `openclawCapabilityEnvelope`
   - schema: `persai.openclawCapabilityEnvelope.v1`

2. Envelope contents are explicit and runtime-safe:
   - per-surface allowances (`webChat`, `telegram`, `whatsapp`, `max`)
   - canonical declared tool set (`catalog.declaredToolCodes`) so runtime can treat unknown tool codes as unavailable
   - class-level tool allowances and quota-governed flags
   - per-group allow/deny lists
   - per-tool allow/deny with explicit deny reason
   - suppression block with denied tool codes
   - quota restriction block including:
     - cost-driving/utility class restriction semantics
     - `tasksAndRemindersExcludedFromCommercialQuotas`

3. Keep E2 additive and boundary-safe:
   - preserve existing `effectiveCapabilities` and `toolAvailability` projections
   - add envelope to:
     - governance materialization layer snapshot
     - OpenClaw bootstrap document
     - OpenClaw workspace document
   - do not add backend routing or execution logic

## Consequences

### Positive

- OpenClaw receives one explicit capability envelope with deny truth, reducing ambiguity.
- Unavailable tools are explicitly suppressed instead of being implied by absence.
- Prior P4-P7 governance and enforcement model remains intact.

### Negative

- E2 remains control-plane projection only; no per-tool runtime dispatch policy engine is added.
- No new admin/UI controls for envelope editing in this slice.

## Out of scope (E2)

- backend runtime routing/tool execution
- plugin execution framework
- endpoint-by-endpoint per-tool enforcement expansion
- channel binding hardening and Telegram delivery wiring (E3/E4+)
