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