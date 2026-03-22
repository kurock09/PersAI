# v2 Foundation Repo

This repository contains the greenfield v2 foundation phase for the project.

The goal of this phase is to build a clean platform baseline for future product development.
This is not the full product yet.

## Current scope

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
- `GET /api/v1/me`
- `POST /api/v1/me/onboarding`
- workspace create/update flow
- protected `/app`
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
- WebSockets in `apps/api`
- product feature flags

## Repository structure

```text
apps/
  web/
  api/

services/
  openclaw/

packages/
  contracts/
  config/
  logger/
  types/
  eslint-config/
  tsconfig/

infra/
docs/
.github/