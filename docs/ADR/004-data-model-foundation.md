# ADR-004: Data model foundation

## Status
Accepted

## Context
The new project must avoid runtime leakage and malformed ownership models.

## Decision
Initial DB entities:
- app_users
- workspaces
- workspace_members

Rules:
- UUID everywhere
- snake_case in DB
- Prisma migrations only
- no OpenClaw runtime fields in domain entities

## Consequences
### Positive
- Clean identity/workspace baseline.
- Supports future expansion without ownerId trap.

### Negative
- Slightly more schema upfront than a naive single-table design.