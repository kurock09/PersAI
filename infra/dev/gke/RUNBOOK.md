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

Expected:

- `persai-dev` application uses automated sync.
- `api-migrate` PreSync hook job executes on each sync before API rollout.

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

8. Verify OpenClaw is enabled in dev values and port is aligned:

```bash
rg "openclaw:" infra/helm/values-dev.yaml -n
rg "enabled: true" infra/helm/values-dev.yaml -n
rg "port: 18789" infra/helm/values-dev.yaml -n
rg "global:" infra/helm/values-dev.yaml -n
rg "images:" infra/helm/values-dev.yaml -n
```

9. Verify API runtime env wiring in dev values:

```bash
rg "^  env:" infra/helm/values-dev.yaml -n
rg "^  secretEnv:" infra/helm/values-dev.yaml -n
```

10. Verify API runtime identity wiring is configured in dev values:

```bash
rg "serviceAccount:" infra/helm/values-dev.yaml -n
rg "gcpServiceAccountEmail" infra/helm/values-dev.yaml -n
```

11. Verify API Cloud SQL proxy is enabled with private IP in dev values:

```bash
rg "cloudSqlProxy|instanceConnectionName|usePrivateIp" infra/helm/values-dev.yaml -n
```

12. Verify web Clerk publishable key is configured in dev values:

```bash
rg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" infra/helm/values-dev.yaml -n
```

13. Verify web Clerk secret key mapping is configured in dev values:

```bash
rg "web.secretEnv|CLERK_SECRET_KEY" infra/helm/values-dev.yaml -n
```

14. Create/update OpenClaw gateway auth secret in dev namespace:

```bash
kubectl -n persai-dev create secret generic persai-openclaw-secrets \
  --from-literal=OPENCLAW_GATEWAY_TOKEN='replace-with-long-random-token' \
  --from-literal=PERSAI_INTERNAL_API_TOKEN='replace-with-separate-long-random-token' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Important for auto-sync environments:

- if Argo CD tracks this branch automatically, create/update the required secret values first
- verify the key exists in Kubernetes before merging/pushing the Git change that consumes it
- do not let auto-sync roll out code that requires a new secret key before that key is present in cluster
- current Step 15 status note: `PERSAI_INTERNAL_API_TOKEN` has now been created in the dev secret source-of-truth and synced into `persai-dev/persai-openclaw-secrets`; treat that as the baseline to preserve, not a future TODO

15. Verify dev image tag is pinned to commit SHA in GitOps values:

```bash
rg "^    tag: " infra/helm/values-dev.yaml -n
rg "openclaw-approved-sha.txt" infra/dev/gitops/README.md -n
```

Expected:

- `global.images.tag` is a commit SHA (immutable), not a moving tag like `dev-main`.
- this value is updated automatically by `.github/workflows/dev-image-publish.yml` on successful `main` pushes.
- OpenClaw image is pinned by `openclaw.image.tag` to the approved OpenClaw fork SHA.
- When you bump `openclaw-approved-sha.txt` to a **new** fork commit: **`git push` that commit to `https://github.com/kurock09/openclaw` first**, then merge PersAI `main` (or re-run failed GitHub Actions). If PersAI CI runs first, clone/fetch may fail with `upload-pack: not our ref <sha>`.

16. Trigger Argo CD sync to apply OpenClaw O3 wiring:

```bash
argocd app sync persai-dev
```

16.1 Verify migration hook status for the sync:

```bash
kubectl -n persai-dev get jobs -l app.kubernetes.io/name=api-migrate
kubectl -n persai-dev logs job/api-migrate --tail=120
```

Expected:

- Job exit is successful.
- output includes successful Prisma migrate deploy/status.

  16.2 If migration hook fails due to Cloud SQL authorization:

```bash
# GSA used by api-sa must include Cloud SQL Client role
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:api-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

16.3 If Step 11 web attachment staging fails with `storage.objects.create denied`:

```bash
# api now writes PersAI-owned attachment objects directly to the media bucket
gcloud storage buckets add-iam-policy-binding "gs://persai-dev-workspaces" \
  --member="serviceAccount:api-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

17. Verify OpenClaw deployment and service:

```bash
kubectl -n persai-dev get deploy,svc -l app.kubernetes.io/name=openclaw
kubectl -n persai-dev logs deployment/openclaw-free-shared-restricted-sandbox --tail=120
```

18. Verify OpenClaw health endpoints through port-forward:

```bash
kubectl -n persai-dev port-forward svc/openclaw-free-shared-restricted-sandbox 18789:18789
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/readyz
```

18.1 Verify sandbox-capable backend prerequisites on the target shared pool before treating sandbox activation as real:

```bash
kubectl -n persai-dev exec deployment/openclaw-free-shared-restricted-sandbox -- which docker
kubectl -n persai-dev exec deployment/openclaw-free-shared-restricted-sandbox -- printenv DOCKER_HOST
kubectl -n persai-dev exec deployment/openclaw-free-shared-restricted-sandbox -- sh -lc 'test -S /run/user/1000/docker.sock && echo socket-ok'
kubectl -n persai-dev exec deployment/openclaw-free-shared-restricted-sandbox -c docker-dind -- sh -lc 'ls -ld /mnt/workspaces/persai /home/node/.openclaw/workspace'
```

Expected:

- `docker` is available in the runtime image.
- `DOCKER_HOST` is present for the sandbox-capable pool.
- the rootless Docker socket/backend path (`/run/user/1000/docker.sock`) is mounted and reachable inside the OpenClaw container.
- the `docker-dind` sidecar sees the same bind-source paths the runtime will hand to Docker (`/mnt/workspaces/persai` and `/home/node/.openclaw/workspace`).

  18.2 Verify sandbox image pull identity before relying on auto-recovery of fresh pods:

```bash
gcloud artifacts repositories get-iam-policy persai --location=europe-west1
kubectl -n persai-dev exec deployment/openclaw-free-shared-restricted-sandbox -- python3 -c "import urllib.request; req=urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', headers={'Metadata-Flavor':'Google'}); print(urllib.request.urlopen(req, timeout=10).read().decode())"
```

Expected:

- the GAR repository policy includes `serviceAccount:openclaw-runtime@<PROJECT_ID>.iam.gserviceaccount.com` with `roles/artifactregistry.reader`
- the pod identity still resolves to the expected `openclaw-runtime` GSA

19. Verify OpenClaw explicit Control UI origin policy wiring:

```bash
kubectl -n persai-dev get configmap openclaw-config -o yaml | rg "allowedOrigins|dangerouslyAllowHostHeaderOriginFallback|localhost:18789|127.0.0.1:18789" -n
```

19.1 Verify API internal listener/service split:

```bash
kubectl -n persai-dev get svc api api-internal
kubectl -n persai-dev get deploy/api -o yaml | rg "API_INTERNAL_PORT|containerPort: 3002|containerPort: 3001" -n
kubectl -n persai-dev get configmap openclaw-config -o yaml | rg "api-internal:3002|provider-secrets/resolve" -n
```

Expected:

- `svc/api` exposes `3001`
- `svc/api-internal` exposes `3002`
- API deployment exposes both ports
- OpenClaw config references `http://api-internal:3002` for PersAI internal runtime calls

  19.2 Verify CIDR / NetworkPolicy rollout readiness before merge or auto-sync deploy:

```bash
corepack pnpm run shared-runtime:readiness
corepack pnpm run shared-runtime:readiness:strict
corepack pnpm run runtime-pools:readiness
corepack pnpm run runtime-pools:readiness:strict
corepack pnpm run networkpolicy:readiness
corepack pnpm run networkpolicy:readiness:strict
helm template persai-dev infra/helm -f infra/helm/values-dev.yaml
```

Expected:

- `shared-runtime:readiness` confirms the prepared shared-runtime hardening baseline is still intact (tool deny set, token split wiring, internal API base URLs, prepared sandbox limits)
- `shared-runtime:readiness:strict` exits non-zero if that prepared baseline regresses
- `runtime-pools:readiness` confirms the chart renders explicit pool services for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`
- `runtime-pools:readiness:strict` exits non-zero if any canonical pool is disabled or if any required tier URL is missing/mismatched
- active adapter routing uses only `OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED`, `OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED`, and `OPENCLAW_BASE_URL_PAID_ISOLATED`
- `networkpolicy:readiness` clearly shows whether API/OpenClaw policies are renderable with the current CIDR inputs
- `networkpolicy:readiness:strict` exits non-zero while required CIDR inputs are still missing
- only merge/push CIDR-dependent policy changes on an auto-synced branch after the strict check passes

CIDR source-of-truth rules:

- for `networkPolicy.apiIngress.publicIpBlocks`, use the trusted pod-visible/public ingress proxy ranges that actually represent `api.persai.dev` traffic in the current GKE path
- for `networkPolicy.openclawIngress.trustedIngressIpBlocks`, use the trusted pod-visible ingress/proxy ranges that actually reach the OpenClaw pod
- for GKE Ingress-backed paths, start from official Google Cloud Load Balancing firewall-rules documentation; current commonly used IPv4 GFE/health-check ranges include `35.191.0.0/16` and `130.211.0.0/22`, but verify them again at rollout time
- use Telegram webhook ranges from `core.telegram.org/bots/webhooks` only as supplemental sender CIDRs when they are actually pod-visible in your ingress path; do not assume they are the only pod-level allowlist behind GKE Ingress

Canonical starter block for `infra/helm/values-dev.yaml`:

```yaml
networkPolicy:
  apiIngress:
    # Replace with the real pod-visible/public ingress proxy CIDRs for api.persai.dev.
    # Example GKE/GCLB starter values to verify before use:
    # publicIpBlocks:
    #   - 35.191.0.0/16
    #   - 130.211.0.0/22
    publicIpBlocks: []
    extraFromIpBlocks: []
  openclawIngress:
    # Replace with the real pod-visible ingress/proxy CIDRs that reach the OpenClaw pod.
    # Example GKE/GCLB starter values to verify before use:
    # trustedIngressIpBlocks:
    #   - 35.191.0.0/16
    #   - 130.211.0.0/22
    trustedIngressIpBlocks: []
    # Optional supplemental Telegram sender CIDRs only if they are truly pod-visible:
    # telegramWebhookIpBlocks:
    #   - 149.154.160.0/20
    #   - 91.108.4.0/22
    telegramWebhookIpBlocks: []
```

19.3 Pre-prod merge gate for agents and operators:

Do **not** merge/push CIDR-dependent runtime hardening changes on an auto-synced branch until all of the following are true:

1. `persai-openclaw-secrets` already contains both `OPENCLAW_GATEWAY_TOKEN` and `PERSAI_INTERNAL_API_TOKEN` in the secret source-of-truth **and** in Kubernetes.
2. `corepack pnpm run shared-runtime:readiness:strict` passes.
3. `corepack pnpm run runtime-pools:readiness:strict` passes.
4. `infra/helm/values-dev.yaml` has real verified values for:
   - `networkPolicy.apiIngress.publicIpBlocks`
   - `networkPolicy.openclawIngress.trustedIngressIpBlocks`
   - optional `networkPolicy.openclawIngress.telegramWebhookIpBlocks` only if truly pod-visible
5. `corepack pnpm run networkpolicy:readiness:strict` passes.
6. `helm template persai-dev infra/helm -f infra/helm/values-dev.yaml` renders successfully.
7. The current GKE ingress path has been checked against the documented source-of-truth:
   - Google Cloud Load Balancing firewall-rules guidance for pod-visible ingress/proxy ranges
   - Telegram webhook docs only as supplemental sender input when relevant

If any item above is still false, stop and do not let auto-sync deploy the change yet.

20. Step 2 foundation deploy-path verification (manual):

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

21. Verify OpenClaw O4 standalone runtime health from inside cluster:

```bash
# Deployment/service/pod status
kubectl -n persai-dev get deploy/openclaw
kubectl -n persai-dev get svc/openclaw
kubectl -n persai-dev get pods -l app.kubernetes.io/name=openclaw -o wide

# Probe behavior configured on deployment
kubectl -n persai-dev describe deploy openclaw

# Runtime listener confirmation
kubectl -n persai-dev logs deployment/openclaw --tail=80

# In-cluster HTTP health/readiness against service DNS name
kubectl -n persai-dev run openclaw-healthcheck-o4 --image=curlimages/curl:8.10.1 --restart=Never --command -- \
  sh -c "curl -fsS http://openclaw:18789/healthz && echo && curl -fsS http://openclaw:18789/readyz"
kubectl -n persai-dev wait --for=jsonpath='{.status.phase}'=Succeeded pod/openclaw-healthcheck-o4 --timeout=90s
kubectl -n persai-dev logs pod/openclaw-healthcheck-o4
kubectl -n persai-dev delete pod openclaw-healthcheck-o4 --wait=true
```

Expected O4 signals:

- `deploy/openclaw` shows `READY 1/1` and `AVAILABLE 1`.
- `pod` for OpenClaw shows `1/1 Running`.
- deployment describe includes readiness `GET /readyz` and liveness `GET /healthz` on port `18789`.
- logs show gateway listening on `ws://0.0.0.0:18789`.
- in-cluster health pod returns:
  - `{"ok":true,"status":"live"}`
  - `{"ready":true}`

## OpenClaw Rule

- OpenClaw is enabled in O3 dev wiring as a standalone service.
- Do not connect `apps/api` to OpenClaw in this stage.
