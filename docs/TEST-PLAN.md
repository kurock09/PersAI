# Test Plan

This document defines the current verification baseline for the active PersAI-native path.

## Required repo checks

Run these before calling a change clean:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

Add focused tests for touched code paths when the change affects behavior.

## Helm / deploy truth checks

Validate rendered deploy truth:

```bash
helm lint infra/helm -f infra/helm/values.yaml
helm lint infra/helm -f infra/helm/values-dev.yaml
helm template persai infra/helm -f infra/helm/values.yaml > /dev/null
helm template persai-dev infra/helm -f infra/helm/values-dev.yaml > /dev/null
```

Expected active components:

- `api`
- `web`
- `runtime`
- `provider-gateway`

No rendered `openclaw*` workload, service, configmap, ingress, or secret wiring should remain in the active chart path.

## Live cluster checks

For `persai-dev`, verify:

```bash
kubectl -n persai-dev get deploy,svc,ingress,networkpolicy
kubectl -n persai-dev get pods -o wide
kubectl -n persai-dev get secret
kubectl get applications.argoproj.io -n argocd
```

Expected:

- only `api`, `web`, `runtime`, and `provider-gateway` workloads are active
- ingress `bot.persai.dev` routes to `api`
- `persai-runtime-secrets` is the active native-runtime secret object
- no `openclaw*` resource remains in the active namespace

## Runtime path checks

Verify the active runtime path from the cluster:

```bash
kubectl -n persai-dev get deploy api -o yaml
kubectl -n persai-dev get deploy runtime -o yaml
kubectl -n persai-dev get deploy provider-gateway -o yaml
```

Expected env truth:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `RUNTIME_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`

## User-path smoke

At minimum, prove:

1. API `/health` and `/ready` are healthy
2. authenticated `GET /api/v1/assistant/runtime/preflight` returns `live=true` and `ready=true`
3. ordinary `/app` web chat completes on the current native path
4. the cluster has no active dependency on a removed legacy runtime service

## Historical traces

The following may still contain historical OpenClaw references without being treated as an active-path failure:

- `docs/ADR/*`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- old Prisma/SQL migrations

Everything else that presents current deploy/debug truth must match the PersAI-native path.
