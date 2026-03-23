# ARCHITECTURE

## Architecture style

Modular monolith for apps/api, with strict module and layer boundaries.

## Repo structure

- apps/web
- apps/api
- services/openclaw
- packages/\*
- infra
- docs

## Backend modules

- identity-access
- workspace-management
- platform-core

## Backend layers

- domain
- application
- infrastructure
- interface

## OpenClaw boundary

OpenClaw is a neighboring service in services/openclaw.
It is not part of the foundation runtime and not part of backend domain logic.
`apps/api` must not call OpenClaw in Step 1/Step 2 and O1.
O6 defines a future adapter-only contract:

- OpenClaw calls are allowed only via infrastructure adapter boundary in `apps/api`
- domain/application modules remain OpenClaw-agnostic
- first implemented interactions (A8):
  - runtime preflight (`/healthz`, `/readyz`)
  - apply/reapply of A7 materialized published specs through adapter

## Chat boundary (Step 5 C1)

- backend stores canonical user-facing chat records:
  - chat/thread identity
  - message history
  - ownership and retention-oriented record fields
- OpenClaw stores runtime conversational/session context only
- backend chat domain must not include runtime session internals
- surface-aware threading is explicit and record-level (`surface + surfaceThreadKey`)

## Frontend/backend boundary

- contracts-first
- no scattered raw fetch
- typed client only
