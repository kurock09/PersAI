# SESSION-HANDOFF

## What changed

- Implemented targeted dev image-tag deploy automation hardening (no API/product scope changes).
- Updated `.github/workflows/dev-image-publish.yml`:
  - on `main` push, after successful image publish, workflow updates `infra/helm/values-dev.yaml` `global.images.tag` to `${GITHUB_SHA}`
  - commits and pushes this GitOps values change to `main`
  - ignores push events that only change `infra/helm/values-dev.yaml` to prevent recursive workflow loops
- Updated docs:
  - `README.md`
  - `infra/dev/gitops/README.md`
  - `infra/dev/gke/README.md`
  - `infra/dev/gke/RUNBOOK.md`
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- Dev deploy used moving tag `dev-main` with `IfNotPresent`, which can keep stale node-cached images after sync.
- Pinning deploy tag in GitOps values to immutable commit SHA makes Argo sync deterministic and prevents stale-image rollout.

## Decisions made

- Kept scope strictly infra/gitops-docs for image tag flow hardening.
- Kept image publish behavior (`${GITHUB_SHA}` + `dev-main`) unchanged; only deploy tag selection in `values-dev` is now auto-pinned to immutable SHA.
- Prevented CI self-trigger loops with workflow `paths-ignore` on `infra/helm/values-dev.yaml`.

## Files touched

- .github/workflows/dev-image-publish.yml
- README.md
- infra/dev/gitops/README.md
- infra/dev/gke/README.md
- infra/dev/gke/RUNBOOK.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run (workflow/docs slice only).

## Tests run / result

- Pending in this slice (workflow/docs only; follow-up operational verification should run after next `main` push triggers publish + values pin).

## Known risks

- Workflow uses bot commit/push to `main`; repository branch protection must allow GitHub Actions token writes, otherwise tag pin commit step will fail.
- Current runtime crash issues in deployed images remain separate and must still be fixed by publishing corrected images.

## Next recommended step

- Trigger or wait for next `main` push, confirm workflow commits pinned SHA into `infra/helm/values-dev.yaml`, then run `argocd app sync persai-dev` and verify pods use the new SHA image digest.
