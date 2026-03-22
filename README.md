# v2 Foundation Repo

This repository contains the greenfield v2 foundation phase for the project.

The goal of this phase is to build a clean platform baseline for future product development.
This is not the full product yet.

## Current scope

### Step 1

- monorepo scaffold
- docs baseline
- CI baseline
- infra baseline
- local/dev baseline
- logger/config/request context baseline
- Prisma baseline
- app skeletons
- health/readiness/metrics baseline

### Step 2

- Clerk auth integration
- internal app user model
- `GET /api/v1/me`
- `POST /api/v1/me/onboarding`
- workspace create/update flow
- protected `/app`
- onboarding gate
- smoke/e2e for this flow

## Out of scope

- chat
- OpenClaw runtime integration
- channels
- Telegram
- billing provider integration
- knowledge retrieval
- admin console
- background jobs implementation
- GraphQL
- WebSockets in `apps/api`
- product feature flags

## Repository structure

```text
apps/
  web/
  api/

services/
  openclaw/

packages/
  contracts/
  config/
  logger/
  types/
  eslint-config/
  tsconfig/

infra/
docs/
.github/
```

## Local database bootstrap (Step 1 baseline)

Use Docker for local Postgres:

```bash
docker compose -f infra/local/docker-compose.postgres.yml up -d
```

Then apply Prisma migration and seed:

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public"
corepack pnpm --filter @persai/api run prisma:migrate:deploy
corepack pnpm --filter @persai/api run prisma:seed
```

Helpful checks:

```bash
corepack pnpm --filter @persai/api run prisma:migrate:status
corepack pnpm run prisma:migrate:check
```

If `pnpm` is not globally installed in your shell, use `corepack pnpm ...`.

## Dev GKE infra baseline (Step 1)

Infra skeleton files are present but are not applied in this phase:

- `infra/dev/gke/namespace.yaml`
- `infra/helm/Chart.yaml`
- `infra/helm/values.yaml`
- `infra/helm/templates/*`

OpenClaw deploy skeleton exists but is disabled by default:

- `openclaw.enabled=false` in `infra/helm/values.yaml`

## Dev GitOps / Argo CD baseline (Step 1)

Skeleton only; not applied in this phase:

- `infra/dev/gitops/argocd/project-dev.yaml`
- `infra/dev/gitops/argocd/application-dev.yaml`

Dev deploy path is explicit:

- Argo CD app points to `infra/helm` with `infra/helm/values-dev.yaml`

Manual runbooks:

- One-time reset script skeleton: `infra/bootstrap/dev-gke-reset.sh`
- Dev cleanup/reset + first deploy procedure: `infra/dev/gke/RUNBOOK.md`
