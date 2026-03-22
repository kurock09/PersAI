# ADR-009: Local and dev environments

## Status
Accepted

## Context
The project needs a fast local loop and a realistic remote dev environment.

## Decision
Use:
- local
- dev

Local:
- apps/web and apps/api run natively
- Postgres in Docker

Dev:
- GKE
- Helm
- Argo CD / GitOps
- Cloud SQL Postgres
- Artifact Registry for images

## Consequences
### Positive
- Fast local iteration plus realistic deploy validation.

### Negative
- Requires early infra setup.