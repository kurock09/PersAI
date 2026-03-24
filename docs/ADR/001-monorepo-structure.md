# ADR-001: Monorepo structure

## Status
Accepted

## Context
The project requires a clean greenfield foundation with clear boundaries for apps, shared packages, infrastructure, and a separate OpenClaw service.

## Decision
Use pnpm workspaces with this structure:
- apps/web
- apps/api
- external OpenClaw runtime boundary (CI materialized to `services/openclaw` for image builds)
- packages/contracts
- packages/config
- packages/logger
- packages/types
- packages/eslint-config
- packages/tsconfig
- infra
- docs

## Consequences
### Positive
- Clear separation of deployable apps, shared packages, and neighboring services.
- OpenClaw stays separate from backend domain even though its authoritative source is managed outside this repository.

### Negative
- Slightly more upfront structure work.