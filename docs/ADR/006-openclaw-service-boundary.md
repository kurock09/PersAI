# ADR-006: OpenClaw service boundary

## Status
Accepted

## Context
OpenClaw must remain a separate runtime/service boundary and must not leak into backend domain.

## Decision
OpenClaw lives in services/openclaw as a neighboring service.
In foundation phase:
- no runtime integration
- no functional code changes
- chart/service may exist but disabled
- only service boundary skeleton and sync structure are allowed
- source/deploy boundary details are defined in ADR-012

## Consequences
### Positive
- Prevents runtime/infrastructure leakage into app domain.
- Keeps future integration explicit.

### Negative
- Integration is deferred to later phases.