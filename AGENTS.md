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
8. relevant `docs/ADR/*`, especially `docs/ADR/072-persai-native-multichannel-runtime-replacement.md` for migration history and `docs/ADR/073-post-adr072-residue-and-polish-program.md` for the active post-Step-18 program

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

Do not reintroduce OpenClaw-specific deploy wiring, CI workflows, secret names, route modes, or operational docs into the active repo path unless the user explicitly asks for historical analysis.

## Verification gate

Before claiming a change is clean, run:

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`

If generated artifacts changed, regenerate them before running the checks.

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
