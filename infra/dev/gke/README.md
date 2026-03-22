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

## CI config required for image publish baseline

Workflow: `.github/workflows/dev-image-publish.yml`

Required repository variables:

- `GAR_REGION` (example: `europe-west1`)
- `GCP_PROJECT_ID`
- `GAR_REPOSITORY` (example: `persai`)

Required repository secret:

- `GCP_ARTIFACT_REGISTRY_SA_KEY` (JSON key for service account allowed to push to GAR)
