# ADR-002: Backend module boundaries

## Status
Accepted

## Context
The previous system suffered from boundary collapse and service accumulation.

## Decision
apps/api must start with these modules:
- identity-access
- workspace-management
- platform-core

Each module must contain:
- domain
- application
- infrastructure
- interface

## Consequences
### Positive
- Prevents service/controller pile.
- Keeps framework and provider concerns out of domain.

### Negative
- More boilerplate early.