# AGENTS.md

## Mission
This repository is a greenfield v2 foundation phase.
The goal is to build a clean platform baseline, not product breadth.

## Current phase
Foundation Phase only.

### Step 1
- monorepo scaffold
- docs baseline
- CI baseline
- infra baseline
- local/dev baseline
- logger/config/request context baseline
- Prisma baseline
- app skeletons
- health/readiness/metrics baseline

### Step 2
- Clerk auth integration
- internal app user model
- GET /api/v1/me
- POST /api/v1/me/onboarding
- workspace create/update flow
- protected /app
- onboarding gate
- smoke/e2e for this flow

## Out of scope
- chat
- OpenClaw runtime integration
- channels
- Telegram
- billing provider integration
- knowledge retrieval
- admin console
- background jobs implementation
- GraphQL
- WebSockets in apps/api
- product feature flags
- dead placeholder code

## Mandatory startup reading order
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ARCHITECTURE.md
5. docs/API-BOUNDARY.md
6. docs/DATA-MODEL.md
7. docs/TEST-PLAN.md
8. relevant docs/ADR/*

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

## Required session ending output
- what changed
- why changed
- files touched
- tests run
- risks
- next recommended step
- ready commit message