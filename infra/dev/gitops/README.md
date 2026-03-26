# Dev GitOps Baseline

This directory contains the dev GitOps/Argo CD baseline for `persai-dev`.

## OpenClaw fork SHA bump: push order (avoid broken CI)

GitHub Actions clones `https://github.com/kurock09/openclaw` and runs `git fetch origin <OPENCLAW_APPROVED_SHA>`. The commit **must exist on the remote** before PersAI workflows run against that pin.

1. Commit and **`git push` the fork** (`kurock09/openclaw`) so `main` (or the pinned commit) is on GitHub.
2. Then merge/push **PersAI** changes that update `infra/dev/gitops/openclaw-approved-sha.txt` (or re-run failed workflows after the fork push).

If you push PersAI first, OpenClaw **OpenClaw Dev Image Publish** / `validate-openclaw-persai-runtime.sh` may fail with `upload-pack: not our ref <sha>` until the fork contains that object.

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
- OpenClaw CI publishes both `<OPENCLAW_APPROVED_SHA>` and `dev-main` tags to GAR.
- OpenClaw CI then updates `infra/helm/values-dev.yaml` and pushes that commit to `main`:
  - `openclaw.image.tag: <OPENCLAW_APPROVED_SHA>`
  - `openclaw.image.digest: <built image digest>`
- Argo CD deploys the pinned SHA tag from GitOps values, avoiding stale-node-cache issues with moving tags.
- Argo CD auto-sync is enabled for `persai-dev`, so new GitOps commits are applied automatically.

Database migration behavior on every deploy sync:

- `api-migrate` PreSync hook job runs before API rollout.
- The hook runs:
  - `corepack pnpm run prisma:migrate:deploy`
  - `corepack pnpm run prisma:migrate:status`
- If migration/apply/status fails, Argo sync fails and API rollout is blocked.
- This keeps deploy + schema state aligned by default (no manual migrate step).

## Scope in this phase

- GitOps manifests remain intentionally small and environment-specific
- Argo CD auto-sync is active for routine dev deploys
- CI updates Git-tracked image pins but does not call cluster APIs directly
- GKE cleanup/reset remains manual via runbook/scripts

## OpenClaw rule

- OpenClaw is enabled in dev values for O3 baseline deploy enablement.
- OpenClaw is treated as a standalone neighboring runtime, not part of `apps/api`.

## OpenClaw source/deploy boundary (Step 3 O1)

- Source-of-truth strategy: **fork-sync** from `https://github.com/kurock09/openclaw` (`main`).
- OpenClaw source-of-truth stays outside this repository; CI materializes the approved fork revision into `services/openclaw` only for image build.
- Build context for OpenClaw image: fork root (`.`), Dockerfile path `./Dockerfile`.
- Runtime command for this fork image uses Dockerfile default:
  - `node openclaw.mjs gateway --allow-unconfigured`

## OpenClaw approved revision (pre-O2 pin)

- Approved fork repository: `https://github.com/kurock09/openclaw`
- Approved ref type: full commit SHA only (no branch/tag refs)
- Single machine-readable SHA source: `infra/dev/gitops/openclaw-approved-sha.txt`
- Approved commit SHA (current): `6cf3824e79af1a5607b1fac452ef4489707978e5`
- Ownership: PersAI infra maintainers update this SHA by PR in this repo.
- Update rule: every SHA change in `infra/dev/gitops/openclaw-approved-sha.txt` must be reflected in `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md` in the same PR.

## OpenClaw fork: customization and upgrades (recommended ops model)

Goal: keep **today’s behavior** (push to PersAI `main` → workflow clones fork at pinned SHA → image → GitOps pin → Argo sync) while making **PersAI-specific runtime work** easy to carry forward when OpenClaw moves.

1. **Source of customizations = the fork**  
   PersAI runtime HTTP integration lives in the fork (`src/gateway/persai-runtime/`). Bump `openclaw-approved-sha.txt` when the fork advances — same deploy path as now. Optional small `.patch` files in PersAI are break-glass only.

2. **Long-lived integration branch on the fork (optional but convenient)**  
   e.g. `persai-runtime` or `main` on the fork that always contains upstream + your commits. You bump SHA to the **merge commit** you trust. Avoid floating branch names in PersAI docs; the pin file stays **40-char SHA only** ([ADR-012](../../../docs/ADR/012-openclaw-fork-source-and-deploy-boundary.md)).

3. **Updating “vanilla” OpenClaw**  
   If the fork tracks another upstream: merge or rebase upstream into your branch, fix conflicts, run fork tests / build image locally or via `workflow_dispatch`, then set `openclaw-approved-sha.txt` to the new commit and merge the PersAI PR (CHANGELOG + SESSION-HANDOFF per existing rule).

4. **CI validation**  
   `bash infra/dev/gitops/validate-openclaw-persai-runtime.sh` (see `.github/workflows/ci.yml`) clones the pinned SHA and asserts native PersAI runtime sources exist.

5. **Emergency / small deltas**  
   Optional extra `.patch` applied after checkout — use sparingly; conflicts often on fork upgrades.

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
  - no compat patch apply (native routes ship in fork)
  - build context path: `services/openclaw`
  - Dockerfile path: `services/openclaw/Dockerfile`
- OpenClaw image refs produced:
  - `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/openclaw:${OPENCLAW_APPROVED_SHA}`
  - `${GAR_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}/openclaw:dev-main`
- Scope guard:
  - workflow performs build/push + GitOps values pin update only
  - no direct cluster deploy/sync operation is executed

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

Optional / later:

- Provider and channel credentials beyond baseline gateway startup/auth (required only for real model turns).
- **P3 (fork):** with a prior **apply**, web sync/stream use **`agentCommandFromIngress`** (real agent output); without apply, OpenClaw now returns an explicit **503** instead of compat echo so PersAI can fail the turn honestly. See [ADR-048](../../../docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md). Provider keys in cluster secrets are required for non-empty model replies.

Current integration status:

- `apps/api` now talks to OpenClaw through the thin infrastructure adapter boundary for:
  - runtime preflight
  - spec apply/reapply
  - web chat sync transport
  - web chat streaming transport
- dev deploy/sync is active through GitOps pin updates plus Argo CD auto-sync

Source-of-truth mapping in dev policy:

- plain config source-of-truth: Git-tracked dev values (`infra/helm/values-dev.yaml`)
- secret source-of-truth: Google Secret Manager -> synced Kubernetes Secret in `persai-dev` namespace
- recommended OpenClaw secret object: `persai-openclaw-secrets` with key:
  - `OPENCLAW_GATEWAY_TOKEN`

## OpenClaw O3 runtime assumptions (dev)

- Prerequisite for a running pod: Kubernetes Secret `persai-openclaw-secrets` in `persai-dev` with key `OPENCLAW_GATEWAY_TOKEN` (must match API’s reference to the same secret). If the pod crashes on auth or API preflight fails with `auth_failure`, verify this secret first.

- Deploy enablement:
  - `openclaw.enabled=true` in `infra/helm/values-dev.yaml`
  - OpenClaw image tag pinned to approved fork SHA: `6cf3824e79af1a5607b1fac452ef4489707978e5`
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
