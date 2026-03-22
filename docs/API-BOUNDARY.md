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
