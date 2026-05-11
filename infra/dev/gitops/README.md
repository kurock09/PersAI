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
- `sandbox`

## Image pinning

Current image composition:

- registry host: `global.images.registryHost`
- project id: `global.images.projectId`
- repository: `global.images.repository`
- fallback tag for non-pinned services: `global.images.tag`
- per-service override tags:
  - `api.image.tag`
  - `web.image.tag`
  - `runtime.image.tag`
  - `providerGateway.image.tag`
  - `sandbox.image.tag`

`.github/workflows/dev-image-publish.yml` now builds/pushes only the affected services detected by `scripts/ci/detect-affected.mjs` and pins only those service tags in `infra/helm/values-dev.yaml` to the immutable commit SHA produced on `main`.

This keeps unchanged services on their previously pinned SHA instead of forcing a whole-environment image tag advance on every app/package change.

There is no active OpenClaw image tag, fork SHA pin, or fork-clone build stage in the current GitOps path.

## Runtime and secret wiring

`infra/helm/values-dev.yaml` is the source of truth for active non-secret runtime config:

- `api.env.*`
- `runtime.env.*`
- `providerGateway.env.*`
- `web.env.*`

For ADR-084 checkout-link sharing, the active `persai-dev` values explicitly set `PERSAI_WEB_BASE_URL=https://persai.dev` in both `api.env` and `runtime.env` so assistant-generated billing links resolve to the public web origin instead of staying relative.

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

## Affected deploy policy

- `apps/api` -> build/push/pin `api`
- `apps/runtime` -> build/push/pin `runtime`
- `apps/web` -> build/push/pin `web`
- `apps/provider-gateway` -> build/push/pin `provider-gateway`
- `apps/sandbox` -> build/push/pin `sandbox`
- shared `packages/*` -> build/push/pin only dependent services, not every workload
- `infra/helm` / `infra/dev/gitops` -> validation only, no image publish
- docs-only and test-only changes -> no image publish
- Prisma schema / migrations -> migration-sensitive path; affected checks and deploy scope must stay explicit, never broad by default
- the GitOps tag-pin follow-up commit touches only `infra/helm/values-dev.yaml`; main `CI` ignores that bot-only commit so Argo sync bookkeeping does not retrigger repo-wide checks by itself

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
