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

## Step 3 A2 assistant lifecycle skeleton endpoints

- POST /api/v1/assistant
- GET /api/v1/assistant
- PATCH /api/v1/assistant/draft

### POST /api/v1/assistant

Behavior baseline:

- authenticated caller only
- creates assistant for current user if absent
- rejects create when assistant already exists for current user (`1 user = 1 assistant`)
- requires caller workspace membership (assistant is workspace-scoped)
- no OpenClaw/runtime calls

### GET /api/v1/assistant

Behavior baseline:

- authenticated caller only
- returns assistant lifecycle skeleton state:
  - `id`, `userId`, `workspaceId`
  - `draft.displayName`, `draft.instructions`, `draft.updatedAt`
  - `createdAt`, `updatedAt`
- returns not found if assistant has not been created yet

### PATCH /api/v1/assistant/draft

Request body fields (at least one required):

- `displayName` (string | null)
- `instructions` (string | null)

Behavior baseline:

- authenticated caller only
- updates mutable draft fields only
- does not create published versions
- does not perform runtime apply/openclaw actions
- returns not found when assistant does not exist

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

## Contract source of truth (Step 2 + Step 3 A2)

- OpenAPI spec: `packages/contracts/openapi.yaml`
- Generated typed client (Orval): `packages/contracts/src/generated/*`
- Frontend consumption baseline remains typed-client only via `@persai/contracts`

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
