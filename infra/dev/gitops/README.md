# Dev GitOps Baseline

This directory contains the active GitOps wiring for the `persai-dev` environment.

ADR-072 remains the historical native-migration ADR through the native-path closeout. The active continuation backlog now lives in `docs/ADR/078-consolidated-follow-through-program.md`.

## Deploy path

1. Argo CD project: `infra/dev/gitops/argocd/project-dev.yaml`
2. Argo CD application: `infra/dev/gitops/argocd/application-dev.yaml`
3. Helm chart: `infra/helm`
4. Dev values: `infra/helm/values-dev.yaml`

The active chart deploys only:

- `api`
- `web`
- `runtime`
- `provider-gateway`

## Image pinning

Current image composition:

- registry host: `global.images.registryHost`
- project id: `global.images.projectId`
- repository: `global.images.repository`
- deployed tag: `global.images.tag`

`global.images.tag` is the only active GitOps image pin. It is updated by `.github/workflows/dev-image-publish.yml` to the immutable Git SHA produced on `main`.

There is no active OpenClaw image tag, fork SHA pin, or fork-clone build stage in the current GitOps path.

## Runtime and secret wiring

`infra/helm/values-dev.yaml` is the source of truth for active non-secret runtime config:

- `api.env.*`
- `runtime.env.*`
- `providerGateway.env.*`
- `web.env.*`

Kubernetes secret refs remain explicit through:

- `api.secretEnv`
- `runtime.secretEnv`
- `providerGateway.secretEnv`
- `web.secretEnv`

Current secret split:

- `persai-api-secrets` for API/web/database/admin secrets
- `persai-runtime-secrets` for native runtime/provider-gateway secret wiring

## Sync behavior

- Argo CD auto-sync is enabled for `persai-dev`
- `api-migrate` runs as a `PreSync` hook before API rollout
- failed migrations block rollout
- GitHub Actions do not mutate the cluster directly

## Verification checklist

After any deploy-truth change, verify:

- `helm lint infra/helm -f infra/helm/values-dev.yaml`
- `helm template persai-dev infra/helm -f infra/helm/values-dev.yaml`
- `kubectl -n persai-dev get deploy,svc,ingress,networkpolicy`
- `kubectl get applications.argoproj.io -n argocd`
- `kubectl -n persai-dev get secret`

## Related docs

- `infra/dev/gke/README.md`
- `infra/dev/gke/RUNBOOK.md`
- `docs/LIVE-TEST-HYBRID.md`
