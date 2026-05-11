# Dev GKE Infra Baseline

This directory documents the current PersAI-native dev baseline for `persai-dev`.

ADR-072 is closed as the historical native migration ADR. The active continuation backlog now lives in `docs/ADR/078-consolidated-follow-through-program.md`.

## Active scope

- namespace and Argo CD bootstrap
- Helm deploy for `api`, `web`, `runtime`, and `provider-gateway`
- Google Artifact Registry image pull/publish wiring
- Workload Identity and Cloud SQL proxy wiring for `api` and `runtime`
- manual reset/bootstrap procedures described in `infra/dev/gke/RUNBOOK.md`

## Active deploy truth

The active chart does not deploy OpenClaw workloads or OpenClaw-specific ingress, secrets, or configmaps.

Current workload set in `persai-dev`:

- `deployment/api`
- `deployment/web`
- `deployment/runtime`
- `deployment/provider-gateway`
- `service/api`
- `service/api-internal`
- `service/web`
- `service/runtime`
- `service/provider-gateway`

Current ingress truth:

- `persai.dev` -> `web:3000`
- `api.persai.dev` -> `api:3001`
- `bot.persai.dev` `/telegram-webhook` -> `api:3001`

## Secret mapping

Required namespace secrets:

- `persai-api-secrets`
  - `DATABASE_URL`
  - `CLERK_SECRET_KEY`
  - optional admin/runtime support keys such as `ADMIN_STEP_UP_HMAC_SECRET`, `RUNTIME_PROVIDER_SECRETS_MASTER_KEY`, `TELEGRAM_WEBHOOK_HMAC_SECRET`
- `persai-runtime-secrets`
  - `PERSAI_INTERNAL_API_TOKEN`
  - `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`
  - provider keys such as `OPENAI_API_KEY` and optional `ANTHROPIC_API_KEY`

Current secret usage:

- `api` reads `DATABASE_URL` and `CLERK_SECRET_KEY` from `persai-api-secrets`
- `api`, `runtime`, and `provider-gateway` read `PERSAI_INTERNAL_API_TOKEN` from `persai-runtime-secrets`
- `runtime` reads `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL` from `persai-runtime-secrets` as `RUNTIME_STATE_REDIS_URL`
- `provider-gateway` reads provider API keys from `persai-runtime-secrets`

## Runtime/config truth

Current dev routing in `infra/helm/values-dev.yaml`:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `PERSAI_API_BASE_URL=http://api-internal:3002`

## Image publish

Active image publish is handled by `.github/workflows/dev-image-publish.yml`.

That workflow publishes only the affected active PersAI images and updates the matching service `image.tag` fields in `infra/helm/values-dev.yaml` to the immutable Git SHA used by Argo CD. `global.images.tag` remains the fallback for unchanged services. Prisma/schema/migration pushes stop before auto-pinning and must be approved through `.github/workflows/dev-migration-rollout.yml`. There is no separate OpenClaw image publish step in the current path.

## Related files

- `infra/dev/gke/namespace.yaml`
- `infra/dev/gitops/argocd/project-dev.yaml`
- `infra/dev/gitops/argocd/application-dev.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `infra/dev/gke/RUNBOOK.md`
