# SESSION-HANDOFF

## What changed

- Completed Step 3 O6 backend-to-OpenClaw integration contract definition (docs-only).
- Added ADR:
  - `docs/ADR/013-openclaw-backend-integration-contract.md`
- Defined intended future `apps/api -> OpenClaw` boundary:
  - calls allowed only through dedicated infrastructure adapter
  - no direct OpenClaw coupling in domain/application layers
- Selected transport for first integration step:
  - **HTTP** (WebSocket deferred)
- Defined first minimal supported interaction for future thin adapter:
  - runtime preflight only:
    - `GET /healthz`
    - `GET /readyz`
- Defined boundary failure model:
  - `runtime_unreachable`
  - `auth_failure`
  - `timeout`
  - `invalid_response`
  - `runtime_degraded`
- Defined config responsibility split:
  - backend owns adapter enablement + timeout/retry + failure mapping
  - infra owns service routing + token delivery + deploy baseline
  - OpenClaw owns runtime internals and internal endpoint behavior
- Updated architecture/API boundary docs and roadmap:
  - `docs/ARCHITECTURE.md`
  - `docs/API-BOUNDARY.md`
  - `docs/ROADMAP.md` (`O6` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- O6 requires contract formalization before any backend runtime coupling.
- The contract keeps `apps/api` control-plane oriented and prevents leakage of OpenClaw runtime internals into domain/business modules.

## Decisions made

- `apps/api -> OpenClaw` integration is adapter-only at infrastructure boundary.
- Transport choice for first integration step: HTTP.
- First adapter capability is preflight-only (`/healthz`, `/readyz`), no business command dispatch.
- Backend may know only base URL/token wiring, timeout/retry policy, and coarse runtime state.
- Forbidden leakage into backend/domain:
  - provider/channel/tool internals
  - memory/reasoning/runtime behavior internals
  - OpenClaw internal endpoint/state semantics outside approved contract
- Error model at boundary is fixed to five classes:
  - `runtime_unreachable`
  - `auth_failure`
  - `timeout`
  - `invalid_response`
  - `runtime_degraded`

## Files touched

- docs/ADR/013-openclaw-backend-integration-contract.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run.

## Tests run / result

- Docs-only slice; no code/runtime changes applied in O6.
- No additional runtime tests run in this slice.

## Known risks

- Future adapter implementation must enforce the boundary strictly; direct module-level leakage is still possible if not reviewed.
- HTTP-first decision keeps integration simple but may require later extension for streaming use cases.
- Contract currently scopes only preflight interaction; product interaction semantics remain deferred.

## Next recommended step

- Implement the thin infrastructure adapter stub in `apps/api` using this ADR contract, still without exposing product features.
