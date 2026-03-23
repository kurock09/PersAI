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

## Memory control boundary (Step 6 D1)

- backend owns a **memory control-plane envelope** per assistant (`assistant_governance.memory_control`):
  - policy (read/write surfaces, group-sourced write denial)
  - provenance metadata hooks (for later enforcement)
  - visibility hooks (user-facing source exposure)
  - forget-request markers (control-plane only in D1; not runtime memory contents)
  - audit routing toward governance `audit_hook`
- OpenClaw owns **runtime memory behavior** and consumption during assistant execution
- materialized `openclawWorkspace.memoryControl` carries the resolved envelope so the runtime does not infer policy
- legacy `policyEnvelope.memoryControl` is supported only as a migration/fallback path

## Memory Center registry (Step 6 D2)

- `assistant_memory_registry_items` stores user-facing **summaries** linked to web chat turns (control plane), not OpenClaw runtime memory contents
- items are created on successful web chat completion (sync + stream paths); list/forget/do-not-remember APIs are assistant-scoped
- “Do not remember” updates registry rows and appends to `memory_control.forgetRequestMarkers` for governance continuity

## Tasks control boundary (Step 6 D4)

- backend owns **`tasks_control`** on `assistant_governance` (`persai.tasksControl.v1`): ownership model, source/surface tagging hooks, control-plane lifecycle labels, user enable/disable/cancel flags, **explicit `commercialQuota.tasksExcludedFromPlanQuotas`** (tasks are not a billable quota dimension), audit delegation
- OpenClaw owns **execution, scheduling, and trigger routing**; PersAI does not implement a backend scheduler in D4
- materialized `openclawWorkspace.tasksControl` carries the resolved envelope for runtime alignment without inferring policy locally

## Memory source policy enforcement (Step 6 D3)

- Global **registry** read and write paths evaluate `memory_control` (plus legacy fallback): read surfaces gated by `globalMemoryReadAllSurfaces`; writes require trusted 1:1 classification and an allowed + trusted transport surface (MVP: web only); group-sourced global registry writes are denied.
- Web chat classifies turns as `trusted_1to1` + `web` at the send/stream services; the record hook does not infer trust in isolation.
- Other channels and group contexts are out of scope; they must not bypass this module when future ingest is added (ADR-021).
