# API-BOUNDARY

## API style
REST only.
Path versioning: /api/v1/...

## Step 1 endpoints
- GET /health
- GET /ready
- GET /metrics

## Step 2 endpoints
- GET /api/v1/me
- POST /api/v1/me/onboarding

## Auth model
- web protects routes
- web sends Bearer token
- api validates Clerk JWT itself

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