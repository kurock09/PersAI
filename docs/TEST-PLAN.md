# TEST-PLAN

## Quality gate
Required in CI:
- lint
- typecheck
- unit tests
- contract tests
- e2e smoke
- prisma migrate check
- build

## Step 1 focus
- app boot
- health/ready/metrics
- config validation
- requestId propagation
- Prisma setup
- seed works

## Step 2 focus
- Clerk token validation
- app user auto-create
- GET /api/v1/me
- POST /api/v1/me/onboarding
- onboarding idempotency
- protected /app
- onboarding gate