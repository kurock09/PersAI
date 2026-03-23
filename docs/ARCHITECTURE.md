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

## Chat transport boundary (Step 5 C2)

- backend web chat transport entrypoint:
  - `POST /api/v1/assistant/chat/web`
- transport is adapter-only to OpenClaw runtime:
  - `POST /api/v1/runtime/chat/web`
- backend persists canonical chat/message records before/after runtime turn
- transport is synchronous in C2 (no streaming)

## Chat streaming boundary (Step 5 C3)

- primary web chat UX path is streaming-first:
  - `POST /api/v1/assistant/chat/web/stream`
- backend streams transport events to web UI and keeps canonical record ownership
- adapter boundary remains explicit for runtime stream:
  - `POST /api/v1/runtime/chat/web/stream`
- interruption/failure is represented honestly and partial output can be persisted with explicit marker records

## Chat list/actions boundary (Step 5 C4)

- GPT-style web chat list/actions are backed by canonical backend records
- supported C4 actions:
  - rename
  - archive
  - hard delete (explicit confirmation)
- archive and delete are intentionally distinct:
  - archive keeps records/history
  - delete permanently removes chat + message records

## Active web chats cap boundary (Step 5 C5)

- cap is enforced in backend web chat transport flow at new-thread creation point
- cap threshold is runtime-configurable via API config (`WEB_ACTIVE_CHATS_CAP`)
- enforcement blocks only new chat creation; existing threads and records remain intact

## Frontend/backend boundary

- contracts-first
- no scattered raw fetch
- typed client only
