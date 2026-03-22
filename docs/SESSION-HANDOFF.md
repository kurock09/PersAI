# SESSION-HANDOFF

## What changed

- Implemented Step 2 slice 1 auth foundation baseline only (no onboarding/business flow).
- Web (`apps/web`) now includes Clerk baseline:
  - `ClerkProvider` in root layout
  - login/logout baseline on `/` (`SignInButton`, `UserButton`)
  - protected route baseline `/app` with Clerk middleware and server-side `auth().protect()`
  - sign-in page route `app/sign-in/[[...sign-in]]/page.tsx`
- API (`apps/api`) now validates Clerk JWT itself:
  - identity-access middleware checks Bearer token and verifies Clerk JWT using Clerk backend SDK
  - middleware is scoped to `api/v1/auth/*`
- Internal app user model is now resolved/auto-created on first authenticated request:
  - find by `clerk_user_id`
  - fallback by `email` then bind `clerk_user_id`
  - create `app_users` row if missing
- Added minimal auth verification endpoint:
  - `GET /api/v1/auth/verify`
  - returns authenticated internal app user + requestId baseline
- Added Clerk-related env baseline:
  - `CLERK_SECRET_KEY` required in API config and env examples
  - `apps/web/.env.local.example` with Clerk publishable/secret key placeholders

## Why changed

- Step 2 requires auth foundation before onboarding/business endpoints.
- This slice establishes strict identity-provider integration (Clerk) while keeping internal `app_users` as system-of-record.

## Decisions made

- Scope limited to auth foundation only: Clerk web integration + backend JWT validation + app user auto-create.
- No onboarding implementation (`/api/v1/me`, `/api/v1/me/onboarding`) in this slice.
- No Step 2 scope expansion and no product feature work beyond auth baseline.

## Files touched

- apps/api/package.json
- apps/api/.env.dev.example
- apps/api/.env.local.example
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/api/src/modules/identity-access/application/resolved-auth-user.types.ts
- apps/api/src/modules/identity-access/application/resolve-app-user.service.ts
- apps/api/src/modules/identity-access/infrastructure/identity/clerk-auth.service.ts
- apps/api/src/modules/identity-access/infrastructure/persistence/prisma.service.ts
- apps/api/src/modules/identity-access/interface/http/clerk-auth.middleware.ts
- apps/api/src/modules/identity-access/interface/http/auth-verify.controller.ts
- apps/api/src/modules/platform-core/interface/http/request-http.types.ts
- apps/web/package.json
- apps/web/app/layout.tsx
- apps/web/app/page.tsx
- apps/web/app/app/page.tsx
- apps/web/app/sign-in/[[...sign-in]]/page.tsx
- apps/web/middleware.ts
- apps/web/.env.local.example
- packages/config/src/api-config.ts
- docs/API-BOUNDARY.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- pnpm-lock.yaml

## Migrations run

- Not run in this slice.

## Tests run / result

- `corepack pnpm run lint` (pass)
- `corepack pnpm run typecheck` (pass)
- `corepack pnpm run build` (pass)

## Known risks

- API auth flow currently uses Clerk profile fetch per authenticated request baseline; optimization/caching can be added later.
- `GET /api/v1/auth/verify` is a baseline verification endpoint only and not a final business contract endpoint.
- Next.js 16 warns that `middleware.ts` is deprecated in favor of `proxy.ts`; current baseline still works and can be migrated in a later slice.

## Next recommended step

- Continue with Step 2 slice 2 (`GET /api/v1/me` + onboarding flow) reusing current auth middleware and app-user resolution path.
