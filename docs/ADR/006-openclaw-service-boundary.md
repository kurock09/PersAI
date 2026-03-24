# ADR-006: OpenClaw service boundary

## Status
Accepted

## Context
OpenClaw must remain a separate runtime/service boundary and must not leak into backend domain.

## Decision
OpenClaw remains a separate runtime/service boundary.
In the original ADR-006 scope:
- no runtime integration
- no functional code changes
- chart/service may exist but disabled
- only service boundary skeleton and sync structure are allowed
- source/deploy boundary details are defined in ADR-012

Current clarification:

- the lasting rule from ADR-006 is the separation boundary, not a permanent checked-in `services/openclaw` source tree
- later slices introduced runtime integration only through the backend infrastructure adapter boundary
- OpenClaw source-of-truth is now the external fork; CI materializes it into `services/openclaw` during image build

## Consequences
### Positive
- Prevents runtime/infrastructure leakage into app domain.
- Keeps future integration explicit.

### Negative
- Integration is deferred to later phases.