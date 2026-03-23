# API-BOUNDARY

## API style

REST only.
Path versioning: /api/v1/...

## Step 1 endpoints

- GET /health
- GET /ready
- GET /metrics

## Step 2 endpoints

- GET /api/v1/auth/verify
- GET /api/v1/me
- POST /api/v1/me/onboarding

### GET /api/v1/me (slice 2 baseline response)

- Returns current internal app user (`app_users`) for authenticated caller.
- Includes onboarding status:
  - `completed` when a workspace membership exists
  - `pending` when no workspace membership exists yet
- Includes current workspace summary if one exists:
  - `id`, `name`, `locale`, `timezone`, `status`, `role`

### POST /api/v1/me/onboarding (slice 3 baseline request/behavior)

Request body fields:

- `displayName`
- `workspaceName`
- `locale`
- `timezone`

Behavior baseline:

- authenticated caller only
- idempotent upsert-style flow
- updates `app_users.display_name`
- creates workspace if user has no membership yet
- creates/updates workspace membership for caller
- updates current workspace summary fields (`name`, `locale`, `timezone`) consistently

## Auth model

- web protects routes
- web sends Bearer token
- api validates Clerk JWT itself
- api resolves/auto-creates internal `app_users` record on first authenticated access
- web uses a typed client module for `/api/v1/me` and `/api/v1/me/onboarding` calls (no scattered raw fetch in UI)

## Error envelope

```json
{
  "error": {
    "code": "SOME_CODE",
    "category": "validation|auth|forbidden|conflict|infra|unknown",
    "message": "Human-readable message",
    "details": {}
  },
  "requestId": "..."
}
```

## Contract source of truth (Step 2 slice 5)

- OpenAPI spec: `packages/contracts/openapi.yaml`
- Generated typed client (Orval): `packages/contracts/src/generated/*`
- Frontend consumption baseline: `apps/web/app/app/me-api-client.ts` via `@persai/contracts`

## OpenClaw integration contract baseline (Step 3 O6, docs-only)

This section defines backend-to-OpenClaw boundary rules only.  
No runtime calls are implemented in this slice.

Transport choice for first adapter step:

- **HTTP** (not WebSocket) for first integration boundary.
- Why:
  - control-plane request/response shape is easier to bound
  - timeout/retry/failure mapping is deterministic
  - aligns with already verified dev endpoints (`/healthz`, `/readyz`)

First minimal supported interaction (future thin adapter):

- runtime preflight:
  - `GET /healthz`
  - `GET /readyz`
- minimal adapter output to backend:
  - `live: boolean`
  - `ready: boolean`
  - `checkedAt: string` (timestamp)

Allowed backend knowledge:

- OpenClaw base URL and token config references
- timeout/retry settings
- coarse runtime status (`live`, `ready`, degraded)

Forbidden leakage into backend/domain language:

- provider/channel/tool execution internals
- memory/reasoning/runtime-behavior internals
- OpenClaw-specific internal endpoint or state semantics outside approved boundary

Expected boundary error classes:

- `runtime_unreachable`
- `auth_failure`
- `timeout`
- `invalid_response`
- `runtime_degraded`
