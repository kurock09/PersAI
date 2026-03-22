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

7. Verify OpenClaw remains disabled by default in dev values:

```bash
rg "openclaw:" infra/helm/values-dev.yaml -n
rg "enabled: false" infra/helm/values-dev.yaml -n
rg "global:" infra/helm/values-dev.yaml -n
rg "images:" infra/helm/values-dev.yaml -n
```

## OpenClaw Rule

- `openclaw.enabled` must remain `false` by default in `infra/helm/values-dev.yaml`.
- Do not enable OpenClaw in Step 1 deploy path.
