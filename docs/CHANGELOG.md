# CHANGELOG

## Unreleased

### Added
- Initial documentation baseline.
- Session discipline and startup reading order.
- ADR baseline for foundation phase.
- Step 1 slice 1 monorepo scaffold baseline:
  - `pnpm-workspace.yaml`
  - root `package.json` scripts for lint/typecheck/test/build
  - `.gitignore`
  - required top-level structure materialized (`apps/*`, `services/openclaw`, `packages/*`, `infra`)
  - first `.github/workflows/ci.yml` baseline checks workflow
- Step 1 slice 2 minimal app skeletons:
  - `apps/web` minimal Next.js App Router scaffold
  - `apps/api` minimal NestJS scaffold
  - backend module boundaries initialized with required modules and layer directories
  - workspace dependencies added for both app skeletons
  - `.gitignore` updated to ignore `*.tsbuildinfo`
- Step 1 slice 3 internal service/runtime baseline in `apps/api`:
  - added internal endpoints `GET /health`, `GET /ready`, `GET /metrics`
  - added requestId middleware baseline with `x-request-id` propagation
  - added structured JSON logger baseline using `pino`
  - added request completion logs with `requestId`, `userId`, `workspaceId`, `path`, `method`, `status`, `latencyMs`
  - wired platform-core middleware/controllers without adding auth, Prisma, or Step 2 endpoints

### Changed
- None.

### Fixed
- None.

### Removed
- None.