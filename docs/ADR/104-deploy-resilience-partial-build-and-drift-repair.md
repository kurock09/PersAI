# ADR-104: Deploy resilience — partial-build isolation, pin-only-succeeded, and drift repair

**Status:** Accepted (2026-05-30) — **D1 + D2 implemented** in this slice (`fail-fast: false` + pin-only-successfully-built on the dev non-migration path). **D3 (drift-repair cron) is planned, not built** (deferred to avoid shipping an auto-mutating cron before it is trusted; D1+D2 already prevent stranding of successfully-built services). **D4 (prod-atomic) is design-only** (no `values-prod.yaml` exists yet).
**Date:** 2026-05-30
**Relates to:** [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md) (deploy discipline), [ADR-102](102-pre-prod-architectural-cleanup-and-truth-hardening.md) (Slice 9 CI hygiene), [AGENTS.md](../../AGENTS.md) (CI/deploy truth), [infra/dev/gitops/README.md](../../infra/dev/gitops/README.md)

## Context

`persai-dev` is the only live environment; every push to `main` that touches app/package code flows through `.github/workflows/dev-image-publish.yml`: `detect-affected` → `build-and-push` (matrix over affected services) → a pin job that rewrites the per-service `image.tag` in `infra/helm/values-dev.yaml`, which Argo CD auto-syncs to the cluster.

Confirmed current behavior (code truth, 2026-05-30):

1. **`fail-fast` is implicitly `true`.** The build matrix (`dev-image-publish.yml` L76–78) sets no `fail-fast: false`, so GitHub Actions defaults to `true`: when one service build fails, in-flight builds of the **other** services are cancelled.
2. **Pinning is all-or-nothing relative to the matrix.** Both pin jobs (`pin-dev-values-tag` L270–274, `pin-approved-migration-values-tag` L157–161) declare `needs: build-and-push` with the default success-only semantics. If **any** matrix leg fails, the whole `build-and-push` job is failed and **both pin jobs are skipped** — so even services that built successfully are **not** pinned.
3. **The next push only sees newly-changed services.** `detect-affected` diffs `github.event.before..github.sha` (`detect-affected.mjs` L600–612). A service that was stranded by a previous partial failure is **not** re-detected unless its own code changes again, so it stays on the old tag indefinitely — the "stuck / disappeared" symptom.
4. **No drift-repair exists.** The only scheduled workflow is `full-verification.yml` (nightly tests, `0 2 * * *`); there is no cron that re-pins or re-syncs stranded services.
5. **Partial capability already present:** `pin-dev-image-tags.mjs` already pins an arbitrary **subset** of services by name (`--services a,b`). What is missing is the workflow computing and passing the **successfully-built** subset.

### Failure scenario (founder-reported)

Push affects `api` + `runtime`; `runtime` build fails → `fail-fast` cancels the `api` build → `build-and-push` fails → pin job skipped → `values-dev.yaml` unchanged for both → a later push that changes only `web` deploys `web` alone → `api`/`runtime` remain on the old tag and look "stuck".

## Non-goals

- Changing `detect-affected` risk/escalation rules or the `persai-dev-migrations` approval gate.
- Changing Argo CD auto-sync or the `api-migrate` PreSync hook.
- Building a real production pipeline now (no `values-prod.yaml` exists); prod-atomic is captured as design only.
- Per-service partial rollout semantics for PROD (PROD is intentionally atomic — see Decision D3).

## Decision

### D1 — Isolate partial build failures (dev)

Set `strategy.fail-fast: false` on the `build-and-push` matrix so a single service build failure no longer cancels the other services' builds. Each affected service builds independently.

### D2 — Pin only the successfully-built services, even on partial failure (dev)

- Each matrix leg, **after** a successful build+push, records a per-service success marker artifact (`built-<service>`). Because the marker is written only after `docker/build-push-action` reports a successful push, a marker is itself proof the image exists in the registry (no separate `docker manifest inspect` needed on this path).
- The **non-migration** pin job runs with `if: always()` (still gated to `push` + non-empty deploy list + `migration_changed != 'true'` + `detect-affected` succeeded), so the pin step executes even when some legs failed.
- That pin job downloads all `built-*` markers, computes the CSV of **successfully-built** services, and pins **only** that subset via `pin-dev-image-tags.mjs --services <succeeded-csv>`. If zero services succeeded, the pin is a no-op (and the failed build job still surfaces red).
- The **migration** pin job stays **success-only / all-or-nothing** (it keeps `needs: build-and-push` success semantics and its existing "verify every image exists" guard). A migration rollout must be coordinated across all its services (`api`/`runtime`/`sandbox`), so if any one fails to build, nothing is pinned — the atomic behavior is correct there.

**Happy-path invariant:** when all affected builds succeed, the computed subset equals the full affected set, so behavior is identical to today. The only behavioral change is on partial failure of a non-migration push, where succeeded services now still roll forward.

### D3 — Drift repair backstop (dev) — PLANNED, not built in this slice

A future scheduled workflow `dev-deploy-reconcile.yml` (daily + `workflow_dispatch`) should detect per-service drift between `values-dev.yaml` and the newest successfully-built image on `main`, and re-pin any service that is behind to its newest existing image SHA. This is a backstop for the residual case where a service's build genuinely failed and its code has not changed since.

It is intentionally **deferred**: D2 already prevents stranding of services whose builds succeed, so the remaining stranding window is narrow; and an auto-mutating cron that rewrites `values-dev.yaml` (triggering Argo CD rollouts unattended) should be introduced only once its drift-detection is proven, to avoid surprise deploys. Until then, drift after a genuine build failure is repaired by the normal next push of that service (or a manual `workflow_dispatch` of `dev-image-publish` with `base_sha`).

### D4 — PROD is atomic (design only, not built here)

When a production pipeline is introduced it must be **atomic**, not per-service best-effort:

- Build **all** services for a release; verify **all** images exist; then pin **all** of `values-prod.yaml` to the single release tag in one commit (the existing migration path's "verify every image before pin" is the template).
- No partial prod pin: if any service fails to build, the release does not promote (the previous release stays live, intact and consistent).
- Promotion is gated behind an explicit approval environment (mirroring `persai-dev-migrations`).

Rationale: dev optimizes for "keep the green services moving" (iteration speed); prod optimizes for "never run a half-applied, internally-inconsistent release" (correctness). These are deliberately different policies.

## Consequences

### Positive

- A single flaky/failed service build no longer blocks or reverts every other service on dev.
- Stranded-service drift is repaired automatically by the reconcile backstop instead of waiting for the next unrelated code change.
- Happy-path deploys are unchanged (no new risk on the common case).
- The prod policy is written down before prod exists, so the eventual prod pipeline starts atomic-by-design.

### Negative

- The pin job is slightly more complex (artifact download + subset computation); mitigated by the happy-path invariant and a registry-existence guard.
- The reconcile cron adds a small recurring Action run and registry reads.
- Marker artifacts add minor per-build overhead.

## Alternatives considered

- **Keep `fail-fast: true`, just retry the whole workflow.** Rejected: re-runs rebuild everything and still strand on the next unrelated push; does not fix root cause.
- **Pin every affected service regardless of build success.** Rejected: would pin `values-dev.yaml` to a SHA whose image does not exist → Argo CD `ImagePullBackOff`.
- **Make dev atomic like prod (all-or-nothing).** Rejected for dev: it optimizes the wrong thing for the single iteration environment — one flaky build would block all iteration. Atomicity is reserved for prod (D4).
- **Reconcile via nightly full rebuild of all services.** Rejected as the default: unnecessary build cost; drift repair only needs to re-pin to existing images.
