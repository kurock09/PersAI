# Dev GKE Infra Baseline

This directory contains the Step 1 dev GKE infrastructure baseline.

## Scope in this phase
- namespace skeleton
- Helm chart skeleton for `apps/api`, `apps/web`, and `services/openclaw`
- no deployment execution
- no cleanup/reset execution

## OpenClaw rule
- OpenClaw remains a neighboring service skeleton.
- `openclaw.enabled` is `false` by default in `infra/helm/values.yaml`.

## Notes
- Runtime rollout in dev is intentionally deferred to later slices.
- Argo CD wiring skeleton lives in `infra/dev/gitops/argocd`.
