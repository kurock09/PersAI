# ADR-013: Backend-to-OpenClaw integration contract

## Status
Accepted

## Context
OpenClaw is now verified healthy in dev as a standalone in-cluster runtime (O4).  
We need a minimal and explicit future contract for `apps/api -> OpenClaw` without introducing runtime coupling in code yet.

The contract must keep `apps/api` control-plane oriented and keep OpenClaw runtime internals out of backend domain/business modules.

## Decision
Define a thin infrastructure adapter contract from `apps/api` to OpenClaw with these rules.

### 1) Boundary shape
- `apps/api` may call OpenClaw only through a dedicated infrastructure adapter boundary.
- Domain/application modules must not import OpenClaw-specific transport/runtime types.
- Adapter output to upper layers must be minimal, stable control-plane DTOs owned by `apps/api`.

### 2) Transport choice
- **Primary transport for the first integration step: HTTP**.
- Rationale:
  - request/response fits control-plane actions and strict backend timeouts
  - easier failure classification and retry policy than long-lived sockets
  - aligns with already proven O4 health/readiness HTTP checks (`/healthz`, `/readyz`)
- WebSocket is explicitly out of first adapter scope; if needed later, it must be introduced behind the same adapter boundary with a separate ADR update.

### 3) What `apps/api` is allowed to know
- OpenClaw service base URL (in-cluster address owned by infra)
- authentication token wiring for gateway access
- timeout/retry policy for outbound adapter calls
- coarse runtime state from health/readiness checks (live/ready/degraded)
- opaque request/response payloads for explicitly contract-approved control-plane interactions only

### 4) What must remain internal to OpenClaw
- provider/channel implementation details
- tool execution internals and runtime scheduling
- memory internals, context-window strategy, reasoning behavior
- gateway internal topology, private state files, and non-contract endpoints
- any OpenClaw-specific domain semantics that do not belong to PersAI business domain

### 5) First minimal supported interaction (future thin adapter)
- **Runtime preflight check**:
  - `GET /healthz`
  - `GET /readyz`
- Expected adapter result shape to upper layers:
  - `live: boolean`
  - `ready: boolean`
  - `checkedAt: timestamp`
- No product/business command dispatch is included in this first interaction.

### 6) Boundary failure model
Adapter must classify and map failures into stable categories:
- runtime unreachable (DNS/connectivity/refused)
- auth failure (401/403 from authenticated runtime endpoints)
- timeout (deadline exceeded)
- invalid response (schema/contract mismatch, malformed payload)
- degraded runtime (health live but not ready, or probe reports degraded state)

The adapter must surface only these categories upward; raw transport/provider internals stay in infrastructure logs.

### 7) Config responsibility split
- Backend (`apps/api`) owns:
  - adapter enablement flag
  - outbound timeout/retry policy
  - mapping of adapter failures to backend error categories
- Infra owns:
  - in-cluster service routing (`openclaw.persai-dev.svc.cluster.local:18789`)
  - secret delivery for OpenClaw gateway token
  - deploy/runtime baseline and probe wiring
- OpenClaw runtime owns:
  - internal runtime config model and behavior
  - provider/channel/tool/memory internals
  - internal endpoint implementation behind the declared external boundary

## Consequences
### Positive
- Keeps integration minimal and control-plane focused.
- Prevents backend domain leakage from OpenClaw internals.
- Creates an explicit failure model before code coupling starts.

### Negative
- First adapter capability is intentionally narrow (preflight only).
- Future functional interaction expansion requires explicit contract updates.

## Alternatives considered
- WebSocket-first adapter (rejected: increases lifecycle/error complexity too early).
- Direct OpenClaw calls from domain/application modules (rejected: boundary leakage risk).
- Immediate broad product command integration in O6 (rejected: out of scope for this slice).
