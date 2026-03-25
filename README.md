# v2 Foundation Repo

This repository contains the greenfield v2 foundation phase for the project.

The goal of this phase is to build a clean platform baseline for future product development.
This is not the full product yet.

## Current scope

The repository is still in foundation phase, but it has progressed well beyond the initial Step 1/Step 2 baseline.

Current implemented foundation slices include:

- backend/web control-plane baseline for assistants, publish/apply, chat, admin, and ops flows
- OpenClaw runtime integration through a thin backend infrastructure adapter
- dev GitOps image publish and Argo-driven deploy flow for `api`, `web`, and `openclaw`
- quota, audit, admin RBAC/step-up, and platform rollout baselines

For the full slice map, see `docs/ROADMAP.md`.

## Out of scope

- broad billing-provider workflow implementation (checkout, invoices, webhooks, taxes)
- knowledge retrieval / RAG productization
- generalized background jobs engine in backend
- GraphQL
- WebSockets in `apps/api`
- product feature flags
- OpenClaw runtime internals living inside backend domain/application layers

## Repository structure

```text
apps/
  web/
  api/

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

OpenClaw remains a separate neighboring runtime boundary, but its authoritative source is the external fork and the CI workflow materializes it into `services/openclaw` only during image build.

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

The dev GKE/Helm baseline is active through GitOps-managed deploys:

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
- materializes OpenClaw source from fork into temporary CI path `services/openclaw` at that approved SHA (native PersAI runtime routes ship in fork; no compat patch step)
- builds using:
  - context: `services/openclaw`
  - Dockerfile: `services/openclaw/Dockerfile`
- pushes image `openclaw` with tags:
  - immutable source tag: `<OPENCLAW_APPROVED_SHA>`
  - moving dev tag: `dev-main`
- on `main` push success, CI also updates `infra/helm/values-dev.yaml`:
  - `openclaw.image.tag` -> `<OPENCLAW_APPROVED_SHA>`
  - `openclaw.image.digest` -> built image digest
  and pushes that GitOps commit
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

GitOps wiring is active for the dev environment:

- `infra/dev/gitops/argocd/project-dev.yaml`
- `infra/dev/gitops/argocd/application-dev.yaml`

Dev deploy path is explicit:

- Argo CD app points to `infra/helm` with `infra/helm/values-dev.yaml`
- Argo CD app uses automated sync in dev baseline (`prune + selfHeal`)
- API DB migrations are executed automatically by an Argo PreSync hook job (`api-migrate`) on each deploy sync

Manual runbooks:

- One-time reset script skeleton: `infra/bootstrap/dev-gke-reset.sh`
- Dev cleanup/reset + first deploy procedure: `infra/dev/gke/RUNBOOK.md`

## Hybrid live test (local web + GKE API)

For fast UI validation against real dev backend state without web redeploy:

- run local web on `http://localhost:3000`
- forward dev GKE API to `http://localhost:3001`
- keep browser requests same-origin via `/api/v1` web rewrite

Guide: `docs/LIVE-TEST-HYBRID.md`
