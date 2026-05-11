# AGENTS.md

## Mission

This repository contains the active PersAI platform baseline.

## Mandatory startup reading order

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. relevant `docs/ADR/*`, especially `docs/ADR/072-persai-native-multichannel-runtime-replacement.md` for migration history and `docs/ADR/078-consolidated-follow-through-program.md` for the active continuation program

## Repo rules

- one session = one bounded slice unless the user explicitly asks for broader work
- no silent architecture changes
- if docs and code diverge, surface the conflict
- if architecture/API/data model/workflow changes, update docs in the same slice
- every architectural change requires an ADR when it changes long-term system truth
- no git push unless the user explicitly asks
- no dead stubs or TODO scaffolding

## Active path rule

The active PersAI path is native-only:

- `apps/api`
- `apps/web`
- `apps/runtime`
- `apps/provider-gateway`
- `apps/sandbox`

Do not reintroduce OpenClaw-specific deploy wiring, CI workflows, secret names, route modes, or operational docs into the active repo path unless the user explicitly asks for historical analysis.

## Verification gate

Before claiming a change is clean, run:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`

If generated artifacts changed, regenerate them before running the checks.

## CI / deploy truth

- PR CI uses `scripts/ci/detect-affected.mjs` as the affected-entrypoint.
- Default PR path is risk-oriented and scoped:
  - affected lint
  - affected typecheck
  - affected focused tests
- Full verification now lives separately in `.github/workflows/full-verification.yml` for merge queue / nightly / explicit manual runs.
- Changes in `infra/helm` or `infra/dev/gitops` run deploy-truth validation only (`helm lint` + `helm template`) unless code risk requires more.
- Docs-only and test-only changes must not trigger image publish or GitOps tag pinning.
- Bot-only commits that touch only `infra/helm/values-dev.yaml` must not re-run the main `CI` workflow.
- Risky changes escalate back to full CI instead of silently skipping coverage. Treat these as full-check paths:
  - auth / identity / Clerk
  - billing / subscription / payment flows
  - runtime concurrency / scheduling / queueing / admission
  - Prisma schema / migrations
  - root workspace dependency changes
  - CI workflow / affected-rule changes
- Dev image publish uses selective service pinning in `infra/helm/values-dev.yaml` service `image.tag` fields. `global.images.tag` remains the fallback for services that were not rebuilt in that push.

## Live validation guidance

- for local-frontend + GKE-backend checks, read `docs/LIVE-TEST-HYBRID.md`
- for deploy/bootstrap work, read `infra/dev/gke/RUNBOOK.md`
- for GitOps truth, read `infra/dev/gitops/README.md`

## Historical traces

Historical OpenClaw references may remain in ADRs, changelog entries, session handoff logs, and old migrations. Treat them as archive, not as current deploy or runtime truth.

## Required session-ending output

- what changed
- why changed
- files touched
- tests run
- risks or residuals
- next recommended step
