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
