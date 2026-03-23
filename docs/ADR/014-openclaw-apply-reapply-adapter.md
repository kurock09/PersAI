# ADR-014: OpenClaw apply/reapply adapter (A8)

## Status

Accepted

## Context

Step 3 A7 introduced deterministic materialized runtime specs but did not execute runtime apply.
Step 3 A8 requires the first real thin infrastructure adapter from `apps/api` to OpenClaw for:

- runtime preflight checks
- apply/reapply of the materialized published assistant spec

The integration must preserve control-plane architecture constraints:

- OpenClaw-specific transport details remain in infrastructure layer only
- domain/application layers remain OpenClaw-agnostic
- coarse error categories are stable and explicit

## Decision

Implement a dedicated adapter boundary in `workspace-management` infrastructure with these rules.

### 1) Adapter interactions (first supported set)

- Preflight:
  - `GET /healthz`
  - `GET /readyz`
  - upper-layer DTO: `live`, `ready`, `checkedAt`
- Apply/reapply:
  - `POST /api/v1/runtime/spec/apply`
  - payload comes from A7 materialized spec only (`openclawBootstrap`, `openclawWorkspace`, `contentHash`, IDs)
  - reapply is explicit via `reapply: true`

### 2) Boundary ownership

- `apps/api` application services depend on a runtime adapter interface and control-plane DTO/error types.
- OpenClaw HTTP details (URLs, headers, retries, JSON parsing) are owned by infrastructure implementation only.
- No OpenClaw transport/runtime-specific types are imported by domain entities/repositories.

### 3) Coarse error model

Adapter classifies failures into:

- `runtime_unreachable`
- `auth_failure`
- `timeout`
- `invalid_response`
- `runtime_degraded`

Upper layers store these categories in assistant apply state.
Raw transport internals stay in infrastructure logs/exceptions.

### 4) Apply-state semantics in A8

- publish/rollback/reset still create version truth first
- then runtime apply attempt is executed via adapter
- apply-state transitions are now explicit:
  - `pending -> in_progress -> succeeded|failed|degraded`

### 5) Config split

Backend config:

- `OPENCLAW_ADAPTER_ENABLED`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_ADAPTER_TIMEOUT_MS`
- `OPENCLAW_ADAPTER_MAX_RETRIES`

Infra/runtime ownership remains unchanged (service routing, secret delivery, runtime internals).

## Consequences

### Positive

- First real runtime integration is thin and bounded.
- Materialized spec from A7 is now actually consumed by apply/reapply.
- Failure outcomes are visible in stable control-plane state.

### Negative

- Behavior-level runtime semantics are still opaque by design.
- Adapter currently uses only approved coarse categories and does not expose detailed runtime internals.

## Out of scope

- chat relay/streaming
- Telegram/channel delivery
- behavior/tool/memory internals integration
- broad OpenClaw domain leakage into other backend modules
