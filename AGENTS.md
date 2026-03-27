# AGENTS.md

## Mission
This repository is a greenfield v2 foundation phase.
The goal is to build a clean platform baseline, not product breadth.

## Current phase
Foundation Phase only.


## Mandatory startup reading order
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ARCHITECTURE.md
5. docs/API-BOUNDARY.md
6. docs/DATA-MODEL.md
7. docs/TEST-PLAN.md
8. docs/OPENCLAW-PRESESSION.md
9. relevant docs/ADR/*

## Repo rules
- one session = one small slice
- no scope expansion
- no silent architecture changes
- if docs and code diverge, surface conflict and stop
- if architecture/API/data model/workflow changes, update docs first
- every architectural change requires ADR
- no deleting/moving files without explicit approval
- no git push
- no dead stubs or TODO scaffolding

## Pre-commit / pre-push gate (MANDATORY)
Before **every** commit (and definitely before push), the agent MUST run the full CI-equivalent checks locally and fix all failures **before** committing:
1. `corepack pnpm -r --if-present run lint` — full workspace eslint (unused imports, etc.)
2. `corepack pnpm run format:check` — prettier across all tracked globs (apps, packages, infra, root)
3. `corepack pnpm --filter @persai/api run typecheck` — API tsc
4. `corepack pnpm --filter @persai/web run typecheck` — Web tsc
If any step fails, fix the issue and re-run **all four** before committing.
Do NOT rely on partial file-by-file prettier checks — always run the full `format:check` command.
If generated code (e.g. `packages/contracts/src/generated/`) needs formatting, run `prettier --write` on it before committing.
Pushing code that fails CI is treated as a bug introduced by the agent.

## OpenClaw fork change workflow
- when a slice changes the local OpenClaw fork (`C:\Users\alex\Documents\openclaw`), treat **OpenClaw + PersAI** as one delivery unit
- before saying "ready to push", the agent must prepare **both** repos:
  - commit the OpenClaw fork changes locally
  - capture the new OpenClaw commit SHA
  - update `infra/dev/gitops/openclaw-approved-sha.txt` in PersAI to that SHA
  - if PersAI should build/deploy that fork revision, update `infra/helm/values-dev.yaml`:
    - set `openclaw.image.tag` to the same fork SHA
    - clear `openclaw.image.digest` so the image publish workflow can repin digest
  - update `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md`
  - if the runtime contract / deploy semantics changed, update the relevant docs/ADR first (`docs/API-BOUNDARY.md`, `docs/ADR/048-*`, runbooks)
- before handoff, the agent must explicitly tell the user:
  - what was committed in `openclaw`
  - what was committed in `PersAI`
  - exact push order: **push OpenClaw first, then PersAI**
  - that PersAI CI is expected to rebuild/re-pin the OpenClaw image after the PersAI push
- do not claim deploy-ready if only one repo is prepared or if the fork SHA in PersAI still points at an older commit

## OpenClaw upstream sync workflow
When updating the fork from upstream OpenClaw:
1. **Tag current state:** `git tag persai-pre-update-YYYYMMDD` (in openclaw repo)
2. **Create branch:** `git checkout -b update/upstream-YYYYMMDD`
3. **Fetch and merge:** `git fetch upstream && git merge upstream/main`
4. **Resolve conflicts** using `docs/PERSAI-FORK-PATCHES.md` as the checklist — every cross-cutting patch listed there must survive the merge
5. **Run verification:** `node scripts/verify-persai-patches.mjs` — must pass 24/24
6. **Run OpenClaw checks:** `npx tsc --noEmit`, `node scripts/sync-plugin-sdk-exports.mjs --check`, `node scripts/check-plugin-sdk-subpath-exports.mjs`
7. **Merge to main:** `git checkout main && git merge update/upstream-YYYYMMDD`
8. **Update PersAI:** `openclaw-approved-sha.txt`, `values-dev.yaml`, `CHANGELOG.md`, `SESSION-HANDOFF.md`
9. **Rollback** if broken: `git reset --hard persai-pre-update-YYYYMMDD`

## Live test guidance for agents
- for local-frontend + GKE-backend validation, read `docs/LIVE-TEST-HYBRID.md` before running live checks

## Required session ending output
- what changed
- why changed
- files touched
- tests run
- risks
- next recommended step
- ready commit message