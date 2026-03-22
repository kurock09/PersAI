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
- Step 1 slice 4 config baseline:
  - added shared `packages/config` package with strict `zod` env validation
  - added discriminated config handling for `APP_ENV=local|dev`
  - wired API startup to fail fast on invalid environment via `loadApiConfig`
  - added example env files for `apps/api` local/dev configuration
  - updated `.gitignore` to allow tracking `.env.*.example` files
- Step 1 slice 5 Prisma + local DB baseline:
  - added Prisma schema for `app_users`, `workspaces`, `workspace_members` with UUID IDs and snake_case mappings
  - added initial Prisma migration SQL baseline and migration lock file
  - added idempotent deterministic Prisma seed baseline
  - added local Postgres Docker baseline in `infra/local/docker-compose.postgres.yml`
  - added Prisma scripts and dependencies in `apps/api` and wired `DATABASE_URL` in env validation/examples
  - updated `docs/DATA-MODEL.md` with concrete Prisma baseline constraints/enums
- Step 1 slice 6 CI + workspace Prisma flow baseline:
  - added root workspace scripts `prisma:generate` and `prisma:migrate:check`
  - extended CI checks workflow with Postgres service and Prisma generate/migrate check steps
  - documented local database bootstrap/migrate/seed commands in `README.md`
- Step 1 slice 7 dev infra + Helm skeleton baseline:
  - added dev GKE namespace skeleton in `infra/dev/gke/namespace.yaml`
  - added Helm skeleton for `apps/api` and `apps/web` in `infra/helm/templates`
  - added OpenClaw service/deployment skeleton in Helm templates with `openclaw.enabled=false` by default
  - added infra baseline docs in `infra/dev/gke/README.md` and root `README.md`
- Step 1 slice 8 GitOps / Argo CD skeleton baseline:
  - added dev Argo CD project and application skeleton manifests in `infra/dev/gitops/argocd`
  - made dev deploy path explicit: Argo CD -> `infra/helm` + `infra/helm/values-dev.yaml`
  - kept OpenClaw disabled by default in dev values
  - updated infra docs in `infra/dev/gitops/README.md`, `infra/dev/gke/README.md`, and `README.md`
- Step 1 slice 9 shared repo baseline wiring:
  - added shared workspace packages: `packages/tsconfig`, `packages/eslint-config`, `packages/logger`, and `packages/types`
  - wired `apps/web` and `apps/api` to consume shared tsconfig baselines
  - added app-level ESLint config files extending `@persai/eslint-config`
  - switched API logging service to consume `@persai/logger` and shared request log types from `@persai/types`
- Step 1 slice 10 enforced lint/format baseline:
  - added real ESLint runner scripts in `apps/web` and `apps/api`
  - upgraded shared eslint config package from placeholder to actual TypeScript-aware baseline rules
  - added Prettier baseline (`.prettierrc.json`, `.prettierignore`) and repo `format:check` script
  - updated root `lint` script to enforce ESLint + Prettier checks
  - applied Prettier formatting to files in enforced scope so CI/local lint is no longer effectively no-op
- Step 1 slice 11 infra bootstrap/reset runbook baseline:
  - added one-time manual reset script skeleton in `infra/bootstrap/dev-gke-reset.sh` (dry-run by default, `--execute` required)
  - added bootstrap manual usage notes in `infra/bootstrap/README.md`
  - added exact dev GKE cleanup/reset and first deploy procedure in `infra/dev/gke/RUNBOOK.md`
  - updated infra docs to point to runbooks (`infra/dev/gke/README.md`, `infra/dev/gitops/README.md`, `README.md`)
- Step 1 slice 12 reset/deploy flow finalization:
  - reviewed and hardened `infra/bootstrap/dev-gke-reset.sh` safety behavior (kubectl dependency check, context output/guard, strict `--execute` gating, dry-run default)
  - finalized and clarified command order in `infra/dev/gke/RUNBOOK.md` for reset and first dev deploy
  - fixed docs consistency: OpenClaw default-disabled reference now points to `infra/helm/values-dev.yaml` in all relevant docs
  - kept OpenClaw disabled by default and kept all actions manual/non-executed
- Step 1 slice 13 container build/push baseline:
  - added Docker build baselines for `apps/api` and `apps/web` via app-local Dockerfiles
  - added `.dockerignore` to keep image build context clean and avoid local-only files in images
  - added GitHub Actions workflow `.github/workflows/dev-image-publish.yml` to build/push `api` and `web` images to Artifact Registry on `main`
  - defined explicit dev image tagging strategy in CI: immutable `${GITHUB_SHA}` and moving `dev-main`
  - replaced placeholder Helm image refs with composed GAR pattern (`global.images.*` + component image name) in `infra/helm/values.yaml`, `infra/helm/values-dev.yaml`, and deployment templates
  - documented required GitHub Actions repo variables/secret and Artifact Registry naming pattern in infra/root docs
  - kept OpenClaw disabled by default (`openclaw.enabled=false`)
- Step 1 slice 14 CI auth hardening for Artifact Registry publish:
  - switched `.github/workflows/dev-image-publish.yml` from JSON service account key auth to Workload Identity Federation (GitHub OIDC)
  - removed `GCP_ARTIFACT_REGISTRY_SA_KEY` dependency from workflow/docs
  - added required WIF repo variables (`GCP_WIF_PROVIDER`, `GCP_WIF_SERVICE_ACCOUNT`) and workflow validation
  - documented exact required GCP resources (WIF pool/provider + target service account) and IAM bindings for impersonation and GAR push
  - kept image build/push behavior unchanged (`${GITHUB_SHA}` + `dev-main`) and kept OpenClaw disabled by default
- Step 1 slice 15 operational WIF/GAR wiring execution:
  - resolved and validated active environment values (`PROJECT_ID`, `PROJECT_NUMBER`, GAR region/repository, GitHub owner/repo)
  - created GCP WIF resources for GitHub Actions image publish:
    - Workload Identity Pool `github-actions-pool`
    - OIDC Provider `github-provider` with GitHub repository claim mapping/condition
    - service account `gha-gar-publisher@project-44786b14-b7d7-4554-a8a.iam.gserviceaccount.com`
  - applied IAM bindings:
    - `roles/artifactregistry.writer` for target service account on GAR repository `persai`
    - `roles/iam.workloadIdentityUser` principalSet binding for `kurock09/PersAI` on target service account
  - configured GitHub repository variables for WIF auth (`GAR_REGION`, `GCP_PROJECT_ID`, `GAR_REPOSITORY`, `GCP_WIF_PROVIDER`, `GCP_WIF_SERVICE_ACCOUNT`)
  - verified operational blocker: remote `main` does not yet contain `Dev Image Publish` workflow and still references placeholder image repos in `infra/helm/values-dev.yaml`, so workflow dispatch and GAR image verification cannot complete until those repo changes are pushed
- Step 2 slice 1 auth foundation baseline:
  - integrated Clerk into `apps/web` with provider, login/logout baseline UI, and protected `/app` route middleware
  - added backend Clerk JWT validation in `apps/api` (identity-access interface layer middleware)
  - added internal app user resolution/auto-create flow in identity-access application/infrastructure layers
  - added minimal authenticated verification endpoint `GET /api/v1/auth/verify` for auth baseline validation (no onboarding/me business flow yet)
  - extended API config/env examples with required `CLERK_SECRET_KEY` and added web Clerk env example
  - updated API boundary docs for auth verify endpoint and app_user auto-create behavior

### Changed

- None.

### Fixed

- None.

### Removed

- None.
