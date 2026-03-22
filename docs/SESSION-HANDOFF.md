# SESSION-HANDOFF

## What changed

- Completed Step 3 O3 OpenClaw dev deploy enablement.
- Helm wiring changes:
  - enabled OpenClaw in `infra/helm/values-dev.yaml` (`openclaw.enabled=true`)
  - aligned OpenClaw service/container port to `18789` in values
  - wired explicit runtime command/args:
    - command: `node openclaw.mjs gateway`
    - args: `--bind lan --port 18789`
  - wired baseline auth secret into deployment:
    - env var `OPENCLAW_GATEWAY_TOKEN` from secret `persai-openclaw-secrets`
  - added OpenClaw readiness/liveness probes:
    - `/readyz`
    - `/healthz`
  - pinned OpenClaw dev image tag to approved fork SHA:
    - `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- Updated operational docs:
  - OpenClaw O3 runtime assumptions in `infra/dev/gitops/README.md`
  - OpenClaw dev infra notes in `infra/dev/gke/README.md`
  - runbook sync/validate steps in `infra/dev/gke/RUNBOOK.md`
  - root deployment notes in `README.md`
  - roadmap status in `docs/ROADMAP.md` (`O3` marked complete)
  - changelog/session docs updated

## Why changed

- O3 requires OpenClaw to be deployable in dev as a standalone runtime using already defined baseline config/secrets.
- This unblocks dev pod startup validation without widening into backend integration.

## Decisions made

- Runtime bind strategy in dev: non-loopback (`lan`) on port `18789`.
- Runtime auth strategy in dev: shared token via `OPENCLAW_GATEWAY_TOKEN` secret ref.
- Control UI origin policy (explicitly wired, no startup seeding assumption):
  - ConfigMap `openclaw-config` mounts OpenClaw config at `/app/openclaw-dev.json`
  - deployment sets `OPENCLAW_CONFIG_PATH=/app/openclaw-dev.json`
  - `gateway.controlUi.allowedOrigins` is explicitly set to:
    - `http://localhost:18789`
    - `http://127.0.0.1:18789`
  - `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback=false`
- OpenClaw remains standalone (no `apps/api` integration).

## Files touched

- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- infra/helm/templates/openclaw-deployment.yaml
- infra/helm/templates/openclaw-configmap.yaml
- infra/dev/gitops/README.md
- infra/dev/gke/README.md
- infra/dev/gke/RUNBOOK.md
- README.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run.

## Tests run / result

- `helm template persai-dev infra/helm -f infra/helm/values-dev.yaml` -> passed
- rendered manifest contains expected OpenClaw wiring:
  - bind args (`--bind lan`)
  - port `18789`
  - secret env `OPENCLAW_GATEWAY_TOKEN`
  - config path env `OPENCLAW_CONFIG_PATH`
  - ConfigMap with explicit `gateway.controlUi.allowedOrigins`
  - readiness `/readyz` and liveness `/healthz` probes

## Known risks

- Kubernetes secret `persai-openclaw-secrets` must exist in `persai-dev` with key `OPENCLAW_GATEWAY_TOKEN`; otherwise pod startup fails.
- Additional non-local browser origins are not configured by default; they require explicit update to `openclaw.controlUi.allowedOrigins`.
- Provider/channel capabilities remain intentionally unconfigured.

## Next recommended step

- Run O4 runtime verification after Argo sync (pod health, service reachability, and basic gateway smoke checks).
