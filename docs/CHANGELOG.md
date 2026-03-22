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

### Changed
- None.

### Fixed
- None.

### Removed
- None.