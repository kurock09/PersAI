# SESSION-HANDOFF

## What changed

- Completed pre-O2 clarification slice (docs-only) on top of accepted O1 fork-sync decision.
- Tightened source-of-truth determinism policy:
  - fork-sync does not imply building from floating external `main`
  - required OpenClaw build input is full commit SHA pin (no branch/tag refs)
- Recorded approved OpenClaw fork revision in docs:
  - `infra/dev/gitops/README.md` -> `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- Defined sync ownership/update rule:
  - PersAI infra maintainers update approved SHA via PR in this repo
  - same PR must update `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md`
- Defined pre-O2 drift rules in ADR:
  - floating ref usage in docs/build assumptions is drift
  - disagreement across approved SHA records is drift
  - boundary assumptions not matching approved revision is drift
- Updated docs:
  - `docs/ADR/012-openclaw-fork-source-and-deploy-boundary.md`
  - `infra/dev/gitops/README.md`
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- O2 image automation must be deterministic and operationally owned before implementation starts.
- This clarification keeps O1 decision intact while removing ambiguity about approved revision, ownership, and drift handling.

## Decisions made

- Preserved source-of-truth strategy: **fork-sync**.
- Deterministic build input policy:
  - approved full commit SHA only
  - no implicit floating `main`/tag builds
- Approved fork revision for pre-O2 baseline:
  - `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- Sync ownership:
  - PersAI infra maintainers own SHA updates by PR and must record them in changelog + handoff.

## Files touched

- docs/ADR/012-openclaw-fork-source-and-deploy-boundary.md
- infra/dev/gitops/README.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run (docs-only slice).

## Tests run / result

- Not run (docs-only changes).

## Known risks

- Until O2 is implemented, determinism remains a docs policy and is not yet enforced by CI automation.
- Approved SHA must be kept current intentionally when upgrading OpenClaw.

## Next recommended step

- Proceed to O2 with CI workflow implementation that consumes only the approved OpenClaw commit SHA pin.
