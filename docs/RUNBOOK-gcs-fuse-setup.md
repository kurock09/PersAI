# GCS FUSE Setup Runbook

Prerequisites for GCS FUSE workspace persistence on GKE.
These steps must be run **once per environment** before deploying with `workspace.gcsFuse.enabled: true`.

## Execution Log (Dev)

All steps completed on 2026-03-26:

| Step | Status | Notes |
|---|---|---|
| 1. GCS FUSE CSI Driver addon | Done | Cluster `personal-ai-gke` updated (~7.5 min) |
| 2. GCS bucket | Done | `gs://persai-dev-workspaces` created in `europe-west1` |
| 3. GCP IAM SA | Done | `openclaw-runtime@project-44786b14-b7d7-4554-a8a.iam.gserviceaccount.com` |
| 4. Bucket IAM binding | Done | `roles/storage.objectAdmin` granted |
| 5. Workload Identity binding | Done | `persai-dev/openclaw-sa` -> GCP SA bound |

## Variables

| Variable | Dev value |
|---|---|
| `PROJECT_ID` | `project-44786b14-b7d7-4554-a8a` |
| `CLUSTER_NAME` | `personal-ai-gke` |
| `ZONE` | `europe-west1-b` |
| `NAMESPACE` | `persai-dev` |
| `BUCKET` | `persai-dev-workspaces` |
| `GCP_SA` | `openclaw-runtime` |
| `GCP_SA_EMAIL` | `openclaw-runtime@project-44786b14-b7d7-4554-a8a.iam.gserviceaccount.com` |
| `K8S_SA` | `openclaw-sa` |

## Step 1: Enable GCS FUSE CSI Driver on GKE cluster

```bash
gcloud container clusters update $CLUSTER_NAME \
  --update-addons GcsFuseCsiDriver=ENABLED \
  --region $REGION
```

## Step 2: Create GCS bucket

```bash
gcloud storage buckets create gs://$BUCKET \
  --location=$REGION \
  --uniform-bucket-level-access \
  --project=$PROJECT_ID
```

## Step 3: Create GCP IAM Service Account

```bash
gcloud iam service-accounts create $GCP_SA \
  --display-name="OpenClaw Runtime SA for PersAI workspaces" \
  --project=$PROJECT_ID
```

## Step 4: Grant bucket access to GCP SA

```bash
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:${GCP_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

## Step 5: Bind Workload Identity (K8s SA to GCP SA)

```bash
gcloud iam service-accounts add-iam-policy-binding \
  ${GCP_SA}@${PROJECT_ID}.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[${NAMESPACE}/${K8S_SA}]"
```

## Step 6: Deploy via Helm

The Helm chart handles:
- Creating K8s ServiceAccount `openclaw-sa` with `iam.gke.io/gcp-service-account` annotation
- Adding CSI volume with `gcsfuse.csi.storage.gke.io` driver
- Mounting bucket at `/mnt/workspaces/persai`
- Setting `PERSAI_WORKSPACE_ROOT=/mnt/workspaces/persai`
- Adding pod annotation `gke-gcsfuse/volumes: "true"`

```bash
helm upgrade --install persai infra/helm -f infra/helm/values-dev.yaml
```

## Verification

After deploy, exec into the openclaw pod and verify:

```bash
kubectl exec -it deploy/openclaw -n persai-dev -- ls /mnt/workspaces/persai
```

The directory should be writable. Test with:

```bash
kubectl exec -it deploy/openclaw -n persai-dev -- touch /mnt/workspaces/persai/test && echo OK
```
