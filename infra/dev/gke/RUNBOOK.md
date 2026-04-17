# Dev GKE Runbook

This runbook defines the current manual bootstrap, reset, and verification procedure for the PersAI-native `persai-dev` environment.

## Prerequisites

- `gcloud` authenticated to the target GCP project
- `kubectl` configured for the target GKE cluster
- repo checked out to the intended revision
- `infra/helm/values-dev.yaml` points at the correct Artifact Registry/project values

Suggested variables:

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="your-gke-region"
export CLUSTER_NAME="your-dev-cluster"
export REPO_URL="https://github.com/example/persai.git"
export EXPECTED_KUBE_CONTEXT="gke_${PROJECT_ID}_${REGION}_${CLUSTER_NAME}"
```

Fetch cluster credentials:

```bash
gcloud container clusters get-credentials "$CLUSTER_NAME" --region "$REGION" --project "$PROJECT_ID"
kubectl config current-context
```

## Cleanup / reset

Preview reset:

```bash
./infra/bootstrap/dev-gke-reset.sh
```

Execute destructive reset:

```bash
EXPECTED_KUBE_CONTEXT="$EXPECTED_KUBE_CONTEXT" ./infra/bootstrap/dev-gke-reset.sh --execute
```

Verify reset result:

```bash
kubectl get ns persai-dev || true
kubectl -n argocd get applications.argoproj.io persai-dev || true
kubectl -n argocd get appprojects.argoproj.io persai-dev || true
```

## First deploy

Create namespace:

```bash
kubectl apply -f infra/dev/gke/namespace.yaml
```

Set the Argo application repo URL in `infra/dev/gitops/argocd/application-dev.yaml`, then apply:

```bash
kubectl apply -f infra/dev/gitops/argocd/project-dev.yaml
kubectl apply -f infra/dev/gitops/argocd/application-dev.yaml
```

Verify Argo objects:

```bash
kubectl -n argocd get appprojects.argoproj.io persai-dev
kubectl -n argocd get applications.argoproj.io persai-dev
```

## Required secrets

Create or update `persai-api-secrets`:

```bash
kubectl -n persai-dev create secret generic persai-api-secrets \
  --from-literal=DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/DB_NAME?schema=public' \
  --from-literal=CLERK_SECRET_KEY='sk_test_replace_me' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Create or update `persai-runtime-secrets`:

```bash
kubectl -n persai-dev create secret generic persai-runtime-secrets \
  --from-literal=PERSAI_INTERNAL_API_TOKEN='replace-with-long-random-token' \
  --from-literal=PERSAI_RUNTIME_SPEC_STORE_REDIS_URL='redis://user:pass@host:6379/0' \
  --from-literal=OPENAI_API_KEY='replace-if-needed' \
  --dry-run=client -o yaml | kubectl apply -f -
```

If Anthropic is used in dev, add `ANTHROPIC_API_KEY` to `persai-runtime-secrets`.

## Config verification

Confirm the active values file references only the PersAI-native path:

```bash
rg "PERSAI_WEB_CHAT_(SYNC|STREAM)_RUNTIME_MODE" infra/helm/values-dev.yaml -n
rg "PERSAI_RUNTIME_BASE_URL|PERSAI_PROVIDER_GATEWAY_BASE_URL" infra/helm/values-dev.yaml -n
rg "persai-runtime-secrets|persai-api-secrets" infra/helm/values-dev.yaml -n
```

Expected truth:

- sync + stream runtime modes are `native`
- API points to `runtime:3012`
- API/runtime point to `provider-gateway:3011` where applicable
- no `openclaw` block or `persai-openclaw-secrets` reference remains

## Sync and rollout verification

If Argo CD CLI is available and logged in:

```bash
argocd app sync persai-dev
```

Cluster-level verification:

```bash
kubectl -n persai-dev get deploy,svc,ingress,networkpolicy
kubectl -n persai-dev get pods -o wide
kubectl -n persai-dev get secret
kubectl -n persai-dev get jobs -l app.kubernetes.io/name=api-migrate
kubectl -n persai-dev logs job/api-migrate --tail=120
```

Expected workloads:

- `api`
- `web`
- `runtime`
- `provider-gateway`

No `openclaw*` deployment, service, configmap, or ingress should exist in the active namespace.

## Pod env verification

Check the active API deployment wiring:

```bash
kubectl -n persai-dev get deploy api -o yaml
kubectl -n persai-dev get deploy runtime -o yaml
kubectl -n persai-dev get deploy provider-gateway -o yaml
```

Confirm:

- `PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE=native`
- `PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE=native`
- `PERSAI_RUNTIME_BASE_URL=http://runtime:3012`
- `PERSAI_PROVIDER_GATEWAY_BASE_URL=http://provider-gateway:3011`
- `PERSAI_INTERNAL_API_TOKEN` comes from `persai-runtime-secrets`

## Health verification

Ingress and service checks:

```bash
kubectl -n persai-dev get ingress persai-ingress -o yaml
kubectl -n persai-dev port-forward svc/api 3001:3001
```

Then from another terminal:

```bash
curl.exe -s http://127.0.0.1:3001/health
curl.exe -s http://127.0.0.1:3001/ready
```

Authenticated runtime preflight check:

```bash
curl.exe -s -H "Authorization: Bearer <user-token>" http://127.0.0.1:3001/api/v1/assistant/runtime/preflight
```

Expected:

- API `/health` and `/ready` are healthy
- runtime preflight returns `live=true` and `ready=true`
- `bot.persai.dev` ingress route points to `api`, not to a separate runtime service
