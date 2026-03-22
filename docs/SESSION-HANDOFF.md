# SESSION-HANDOFF

## What changed

- Completed pre-O3 hardening clarification for OpenClaw approved build input (minimal deterministic change).
- Added single machine-readable source for approved OpenClaw revision:
  - `infra/dev/gitops/openclaw-approved-sha.txt`
- Updated OpenClaw image workflow to read SHA only from machine-readable file:
  - `.github/workflows/openclaw-dev-image-publish.yml`
  - uses `OPENCLAW_APPROVED_SHA_FILE=infra/dev/gitops/openclaw-approved-sha.txt`
  - resolves SHA with `tr -d '\r\n' < "${OPENCLAW_APPROVED_SHA_FILE}"`
  - validates strict 40-char lowercase hex format before build
- Updated docs references so prose is no longer SHA source-of-truth:
  - `infra/dev/gitops/README.md`
  - `README.md`
  - `docs/ADR/012-openclaw-fork-source-and-deploy-boundary.md`
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- Before O3 deploy enablement, approved build revision needed a machine-readable single source for deterministic automation.
- This removes dependence on human-readable docs parsing while preserving current O1/O2 boundaries.

## Decisions made

- Preserved O1/O2 decisions (fork-sync, isolated OpenClaw build/push workflow, no deploy/sync).
- Machine-readable file is now single approved SHA source for OpenClaw automation:
  - `infra/dev/gitops/openclaw-approved-sha.txt`
- Docs reference this file, but do not act as the source themselves.

## Files touched

- infra/dev/gitops/openclaw-approved-sha.txt
- .github/workflows/openclaw-dev-image-publish.yml
- infra/dev/gitops/README.md
- README.md
- docs/ADR/012-openclaw-fork-source-and-deploy-boundary.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run.

## Tests run / result

- Not run (workflow/docs hardening slice; no runtime execution in this session).

## Known risks

- If `infra/dev/gitops/openclaw-approved-sha.txt` is stale or invalid, OpenClaw workflow build fails by design.
- O3 still requires deploy enablement wiring and verification; this slice hardens build input only.

## Next recommended step

- Proceed to O3 deploy enablement using the machine-readable approved SHA source already in place.
