# ADR-001: Monorepo structure

## Status
Accepted

## Context
The project requires a clean greenfield foundation with clear boundaries for apps, shared packages, infrastructure, and a separate OpenClaw service.

## Decision
Use pnpm workspaces with this structure:
- apps/web
- apps/api
- services/openclaw
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
- OpenClaw can live рядом in repo without contaminating backend domain.

### Negative
- Slightly more upfront structure work.