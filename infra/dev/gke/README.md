# Dev GKE Infra Baseline

This directory contains the Step 1 dev GKE infrastructure baseline.

## Scope in this phase

- namespace skeleton
- Helm chart skeleton for `apps/api`, `apps/web`, and `services/openclaw`
- Docker build baseline for `apps/api` and `apps/web`
- CI image publish baseline to Artifact Registry
- no deployment execution
- no cleanup/reset execution

## OpenClaw rule

- OpenClaw remains a neighboring service skeleton.
- `openclaw.enabled` is `false` by default in `infra/helm/values-dev.yaml`.

## Notes

- Runtime rollout in dev remains manual-only via runbook.
- Argo CD wiring skeleton lives in `infra/dev/gitops/argocd`.
- Cleanup/reset and first deploy manual procedures live in `infra/dev/gke/RUNBOOK.md`.
- CI now pins `infra/helm/values-dev.yaml` `global.images.tag` to immutable commit SHA on each `main` push after successful image publish.
- API deployment requires secret `persai-api-secrets` in namespace `persai-dev` with keys:
  - `DATABASE_URL`
  - `CLERK_SECRET_KEY`

## CI config required for image publish baseline

Workflow: `.github/workflows/dev-image-publish.yml`

Required repository variables:

- `GAR_REGION` (example: `europe-west1`)
- `GCP_PROJECT_ID`
- `GAR_REPOSITORY` (example: `persai`)
- `GCP_WIF_PROVIDER` (full Workload Identity Provider resource name)
- `GCP_WIF_SERVICE_ACCOUNT` (service account email used for GAR push)

No GitHub secret is required for GAR auth in this workflow.

## Required GCP resources for WIF

- Workload Identity Pool (global)
- Workload Identity Provider for GitHub OIDC
- Target service account for image publish

Provider must map GitHub repository claim:

- `attribute.repository=assertion.repository`

Required IAM bindings:

- allow GitHub principal set to impersonate target service account:
  - role: `roles/iam.workloadIdentityUser`
  - member: `principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/attribute.repository/<GITHUB_OWNER>/<GITHUB_REPO>`
- allow target service account to push images:
  - role: `roles/artifactregistry.writer` on GAR repository (or project scope)
