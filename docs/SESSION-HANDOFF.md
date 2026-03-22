# SESSION-HANDOFF

## What changed

- Completed Step 3 O5 config/secrets baseline clarification for OpenClaw (docs-only, no deploy enablement).
- Documented minimum OpenClaw dev runtime baseline values in `infra/dev/gitops/README.md`:
  - required plain config:
    - `OPENCLAW_GATEWAY_BIND=lan`
    - `OPENCLAW_GATEWAY_PORT=18789`
  - required secret:
    - `OPENCLAW_GATEWAY_TOKEN`
- Documented optional values:
  - `TZ`
  - `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS` (kept unset/false unless explicit debug need)
  - provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.) as optional for process boot
- Documented intentionally not configured yet:
  - provider/channel integration credentials
  - backend integration with `apps/api`
  - deploy/sync enablement
- Added dev secret baseline documentation:
  - recommended secret object `persai-openclaw-secrets` with key `OPENCLAW_GATEWAY_TOKEN`
  - runbook command added in `infra/dev/gke/RUNBOOK.md`
- Documented source mapping:
  - plain config source (policy): Git-tracked dev values
  - secret source: Google Secret Manager -> Kubernetes Secret sync (ADR-008 policy)
- Captured pre-O3 blockers for successful OpenClaw pod start:
  - OpenClaw deployment template does not inject env/secret values yet
  - Helm OpenClaw port baseline is `8080` but OpenClaw gateway default runtime port is `18789`
  - runtime bind override is not yet wired (image default remains loopback-friendly path)
- Updated docs:
  - `infra/dev/gitops/README.md`
  - `infra/dev/gke/README.md`
  - `infra/dev/gke/RUNBOOK.md`
  - `docs/ROADMAP.md` (`O5` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- O5 must define a safe and deterministic OpenClaw dev config/secrets baseline before deploy enablement work.
- This keeps OpenClaw standalone, aligned with existing secret policy, and avoids premature provider/channel scope expansion.

## Decisions made

- Preserved O1/O2 decisions and kept O5 docs-only.
- Required baseline auth secret for deployable-safe runtime is `OPENCLAW_GATEWAY_TOKEN`.
- Required baseline config target values are `OPENCLAW_GATEWAY_BIND=lan` and `OPENCLAW_GATEWAY_PORT=18789`.
- Provider/channel credentials are intentionally deferred.

## Files touched

- infra/dev/gitops/README.md
- infra/dev/gke/README.md
- infra/dev/gke/RUNBOOK.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run.

## Tests run / result

- Not run (docs-only slice).

## Known risks

- O5 defines baseline expectations only; O3 still needs Helm env/secret and port/bind wiring for successful pod runtime.
- Provider/channel functionality remains unavailable until those credentials are intentionally configured.

## Next recommended step

- Proceed to O3 with minimal Helm wiring for OpenClaw env/secret injection and port/bind alignment to baseline values.
