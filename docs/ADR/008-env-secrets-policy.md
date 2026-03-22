# ADR-008: Env and secrets policy

## Status
Accepted

## Context
Secrets/config must not degrade into fallback chaos.

## Decision
- strict config validation
- fail fast on invalid/missing critical config
- local secrets outside git
- dev secrets source of truth: Google Secret Manager
- synced into Kubernetes Secrets
- no fallback secrets

## Consequences
### Positive
- Safer and more predictable config behavior.

### Negative
- Slightly more setup effort.