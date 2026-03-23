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

OpenClaw dev deploy baseline (O3):

- `openclaw.enabled=true` in `infra/helm/values-dev.yaml`
- runtime wiring uses OpenClaw gateway port `18789`
- auth token is injected from `persai-openclaw-secrets`

## Dev image build/push baseline (Step 1 slice 13)

Container builds are now defined for:

- `apps/api/Dockerfile`
- `apps/web/Dockerfile`

GitHub Actions image publish workflow:

- `.github/workflows/dev-image-publish.yml`
- triggers on `push` to `main` and manual `workflow_dispatch`
- builds and pushes `api` + `web` images to Google Artifact Registry
- publishes two tags per image:
  - immutable commit tag: `${GITHUB_SHA}`
  - moving dev tag: `dev-main`
- on `main` push success, CI updates `infra/helm/values-dev.yaml` `global.images.tag` to `${GITHUB_SHA}` and pushes that GitOps commit

OpenClaw image publish workflow (Step 3 O2):

- `.github/workflows/openclaw-dev-image-publish.yml`
- triggers on `push` to `main` and manual `workflow_dispatch`
- uses the same WIF/OIDC variables as `api`/`web` workflows
- reads approved OpenClaw SHA from machine-readable pin file `infra/dev/gitops/openclaw-approved-sha.txt`
- materializes OpenClaw source from fork into CI path `services/openclaw` at that approved SHA
- builds using:
  - context: `services/openclaw`
  - Dockerfile: `services/openclaw/Dockerfile`
- pushes image `openclaw` with tags:
  - immutable source tag: `<OPENCLAW_APPROVED_SHA>`
  - moving dev tag: `dev-main`
- on `main` push success, CI also updates `infra/helm/values-dev.yaml` `openclaw.image.tag` to `<OPENCLAW_APPROVED_SHA>` and pushes that GitOps commit
- no direct cluster deploy/sync step in this workflow

Artifact Registry naming pattern:

- `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/api:<tag>`
- `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/web:<tag>`
- `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/openclaw:<tag>`

Required GitHub Actions configuration:

- Repository variables:
  - `GAR_REGION` (example: `europe-west1`)
  - `GCP_PROJECT_ID`
  - `GAR_REPOSITORY` (example: `persai`)
  - `GCP_WIF_PROVIDER` (full Workload Identity Provider resource name)
  - `GCP_WIF_SERVICE_ACCOUNT` (service account email used for GAR push)

Workload Identity Federation setup required in GCP:

1. Create a Workload Identity Pool.
2. Create a Workload Identity Provider for GitHub OIDC in that pool.
3. Create/select a target service account for image publish.
4. Bind GitHub principal set to impersonate the target service account.
5. Grant Artifact Registry write permissions to the target service account.

Exact GitHub OIDC provider settings:

- issuer URI: `https://token.actions.githubusercontent.com`
- audience: default (`https://iam.googleapis.com/...` managed by Google auth action)
- attribute mapping must include:
  - `google.subject=assertion.sub`
  - `attribute.repository=assertion.repository`

Example provider resource format:

- `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>`

IAM bindings required:

- On target service account:
  - role `roles/iam.workloadIdentityUser`
  - member `principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/attribute.repository/<GITHUB_OWNER>/<GITHUB_REPO>`
- On Artifact Registry repository (or project):
  - grant target service account role `roles/artifactregistry.writer`

Helm dev values are wired to the same pattern:

- `global.images.registryHost`
- `global.images.projectId`
- `global.images.repository`
- `global.images.tag` (pinned by CI to immutable commit SHA for deploys)
- component image names (`api`, `web`, `openclaw`) are composed in templates

## Dev GitOps / Argo CD baseline (Step 1)

Skeleton only; not applied in this phase:

- `infra/dev/gitops/argocd/project-dev.yaml`
- `infra/dev/gitops/argocd/application-dev.yaml`

Dev deploy path is explicit:

- Argo CD app points to `infra/helm` with `infra/helm/values-dev.yaml`

Manual runbooks:

- One-time reset script skeleton: `infra/bootstrap/dev-gke-reset.sh`
- Dev cleanup/reset + first deploy procedure: `infra/dev/gke/RUNBOOK.md`
