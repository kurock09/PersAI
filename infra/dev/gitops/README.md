# Dev GitOps Baseline

This directory contains the Step 1 GitOps/Argo CD skeleton for dev.

## Deploy path (explicit)
1. Argo CD project: `infra/dev/gitops/argocd/project-dev.yaml`
2. Argo CD application: `infra/dev/gitops/argocd/application-dev.yaml`
3. Helm source chart: `infra/helm`
4. Dev values file: `infra/helm/values-dev.yaml`

## Scope in this phase
- skeleton manifests only
- no apply/sync execution
- no GKE cleanup/reset

## OpenClaw rule
- OpenClaw remains disabled by default (`openclaw.enabled=false`).
