# Dev GKE Runbook

This runbook defines the current manual bootstrap, reset, and verification procedure for the PersAI-native `persai-dev` environment.

ADR-072 remains the historical migration ADR through the Step 18 native-path closeout. The active follow-through program for lifecycle polish, cost/quality architecture, and deferred Step 19/15a/20 work now lives in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

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

## Dedicated API pool

The dev cluster keeps the API request path isolated on its own autoscaled node pool so long-lived
stream turns do not compete with `runtime`, `provider-gateway`, `web`, or cluster system pods.

Current target shape:

```bash
gcloud container node-pools create api-pool \
  --cluster personal-ai-gke \
  --zone europe-west1-b \
  --machine-type e2-standard-4 \
  --enable-autoscaling \
  --min-nodes 1 \
  --max-nodes 8 \
  --node-labels workload=api \
  --node-taints dedicated=api:NoSchedule
```

Verify:

```bash
kubectl get nodes --show-labels
kubectl get deploy -n persai-dev api -o yaml
kubectl get hpa -n persai-dev api
```

Expected truth:

- `api` pods select nodes with `workload=api`
- `api` tolerates `dedicated=api:NoSchedule`
- `api` HPA min=`2`, max=`8`, CPU target=`60%`

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

## Controlled migration rollout

When a change includes Prisma schema or migration files, the regular `Dev Image Publish` workflow still builds/pushes the affected images, but it intentionally pauses at the `persai-dev-migrations` GitHub Environment before updating `infra/helm/values-dev.yaml`.

Approve that rollout in the GitHub Actions UI:

1. Open the `Dev Image Publish` run for the migration-bearing push on `main`
2. Click `Review deployments`
3. Approve deployment to `persai-dev-migrations`

After the approval-backed rollout job finishes, run:

```bash
kubectl get applications.argoproj.io -n argocd
kubectl -n persai-dev get deploy,svc,ingress,networkpolicy
kubectl -n persai-dev get pods -o wide
kubectl -n persai-dev get jobs -l app.kubernetes.io/name=api-migrate
kubectl -n persai-dev logs job/api-migrate --tail=120
```

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

## ADR-123 Slice 1: Sandbox control-plane cluster-ops (must run before first deploy)

These steps provision the dedicated GCP service account and Workload Identity binding for the
sandbox control plane. Run them once, in order, before deploying the Helm changes from ADR-123.

```bash
export PROJECT_ID="project-44786b14-b7d7-4554-a8a"
export REGION="europe-west1"
export CLUSTER_NAME="personal-ai-gke"
export NAMESPACE="persai-dev"
export KSA_NAME="sandbox-sa"
export GSA_NAME="sandbox-cp"
export GSA_EMAIL="${GSA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 1. Create a dedicated GCP service account for the sandbox control plane

```bash
gcloud iam service-accounts create "${GSA_NAME}" \
  --display-name "PersAI sandbox control plane" \
  --project "${PROJECT_ID}"
```

### 2. Grant GCS object permissions (workspace bucket read/write)

```bash
gcloud storage buckets add-iam-policy-binding gs://persai-dev-workspaces \
  --member "serviceAccount:${GSA_EMAIL}" \
  --role roles/storage.objectAdmin
```

### 2b. Grant Cloud SQL client (REQUIRED — the sandbox control-plane pod runs a cloud-sql-proxy sidecar)

The sandbox Deployment now runs under `sandbox-sa` → `sandbox-cp`, not `api-sa`. Its
cloud-sql-proxy sidecar needs `roles/cloudsql.client` or it fails with
`403 ... missing permission cloudsql.instances.get`, the DB is unreachable, and the
sandbox `/ready` probe returns 503 (rollout never goes healthy).

```bash
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${GSA_EMAIL}" \
  --role roles/cloudsql.client \
  --condition=None
```

### 3. Allow the Kubernetes service account to impersonate the GCP SA (Workload Identity)

```bash
gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:${PROJECT_ID}.svc.id.goog[${NAMESPACE}/${KSA_NAME}]" \
  --project "${PROJECT_ID}"
```

### 4. Verify the Helm-created Kubernetes SA exists after first deploy

```bash
kubectl get serviceaccount "${KSA_NAME}" -n "${NAMESPACE}"
```

The SA is created by `infra/helm/templates/sandbox-serviceaccount.yaml` on the first Helm upgrade.
Run this step after deploying, not before.

### 5. Verify Workload Identity annotation on the SA

```bash
kubectl get serviceaccount "${KSA_NAME}" -n "${NAMESPACE}" \
  -o jsonpath='{.metadata.annotations.iam\.gke\.io/gcp-service-account}'
```

Expected output: `sandbox-cp@project-44786b14-b7d7-4554-a8a.iam.gserviceaccount.com`

### 6. (Optional) Revoke GCS access from the old api-sa if sandbox was the only consumer

If `api-sa` only had GCS object access because the legacy sandbox required it, you can
scope it down after verifying the new `sandbox-sa` is working end-to-end on a live deploy.

### 7. Apply the Prisma migration

The migration `20260620200000_adr123_exec_pod_name` adds `exec_pod_name VARCHAR(128)` to
`sandbox_jobs`. Apply it as part of the normal pre-deploy migration step:

```bash
# From the apps/api directory, against the dev database:
pnpm exec prisma migrate deploy
```

### Validation smoke-test after deploy

```bash
# Check that the sandbox-sa Role and RoleBinding exist:
kubectl get role sandbox-exec-pod-manager -n "${NAMESPACE}"
kubectl get rolebinding sandbox-exec-pod-manager -n "${NAMESPACE}"

# Submit a sandbox job (requires a valid session token) and verify an exec pod is created:
kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/component=sandbox-exec --watch
```

Expected: a short-lived `exec-<jobid>` pod appears with `runtimeClassName: gvisor`, reaches
Running under the `sandbox-pool` node pool, completes, and is deleted automatically.

## ADR-123 Slice 2: Egress proxy + deny-all exec pod network boundary

### 1. Verify the egress proxy Deployment and Service are running

```bash
kubectl -n "${NAMESPACE}" get deploy sandbox-egress-proxy
kubectl -n "${NAMESPACE}" get svc sandbox-egress-proxy
kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/name=sandbox-egress-proxy
```

Expected: 1/1 Running, Service `sandbox-egress-proxy` on port 3128.

### 2. Verify NetworkPolicies are applied

```bash
kubectl -n "${NAMESPACE}" get networkpolicies
```

Expected policies present:

- `sandbox-exec-deny-egress` (selects exec pods by `app.kubernetes.io/component: sandbox-exec`)
- `sandbox-egress-proxy-isolation` (selects proxy pod by `app.kubernetes.io/name: sandbox-egress-proxy`)

### 3. Verify exec pods cannot reach the internet directly

Submit a sandbox job that runs `curl https://example.com` directly (without the proxy env vars set).
The connection must time out or be refused immediately — the NetworkPolicy blocks all egress except DNS and the proxy.

```bash
# Manually inspect an exec pod's env to confirm proxy vars are present:
kubectl -n "${NAMESPACE}" get pod <exec-pod-name> -o jsonpath='{.spec.containers[0].env}'
```

Expected: `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy` all set to
`http://sandbox-egress-proxy.persai-dev.svc.cluster.local:3128`.

### 4. Verify the proxy allowlist is enforced

From within an exec pod (or by running a debug pod with exec-pod labels):

```bash
# Should succeed: pip install resolves via the allowlisted pypi.org
https_proxy=http://sandbox-egress-proxy.persai-dev.svc.cluster.local:3128 \
  curl -I https://pypi.org/simple/

# Should be denied by Squid (403 or connection refused): domain not on allowlist
https_proxy=http://sandbox-egress-proxy.persai-dev.svc.cluster.local:3128 \
  curl -I https://google.com
```

Expected: pypi.org request succeeds (Squid forwards it); google.com request is denied by Squid
with `HTTP 403 Forbidden` or TCP reset.

### 5. Verify exec pods still carry zero secrets

```bash
kubectl -n "${NAMESPACE}" get pod <exec-pod-name> -o jsonpath='{.spec.containers[0].env}' | \
  python3 -c "import sys,json; env=json.load(sys.stdin); \
  secrets=[e for e in env if any(k in e.get('name','') for k in ['TOKEN','KEY','SECRET','DATABASE_URL'])]; \
  print('SECRETS FOUND:', secrets) if secrets else print('CLEAN: no secrets in exec pod env')"
```

Expected: `CLEAN: no secrets in exec pod env`. Only `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`,
`https_proxy`, `NO_PROXY`, `no_proxy` should be present (all non-secret proxy URLs/host lists).

---

## ADR-123 Slice 3: Per-session pod reuse, idle-TTL reaper, GCS workspace snapshot

### 1. Verify session pods are created with stable names and reused

Submit two consecutive sandbox exec/shell jobs for the same session (same `runtimeSessionId`):

```bash
# Watch for exec_pod_session and exec_pod_session_create log lines in the sandbox pod.
kubectl -n "${NAMESPACE}" logs -l app.kubernetes.io/name=sandbox -f | grep exec_pod_session
```

Expected on first job: `exec_pod_session_create pod=ses-<hash>`.
Expected on second job: `exec_pod_session` (reuse) — NO `exec_pod_session_create`.
Session pod names must start with `ses-` and be stable (same hash for same sessionId).

### 2. Verify session pod survives between jobs (not deleted)

```bash
kubectl -n "${NAMESPACE}" get pods -l app.kubernetes.io/component=sandbox-exec
```

Expected: session pod (`ses-<hash>`) remains Running after a job completes and is NOT deleted.
Ephemeral pods (`exec-<jobid>`) must be absent after their job completes (sessionless jobs only).

### 3. Verify idle-TTL reaper fires and deletes stale session pods

After letting a session pod sit idle for longer than `SANDBOX_EXEC_SESSION_IDLE_TTL_MS` (default 30 min), watch the reaper log:

```bash
kubectl -n "${NAMESPACE}" logs -l app.kubernetes.io/name=sandbox -f | grep exec_pod_reaper
```

Expected: `exec_pod_reaper evicting=N idle session pod(s)` followed by `exec_pod_reaper_evict pod=ses-<hash>` and `exec_pod_deleted pod=ses-<hash>`.

### 4. Verify workspace files survive across jobs within a session

Submit a session job that writes a file, then submit a second job that reads it:

```bash
# First job: write ephemeral.py
# Second job: cat ephemeral.py (file should exist from first job)
```

Expected: second job reads the file written by the first job, confirming pod-level workspace persistence.

### 5. Verify GCS session snapshot is created after each job

```bash
# Check for session snapshot keys in the GCS bucket.
gsutil ls "gs://persai-dev-workspaces/assistant-media/assistants/*/sandbox-sessions/*/workspace.tar"
```

Expected: `workspace.tar` objects present under `sandbox-sessions/<runtimeSessionId>/`.

### 6. Verify workspace files survive pod recreation (snapshot restore)

Kill the session pod manually, then submit another job for the same session:

```bash
kubectl -n "${NAMESPACE}" delete pod ses-<hash>
# Submit a new sandbox exec job with the same runtimeSessionId.
```

Expected: the new pod is created (`exec_pod_session_create` logged), and the workspace is restored from the GCS snapshot (ephemeral files from previous jobs should be present).

### 7. Verify Slice 1+2 invariants still hold

```bash
# exec pod must carry zero secrets
kubectl -n "${NAMESPACE}" get pod ses-<hash> -o jsonpath='{.spec.containers[0].env}'
# Expected: only HTTP_PROXY / HTTPS_PROXY / http_proxy / https_proxy / NO_PROXY / no_proxy
# NO DATABASE_URL, NO TOKEN, NO KEY

# exec pod must still use gVisor
kubectl -n "${NAMESPACE}" get pod ses-<hash> -o jsonpath='{.spec.runtimeClassName}'
# Expected: gvisor

# exec pod must have automountServiceAccountToken: false
kubectl -n "${NAMESPACE}" get pod ses-<hash> -o jsonpath='{.spec.automountServiceAccountToken}'
# Expected: false
```

### 8. Warm-pool follow-up (cold-start latency fix) — REQUIRED operational step

The first exec command after idle was failing because the real cold start is ~100s
(sandbox node autoscale + multi-GB exec image pull), far longer than the per-command
runtime cap that was wrongly used as the pod-ready deadline. The code fix introduces a
dedicated pod-provisioning budget (`SANDBOX_EXEC_POD_PROVISION_BUDGET_MS` /
`RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS`, default 4 min) so a cold start succeeds. To
also make it _fast_, keep one warm sandbox node and pre-pull the image:

```bash
# (a) Keep >=1 node always warm on the sandbox pool so the first command does not wait
#     for node autoscale. (Image pre-pull is handled declaratively by the
#     sandbox-exec-prepull DaemonSet shipped in Helm.)
gcloud container node-pools update sandbox-pool \
  --cluster personal-ai-gke \
  --region europe-west1 \
  --enable-autoscaling \
  --min-nodes 1 \
  --max-nodes 4

# (b) Verify the prepull DaemonSet has the exec image cached on every sandbox node:
kubectl -n "${NAMESPACE}" get ds sandbox-exec-prepull
# Expected: DESIRED == READY == number of sandbox-pool nodes

# (c) Verify a warm node is present even with no active sessions:
kubectl get nodes -l workload=sandbox
# Expected: at least one Ready node
```

Expected outcome: with a warm node + cached image, the first sandbox command after idle
completes in seconds instead of ~100s; on a genuinely cold node it still succeeds within
the provisioning budget instead of failing with `process_timeout` / `sandbox_execution_timeout`.

---

## ADR-123 Slice 4: Exec image (Python + Node + doc/data stack + Chromium + ripgrep/fd)

### 1. Confirm exec pod uses the new GAR image

After a Slice 4 deploy, the `SANDBOX_EXEC_IMAGE` env in the sandbox control-plane pod
should point at the GAR `sandbox-exec` image (not `busybox:1.36`):

```bash
kubectl -n "${NAMESPACE}" get deploy sandbox -o jsonpath='{.spec.template.spec.containers[0].env}' \
  | python3 -c "import sys, json; envs = json.load(sys.stdin); print([e for e in envs if e['name']=='SANDBOX_EXEC_IMAGE'])"
# Expected: [{"name": "SANDBOX_EXEC_IMAGE", "value": "europe-west1-docker.pkg.dev/.../persai/sandbox-exec:<sha>"}]
```

### 2. Verify ripgrep and fd are on PATH inside a live exec pod

Submit a sandbox shell job or exec directly into a running session pod:

```bash
kubectl -n "${NAMESPACE}" exec ses-<hash> -- rg --version
# Expected: ripgrep <version> (with enabled SIMD features)

kubectl -n "${NAMESPACE}" exec ses-<hash> -- fd --version
# Expected: fd <version>
```

### 3. Verify the Python doc/data stack imports correctly

```bash
kubectl -n "${NAMESPACE}" exec ses-<hash> -- \
  python3 -c "import pandas, numpy, matplotlib, openpyxl, docx, weasyprint, pdfplumber, PIL; print('ok')"
# Expected: ok
```

### 4. Verify Node.js 22 is on PATH

```bash
kubectl -n "${NAMESPACE}" exec ses-<hash> -- node --version
# Expected: v22.x.x
```

### 5. Verify Chromium version (Slice 5 will exercise actual render)

```bash
kubectl -n "${NAMESPACE}" exec ses-<hash> -- chromium --version
# Expected: Chromium <version>
# Slice 5 note: invoke with --no-sandbox --headless=new --user-data-dir=/tmp/chromium-profile
```

### 6. Verify exec pod runs as uid=1000 (non-root)

```bash
kubectl -n "${NAMESPACE}" exec ses-<hash> -- id
# Expected: uid=1000(sandbox) gid=1000(sandbox)
```

### 7. Verify root filesystem is read-only (write to /etc should fail; /workspace and /tmp should succeed)

```bash
kubectl -n "${NAMESPACE}" exec ses-<hash> -- sh -c "echo test > /etc/should-fail" 2>&1 || echo "PASS: root FS is read-only"
kubectl -n "${NAMESPACE}" exec ses-<hash> -- sh -c "echo test > /workspace/check.txt && cat /workspace/check.txt && rm /workspace/check.txt" && echo "PASS: /workspace is writable"
kubectl -n "${NAMESPACE}" exec ses-<hash> -- sh -c "echo test > /tmp/check.txt && cat /tmp/check.txt && rm /tmp/check.txt" && echo "PASS: /tmp is writable"
```

### 8. Verify Slice 1–3 invariants still hold (no regressions)

Run Slice 3 verification steps 1–7 as before.
