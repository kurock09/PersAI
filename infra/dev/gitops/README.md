# Dev GitOps Baseline

This directory contains the Step 1 GitOps/Argo CD skeleton for dev.

## Deploy path (explicit)

1. Argo CD project: `infra/dev/gitops/argocd/project-dev.yaml`
2. Argo CD application: `infra/dev/gitops/argocd/application-dev.yaml`
3. Helm source chart: `infra/helm`
4. Dev values file: `infra/helm/values-dev.yaml`

Dev values image composition pattern:

- registry host: `global.images.registryHost`
- project id: `global.images.projectId`
- GAR repository: `global.images.repository`
- shared deployed tag: `global.images.tag` (pinned by CI to immutable `${GITHUB_SHA}`)
- component names: `api.image.name`, `web.image.name`, `openclaw.image.name`
- api runtime env is supplied from values + k8s secret refs:
  - `api.env` (non-secret runtime config)
  - `api.secretEnv` (`secretKeyRef` mapping for required secrets)
- api database runtime path in dev:
  - API deployment uses dedicated runtime service account (`api.serviceAccount.*`)
  - KSA -> GSA mapping is provided by annotation `iam.gke.io/gcp-service-account`
  - `api.cloudSqlProxy.enabled=true` in `values-dev.yaml`
  - `api.cloudSqlProxy.usePrivateIp=true` routes proxy to Cloud SQL private IP
  - API connects to Cloud SQL via sidecar proxy on `127.0.0.1:5432`
  - `DATABASE_URL` secret must use `@127.0.0.1:5432`
- web runtime env is supplied from values:
  - `web.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk frontend publishable key)
  - `web.secretEnv.CLERK_SECRET_KEY` (Clerk server key via `secretKeyRef`)

Dev image publish behavior:

- CI publishes both `${GITHUB_SHA}` and `dev-main` tags to GAR.
- CI then updates `infra/helm/values-dev.yaml` -> `global.images.tag: <GITHUB_SHA>` and pushes that commit to `main`.
- Argo CD deploys the pinned SHA tag from GitOps values, avoiding stale-node-cache issues with moving tags.

## Scope in this phase

- skeleton manifests only
- no automatic apply/sync execution
- no GKE cleanup/reset

## OpenClaw rule

- OpenClaw is enabled in dev values for O3 baseline deploy enablement.
- OpenClaw is treated as a standalone neighboring runtime, not part of `apps/api`.

## OpenClaw source/deploy boundary (Step 3 O1)

- Source-of-truth strategy: **fork-sync** from `https://github.com/kurock09/openclaw` (`main`).
- O1 stays docs-only: no OpenClaw code integration into backend modules and no runtime calls from `apps/api`.
- Build context for OpenClaw image: fork root (`.`), Dockerfile path `./Dockerfile`.
- Runtime command for this fork image uses Dockerfile default:
  - `node openclaw.mjs gateway --allow-unconfigured`

## OpenClaw approved revision (pre-O2 pin)

- Approved fork repository: `https://github.com/kurock09/openclaw`
- Approved ref type: full commit SHA only (no branch/tag refs)
- Single machine-readable SHA source: `infra/dev/gitops/openclaw-approved-sha.txt`
- Approved commit SHA (current): `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- Ownership: PersAI infra maintainers update this SHA by PR in this repo.
- Update rule: every SHA change in `infra/dev/gitops/openclaw-approved-sha.txt` must be reflected in `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md` in the same PR.

## OpenClaw image build/push automation (Step 3 O2)

- Workflow: `.github/workflows/openclaw-dev-image-publish.yml`
- Trigger:
  - `push` to `main`
  - `workflow_dispatch`
- Auth: same WIF/OIDC GAR variables used by api/web workflows:
  - `GAR_REGION`
  - `GCP_PROJECT_ID`
  - `GAR_REPOSITORY`
  - `GCP_WIF_PROVIDER`
  - `GCP_WIF_SERVICE_ACCOUNT`
- Source materialization in CI:
  - clone `https://github.com/kurock09/openclaw.git`
  - read approved SHA from `infra/dev/gitops/openclaw-approved-sha.txt`
  - build context path: `services/openclaw`
  - Dockerfile path: `services/openclaw/Dockerfile`
- OpenClaw image refs produced:
  - `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/openclaw:${OPENCLAW_APPROVED_SHA}`
  - `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/openclaw:dev-main`
- Scope guard:
  - workflow performs build/push only
  - no deploy/sync operation is executed in O2

## OpenClaw dev config/secrets baseline (Step 3 O5)

This baseline is now wired in O3 for dev deployment.

Required dev runtime baseline values:

- Plain config (non-secret):
  - `OPENCLAW_GATEWAY_BIND=lan`
    - why: deployed service must not depend on loopback-only binding
  - `OPENCLAW_GATEWAY_PORT=18789`
    - why: match OpenClaw gateway default and health endpoints (`/healthz`, `/readyz`)
- Secret values:
  - `OPENCLAW_GATEWAY_TOKEN`
    - why: required baseline auth token for non-loopback / future exposure-safe runtime

Optional dev values (not required for pod boot):

- Plain config:
  - `TZ` (example `UTC`)
  - `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS` (keep unset/false unless explicit local debugging)
- Secrets:
  - provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.)
    - optional for process boot, required only for real model responses

Intentionally not configured yet in this slice:

- channels/provider credentials beyond baseline gateway startup/auth
- OpenClaw runtime integration with `apps/api`
- deploy/sync enablement

Source-of-truth mapping in dev policy:

- plain config source-of-truth: Git-tracked dev values (`infra/helm/values-dev.yaml`)
- secret source-of-truth: Google Secret Manager -> synced Kubernetes Secret in `persai-dev` namespace
- recommended OpenClaw secret object: `persai-openclaw-secrets` with key:
  - `OPENCLAW_GATEWAY_TOKEN`

## OpenClaw O3 runtime assumptions (dev)

- Deploy enablement:
  - `openclaw.enabled=true` in `infra/helm/values-dev.yaml`
  - OpenClaw image tag pinned to approved fork SHA: `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- Runtime command/args:
  - command: `node openclaw.mjs gateway`
  - args: `--bind lan --port 18789`
- Runtime port:
  - container/service port: `18789`
- Runtime auth:
  - `OPENCLAW_GATEWAY_TOKEN` from `persai-openclaw-secrets` -> `secretKeyRef`
- Runtime Control UI origin policy:
  - non-loopback bind is used (`lan`)
  - explicitly wired via OpenClaw config file mounted from ConfigMap (`infra/helm/templates/openclaw-configmap.yaml`)
  - config path in container: `/app/openclaw-dev.json` (`OPENCLAW_CONFIG_PATH`)
  - exact allowed origins in dev:
    - `http://localhost:18789`
    - `http://127.0.0.1:18789`
  - `dangerouslyAllowHostHeaderOriginFallback` is explicitly set to `false`
  - any additional browser origin requires explicit update to `openclaw.controlUi.allowedOrigins` values

Remaining known blocker before first successful pod start:

- Kubernetes secret `persai-openclaw-secrets` with key `OPENCLAW_GATEWAY_TOKEN` must exist in namespace `persai-dev`.

## Manual procedures

- Cleanup/reset and first deploy runbook: `infra/dev/gke/RUNBOOK.md`

## OpenClaw O4 runtime verification result (dev)

Observed verification baseline in `persai-dev`:

- deployment: `openclaw` is `1/1` available
- pod selector `app.kubernetes.io/name=openclaw`: `1/1 Running`
- service: `openclaw` (`ClusterIP`) on `18789/TCP`
- runtime logs: gateway listening on `ws://0.0.0.0:18789`
- in-cluster HTTP checks:
  - `GET /healthz` -> `{"ok":true,"status":"live"}`
  - `GET /readyz` -> `{"ready":true}`

Exact in-cluster address baseline for later consumers:

- service DNS: `openclaw.persai-dev.svc.cluster.local`
- gateway HTTP base: `http://openclaw.persai-dev.svc.cluster.local:18789`
- gateway WebSocket base: `ws://openclaw.persai-dev.svc.cluster.local:18789`
- health path: `/healthz`
- readiness path: `/readyz`
