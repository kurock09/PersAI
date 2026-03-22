# ADR-003: API contract policy

## Status
Accepted

## Context
Frontend/backend drift must be prevented from the beginning.

## Decision
Use OpenAPI-first for business endpoints starting in Step 2.
OpenAPI spec lives in packages/contracts.
Typed client is generated via Orval and committed to repo.

## Consequences
### Positive
- Explicit shared contract.
- Fewer ad hoc frontend/backend mismatches.

### Negative
- Requires contract discipline before implementation.