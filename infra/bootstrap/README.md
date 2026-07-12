# Infra Bootstrap (Manual-only)

This directory contains one-time/manual bootstrap/reset helpers.

## Scripts

- `infra/bootstrap/dev-gke-reset.sh` — destructive namespace/Argo reset (dry-run default)
- `infra/bootstrap/adr146-sandbox-egress-foundation.sh` — ADR-146 Slice 0.1 current-cluster Calico + private sandbox egress foundation (dry-run default)
- `infra/bootstrap/adr146-sandbox-egress-foundation.mjs` — executable preflight/prepare/apply/retire/verify/probe implementation
- `infra/bootstrap/adr146-sandbox-egress-foundation.json` — committed CIDR/identity/NAT/firewall inventory
- `infra/bootstrap/adr146-sandbox-egress-foundation.test.mjs` — local static/unit validators

## Safety model

- defaults to dry-run
- requires explicit `--execute` for mutations
- manual invocation only (never called by CI apply)
- every mutating execute phase starts with fresh fail-closed live preflight
- existing resources skip only on exact configuration; drift blocks mutation
- structural `verify` and active `probe-restricted` are separate live gates
- Calico readiness labels are rollout signals only — not enforcement proof
- inbound denial, HTTP redirect, and DNS-rebind are **not** claimed by
  `probe-restricted`
- rollback must preserve NetworkPolicy/Calico; disabling the engine is forbidden
- Cloud NAT selects the subnet primary plus dedicated sandbox Pod secondary;
  current exclusivity is verified from all eligible regional/VPC consumers
- CI release attestation is currently blocked; see the GKE RUNBOOK before push
- Slice 0.1 is repo-local until founder-approved live apply/verify/probe

## Windows note

On Windows, invoke the Node entrypoint directly (Git Bash/`sh` is optional):

```powershell
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs plan
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs static-check
corepack pnpm run test:adr146-foundation
```

The `.sh` wrapper is a thin passthrough to the same `.mjs` file.

## ADR-146 foundation example

```bash
# Local static gate (no GCP mutation)
./infra/bootstrap/adr146-sandbox-egress-foundation.sh plan
./infra/bootstrap/adr146-sandbox-egress-foundation.sh static-check
node --test infra/bootstrap/adr146-sandbox-egress-foundation.test.mjs

# Live apply (founder-approved only; not part of ordinary app push)
./infra/bootstrap/adr146-sandbox-egress-foundation.sh preflight
./infra/bootstrap/adr146-sandbox-egress-foundation.sh prepare --execute
./infra/bootstrap/adr146-sandbox-egress-foundation.sh apply-nat --execute
./infra/bootstrap/adr146-sandbox-egress-foundation.sh apply-firewall --execute
./infra/bootstrap/adr146-sandbox-egress-foundation.sh apply-calico --execute
# Creates private pool with --sandbox=type=gvisor, waits Ready, then cordons
# the legacy public sandbox-pool (no delete; running jobs undisturbed).
./infra/bootstrap/adr146-sandbox-egress-foundation.sh apply-sandbox-pool --execute

# Or create the foundation after review (public pool retirement remains separate):
./infra/bootstrap/adr146-sandbox-egress-foundation.sh apply --execute

# Operator-confirmed maintenance retirement; durable job-state proof is external.
./infra/bootstrap/adr146-sandbox-egress-foundation.sh retire-public-pool \
  --execute \
  --maintenance-confirm NO_ACTIVE_SANDBOX_JOBS_CONFIRMED

# Required structural + active gates before any ADR-146 production rollout
./infra/bootstrap/adr146-sandbox-egress-foundation.sh verify
./infra/bootstrap/adr146-sandbox-egress-foundation.sh probe-restricted \
  --execute \
  --probe-pod ses-<hash> \
  --nat-probe-pod adr146-nat-probe
```

See `infra/dev/gke/RUNBOOK.md` for prepare/apply/verify/rollback sequencing and honest Calico node-recreation behavior.

The current Argo/WIF workflow cannot enforce one-push application exposure:
Argo follows Helm `HEAD`, while the GAR publisher identity cannot inspect GKE.
The scripts intentionally remain manual-only and do not fabricate CI
attestation. Final push remains blocked on the release mechanism documented in
the RUNBOOK.

## Reset example

```bash
./infra/bootstrap/dev-gke-reset.sh
./infra/bootstrap/dev-gke-reset.sh --execute
EXPECTED_KUBE_CONTEXT="gke_your-project_your-region_your-dev-cluster" ./infra/bootstrap/dev-gke-reset.sh --execute
```
