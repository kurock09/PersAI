# Dev GitOps Baseline

This directory contains the Step 1 GitOps/Argo CD skeleton for dev.

## Deploy path (explicit)

1. Argo CD project: `infra/dev/gitops/argocd/project-dev.yaml`
2. Argo CD application: `infra/dev/gitops/argocd/application-dev.yaml`
3. Helm source chart: `infra/helm`
4. Dev values file: `infra/helm/values-dev.yaml`

Dev values image composition pattern:

- registry host: `global.images.registryHost`
- project id: `global.images.projectId`
- GAR repository: `global.images.repository`
- shared deployed tag: `global.images.tag` (pinned by CI to immutable `${GITHUB_SHA}`)
- component names: `api.image.name`, `web.image.name`, `openclaw.image.name`
- api runtime env is supplied from values + k8s secret refs:
  - `api.env` (non-secret runtime config)
  - `api.secretEnv` (`secretKeyRef` mapping for required secrets)
- api database runtime path in dev:
  - API deployment uses dedicated runtime service account (`api.serviceAccount.*`)
  - KSA -> GSA mapping is provided by annotation `iam.gke.io/gcp-service-account`
  - `api.cloudSqlProxy.enabled=true` in `values-dev.yaml`
  - `api.cloudSqlProxy.usePrivateIp=true` routes proxy to Cloud SQL private IP
  - API connects to Cloud SQL via sidecar proxy on `127.0.0.1:5432`
  - `DATABASE_URL` secret must use `@127.0.0.1:5432`
- web runtime env is supplied from values:
  - `web.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk frontend publishable key)
  - `web.secretEnv.CLERK_SECRET_KEY` (Clerk server key via `secretKeyRef`)

Dev image publish behavior:

- CI publishes both `${GITHUB_SHA}` and `dev-main` tags to GAR.
- CI then updates `infra/helm/values-dev.yaml` -> `global.images.tag: <GITHUB_SHA>` and pushes that commit to `main`.
- Argo CD deploys the pinned SHA tag from GitOps values, avoiding stale-node-cache issues with moving tags.

## Scope in this phase

- skeleton manifests only
- no automatic apply/sync execution
- no GKE cleanup/reset

## OpenClaw rule

- OpenClaw remains disabled by default (`openclaw.enabled=false`).

## Manual procedures

- Cleanup/reset and first deploy runbook: `infra/dev/gke/RUNBOOK.md`
