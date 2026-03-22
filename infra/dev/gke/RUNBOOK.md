# Dev GKE Runbook

This runbook defines exact manual procedures for dev cleanup/reset and first dev deploy.

## Prerequisites

- `gcloud` authenticated to target project
- `kubectl` and cluster credentials
- Argo CD installed in `argocd` namespace
- repo checked out with latest `main`
- `infra/helm/values-dev.yaml` points to your real Artifact Registry coordinates under `global.images.*`

Export variables (adjust values):

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="your-gke-region"
export CLUSTER_NAME="your-dev-cluster"
export REPO_URL="https://github.com/example/persai.git"
export EXPECTED_KUBE_CONTEXT="gke_${PROJECT_ID}_${REGION}_${CLUSTER_NAME}"
```

Connect kubectl to the dev cluster:

```bash
gcloud container clusters get-credentials "$CLUSTER_NAME" --region "$REGION" --project "$PROJECT_ID"
```

---

## Cleanup / Reset Procedure (manual-only)

1. Preview reset commands:

```bash
./infra/bootstrap/dev-gke-reset.sh
```

2. Execute one-time reset (destructive for dev namespace/app objects):

```bash
EXPECTED_KUBE_CONTEXT="$EXPECTED_KUBE_CONTEXT" ./infra/bootstrap/dev-gke-reset.sh --execute
```

3. Verify cleanup completed:

```bash
kubectl get ns persai-dev || true
kubectl -n argocd get applications.argoproj.io persai-dev || true
kubectl -n argocd get appprojects.argoproj.io persai-dev || true
```

---

## First Dev Deploy Procedure (manual-only)

1. Ensure namespace manifest is present:

```bash
kubectl apply -f infra/dev/gke/namespace.yaml
```

2. Set Argo CD application source repo URL in `infra/dev/gitops/argocd/application-dev.yaml` to match this repo.

Example (manual edit or scripted replace):

```bash
sed -i.bak "s|https://github.com/example/persai.git|${REPO_URL}|g" infra/dev/gitops/argocd/application-dev.yaml
```

3. Apply Argo CD project:

```bash
kubectl apply -f infra/dev/gitops/argocd/project-dev.yaml
```

4. Apply Argo CD application:

```bash
kubectl apply -f infra/dev/gitops/argocd/application-dev.yaml
```

5. Verify Argo resources:

```bash
kubectl -n argocd get appprojects.argoproj.io persai-dev
kubectl -n argocd get applications.argoproj.io persai-dev
```

6. Verify target namespace resources:

```bash
kubectl -n persai-dev get deploy,svc
```

7. Create/update required API secret values in dev namespace:

```bash
kubectl -n persai-dev create secret generic persai-api-secrets \
  --from-literal=DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/DB_NAME?schema=public' \
  --from-literal=CLERK_SECRET_KEY='sk_test_replace_me' \
  --dry-run=client -o yaml | kubectl apply -f -
```

8. Verify OpenClaw remains disabled by default in dev values:

```bash
rg "openclaw:" infra/helm/values-dev.yaml -n
rg "enabled: false" infra/helm/values-dev.yaml -n
rg "global:" infra/helm/values-dev.yaml -n
rg "images:" infra/helm/values-dev.yaml -n
```

9. Verify API runtime env wiring in dev values:

```bash
rg "^  env:" infra/helm/values-dev.yaml -n
rg "^  secretEnv:" infra/helm/values-dev.yaml -n
```

10. Verify API Cloud SQL proxy is enabled in dev values:

```bash
rg "cloudSqlProxy|instanceConnectionName" infra/helm/values-dev.yaml -n
```

11. Verify web Clerk publishable key is configured in dev values:

```bash
rg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" infra/helm/values-dev.yaml -n
```

12. Verify web Clerk secret key mapping is configured in dev values:

```bash
rg "web.secretEnv|CLERK_SECRET_KEY" infra/helm/values-dev.yaml -n
```

13. Verify dev image tag is pinned to commit SHA in GitOps values:

```bash
rg "^    tag: " infra/helm/values-dev.yaml -n
```

Expected:

- `global.images.tag` is a commit SHA (immutable), not a moving tag like `dev-main`.
- this value is updated automatically by `.github/workflows/dev-image-publish.yml` on successful `main` pushes.

14. Step 2 foundation deploy-path verification (manual):

```bash
# App resources are up
kubectl -n persai-dev get deploy,svc,pods

# Protected route exists (requires auth in browser session)
kubectl -n persai-dev port-forward svc/web 3000:3000
# open http://localhost:3000/app and verify redirect/protection behavior

# API me/onboarding path on deployed API (use a valid Clerk bearer token)
kubectl -n persai-dev port-forward svc/api 3001:3001
curl -i -H "Authorization: Bearer <CLERK_JWT>" http://localhost:3001/api/v1/me
curl -i -X POST -H "Authorization: Bearer <CLERK_JWT>" -H "Content-Type: application/json" \
  -d '{"displayName":"Dev User","workspaceName":"Dev Workspace","locale":"en-US","timezone":"UTC"}' \
  http://localhost:3001/api/v1/me/onboarding
curl -i -H "Authorization: Bearer <CLERK_JWT>" http://localhost:3001/api/v1/me
```

Expected baseline:

- `/app` is protected.
- first authenticated `/api/v1/me` returns onboarding `pending` when no membership exists.
- `/api/v1/me/onboarding` returns onboarding `completed` and workspace summary.
- repeated onboarding call with same payload remains stable (idempotent state).

## OpenClaw Rule

- `openclaw.enabled` must remain `false` by default in `infra/helm/values-dev.yaml`.
- Do not enable OpenClaw in Step 1 deploy path.
