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

When Prisma/schema/migration changes are detected, image publish still builds the affected service images, but GitOps pinning stops at the `persai-dev-migrations` GitHub Environment and continues only after approval in the Actions UI.

When ADR-146 foundation marker paths are present in the pushed commit range, Dev Image Publish enters the Slice 0.1b split-pin path:

1. build affected services as usual (sandbox is always forced into the matrix);
2. pin **sandbox only** immediately after a successful sandbox build;
3. foundation-only: hold remaining successful builds until GitHub Environment `persai-dev-adr146-foundation` is approved;
4. foundation+migration: require **ordered** dual approval — `persai-dev-adr146-foundation` first (approval-only gate), then `persai-dev-migrations` for remaining pins; neither Environment may be bypassed;
5. migration-only: retain the existing `persai-dev-migrations` approval then pin path;
6. fail closed if the sandbox build/pin marker is missing.

Non-foundation pushes keep the ordinary immediate pin path. Bot-only follow-up commits that touch only `infra/helm/values-dev.yaml` still skip main `CI`; image-tag-only pins may start Dev Image Publish detect-affected but yield empty deploy (no build/pin loop). Fail-closed classification: any non-tag `values-dev` edit is a foundation rollout; only pure `pin-dev-image-tags.mjs` `tag:` scalar substitutions skip the gate. CI never auto-applies foundation cluster mutations.

When an ADR-146 foundation Environment wait is rejected and cannot be recreated (Dev Image Publish pin jobs remain push-only), use `.github/workflows/adr146-foundation-deferred-pin-resume.yml`. It pins existing deferred service tags after `persai-dev-adr146-foundation` approval without rebuilding images and without relaxing ordinary publish guards. Inputs decouple `target_image_sha` from `sandbox_proof_commit_sha` + `evidence_inventory_sha256`; the service set is exactly `api,web,runtime,provider-gateway`; sandbox is excluded; all root build-context drift between target and current main fails closed. The gated job fetches fresh `origin/main`, revalidates after every rebase, and permits only the authoritative tag-scalar commit (`pin-dev-image-tags.mjs` writes through shared `applyPinDevImageTags`; resume assert requires that body exactly after CRLF→LF — EOF blank-line drift fails closed). This resume path is foundation-only (`migration_changed=false`); dual-gate migration resume is not supported here.

**Live acceptance (2026-07-13):** Slices 0.1 + 0.1b are live-accepted. Current remote/deployed bot pin `64be77d6` has `api`/`web`/`runtime`/`provider-gateway` exact `3cd2ea4f` and sandbox remaining `8a0043dd`; Argo Synced. Resume workflow run `29237479924` validate + Environment-gated pin both succeeded after required-reviewer approval of `persai-dev-adr146-foundation`. Historical first resume failed on pin-assert EOF mismatch; EOF CLI/lib repair landed; successful second run is current. Restricted foundation gate PASS at proof pin `e5c249c3` / inventory `c9abf3e8…` remains enforcement evidence. Inbound denial / HTTP redirect / DNS-rebind stay unclaimed. **S1–S5 are committed locally** (`775e5781`, `5a2fd3bd`, `8d0520f4`, `3f498ef9`, `d23936d1`; unpushed/undeployed); **S6 deploy/live acceptance is next**. Observability/runbook: `infra/dev/gke/ADR146-OBSERVABILITY.md`.

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
- Prisma schema / migrations -> migration-sensitive path; affected checks and deploy scope must stay explicit, never broad by default, and GitOps pinning continues only after `persai-dev-migrations` environment approval
- ADR-146 foundation markers -> split-pin path; `sandbox` pins immediately; remaining services wait on ordered Environment approval (`persai-dev-adr146-foundation`, then `persai-dev-migrations` when both apply); root package fanout cannot advance non-sandbox pins before that approval
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
