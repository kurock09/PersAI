# PersAI Foundation Repo

This repository contains the active PersAI platform baseline.

## Current active path

- `apps/api` is the public control plane and ingress-facing backend
- `apps/web` is the user and admin UI
- `apps/runtime` is the PersAI-native execution service
- `apps/provider-gateway` is the internal provider bridge used by native runtime execution
- `apps/sandbox` is the isolated tool/media execution sidecar used by runtime
- `infra/helm` and `infra/dev/gitops` define the active dev deploy path for `persai-dev`

OpenClaw is not part of the active PersAI deploy, runtime, or control-plane path in this repo. Historical references are intentionally retained only in ADRs, changelog snapshots, session handoff logs, and old migrations.

The active continuation backlog is tracked in `docs/ADR/078-consolidated-follow-through-program.md`. ADR-072 remains the historical migration ADR, and ADR-073 through ADR-077 are archived historical follow-through ADRs.

## Repository structure

```text
apps/
  api/
  provider-gateway/
  runtime/
  sandbox/
  web/

packages/
  config/
  contracts/
  eslint-config/
  logger/
  tsconfig/
  types/

infra/
docs/
.github/
```

## Local database bootstrap

Start local Postgres:

```bash
docker compose -f infra/local/docker-compose.postgres.yml up -d
```

Apply migrations and seed:

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public"
corepack pnpm --filter @persai/api run prisma:migrate:deploy
corepack pnpm --filter @persai/api run prisma:seed
```

Helpful checks:

```bash
corepack pnpm --filter @persai/api run prisma:migrate:status
corepack pnpm run prisma:migrate:check
```

## Dev deploy baseline

The active dev deploy path is GitOps-managed:

- Argo CD application: `infra/dev/gitops/argocd/application-dev.yaml`
- Helm chart: `infra/helm`
- Dev values: `infra/helm/values-dev.yaml`
- Namespace: `persai-dev`

The active dev namespace should contain only these workload families:

- `api`
- `web`
- `runtime`
- `provider-gateway`
- `sandbox`

Current secret split:

- `persai-api-secrets`: API/web/database/admin secrets
- `persai-runtime-secrets`: native runtime/provider-gateway secrets such as `PERSAI_INTERNAL_API_TOKEN`, `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`, and provider API keys

Current runtime routing truth:

- web sync and stream use `PERSAI_WEB_CHAT_*_RUNTIME_MODE=native`
- API talks to `runtime` via `PERSAI_RUNTIME_BASE_URL`
- runtime talks to `provider-gateway` via `RUNTIME_PROVIDER_GATEWAY_BASE_URL`
- `bot.persai.dev/telegram-webhook` is routed to `api`, not to a separate runtime ingress

## CI / image publish

Active image publish is driven by `.github/workflows/dev-image-publish.yml`.

PR CI risk-splits checks through `scripts/ci/detect-affected.mjs`:

- affected lint
- affected typecheck
- affected focused tests
- conditional heavier integration gates for risky boundaries
- full CI remains for risky paths on ordinary CI
- `.github/workflows/full-verification.yml` owns nightly / merge-queue / manual full verification

Dev image publish is selective:

- only affected services build/push
- only affected service tags are pinned in `infra/helm/values-dev.yaml`
- `global.images.tag` stays as the fallback for unchanged services

Main `CI` intentionally ignores bot-only commits that update only `infra/helm/values-dev.yaml`, so the GitOps tag-pin follow-up commit does not re-run the full repository checks by itself.

There is no active OpenClaw image pin or fork-based deploy step in the current path.

## Useful docs

- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/ADR/078-consolidated-follow-through-program.md`
- `docs/TEST-PLAN.md`
- `docs/LIVE-TEST-HYBRID.md`
- `infra/dev/gke/RUNBOOK.md`
- `infra/dev/gitops/README.md`
