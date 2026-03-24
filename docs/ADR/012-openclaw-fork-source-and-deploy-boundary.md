# ADR-012: OpenClaw fork source and deploy boundary

## Status
Accepted

## Context
Step 3 O1 requires a clear deploy boundary for OpenClaw without widening Step 2 product scope and without coupling `apps/api` to OpenClaw runtime.

We need one explicit source-of-truth strategy for OpenClaw build input and one explicit runtime assumption for dev image build/deploy.

The selected fork is:
- `https://github.com/kurock09/openclaw`
- default branch: `main`

## Decision
Use **fork-sync** as the source-of-truth strategy.

- Canonical source is the fork repository (`kurock09/openclaw`), not code authored inside `apps/api`.
- CI materializes the approved fork revision into `services/openclaw` for image build; this path is a build workspace, not the authoritative source-of-truth.
- O1 remains docs-only: no backend integration, no runtime calls from `apps/api`, no domain coupling.

Deploy/runtime boundary for this fork is fixed as:
- build context: fork repository root (`.`)
- dockerfile path: `Dockerfile` at fork root
- runtime command: image default `CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]`
- exposed gateway port baseline: `18789` inside the OpenClaw image (separate from PersAI API porting)

Pre-O2 determinism clarification:
- Fork-sync does not allow implicit floating builds from `main`.
- OpenClaw build input must be pinned to an approved full 40-char commit SHA from `kurock09/openclaw`.
- Approved revision single source is machine-readable file `infra/dev/gitops/openclaw-approved-sha.txt`.
- Revision updates are owned by PersAI infra maintainers via PR in this repository, with matching updates in `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md`.

Drift rule (before O2):
- Drift exists if any OpenClaw build/deploy assumption in PersAI docs references a floating branch/tag ref instead of the approved SHA.
- Drift exists if the approved SHA in `infra/dev/gitops/openclaw-approved-sha.txt` and session/changelog records disagree.
- Drift exists if documented boundary assumptions (build context, Dockerfile path, runtime command) no longer match the approved fork revision.

## Consequences
### Positive
- Keeps OpenClaw as a standalone neighboring runtime.
- Prevents accidental backend-domain coupling before Step 3 integration slices.
- Makes image/deploy assumptions explicit for O2/O3 automation.

### Negative
- OpenClaw application source is managed outside this repository in O1.
- Operational sync discipline with the fork branch is required.

## Alternatives considered
- Vendor snapshot in the repository under `services/openclaw` (rejected: increases monorepo churn and diverges from fork faster).
- Git subtree import in O1 (rejected for this slice: larger repo change than needed for boundary formalization).
- Direct `apps/api` integration now (rejected: out of scope for O1 and violates boundary intent).
