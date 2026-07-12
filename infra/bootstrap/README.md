# Infra Bootstrap (Manual-only)

This directory contains one-time/manual bootstrap/reset helpers.

## Scripts

- `infra/bootstrap/dev-gke-reset.sh` — destructive namespace/Argo reset (dry-run default)
- `infra/bootstrap/adr146-sandbox-egress-foundation.sh` — ADR-146 Slice 0.1 current-cluster Calico + private sandbox egress foundation (dry-run default)
- `infra/bootstrap/adr146-sandbox-egress-foundation.mjs` — executable preflight/prepare/apply/retire/verify/probe/generate-probe-manifests implementation
- `infra/bootstrap/adr146-sandbox-egress-foundation.json` — committed CIDR/identity/NAT/firewall inventory + release-gate contract
- `infra/bootstrap/adr146-sandbox-egress-foundation.test.mjs` — local static/unit validators
- `infra/bootstrap/lib/foundation.mjs` / `cidr.mjs` — shared validators, evidence binding, probe manifest builders

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
- Slice 0.1b repository release gate: sandbox-only image pin first; remaining
  pins wait on ordered GitHub Environment approvals (`persai-dev-adr146-foundation`,
  then `persai-dev-migrations` when both apply). Evidence binding fails closed on
  dirty trees / inventory mismatch. Controlled probe Pods require
  `cleanup-controlled-probes --execute` (success and failure paths). CI does not
  auto-apply foundation mutations.
- Slice 0.1/0.1b remain repo-local until founder-approved live apply/verify/probe
  and the program's final coordinated push

## Windows note

On Windows, invoke the Node entrypoint directly (Git Bash/`sh` is optional):

```powershell
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs plan
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs static-check
node infra/bootstrap/adr146-sandbox-egress-foundation.mjs generate-probe-manifests
corepack pnpm run test:adr146-foundation
```

The `.sh` wrapper is a thin passthrough to the same `.mjs` file.

## ADR-146 foundation example

```bash
# Local static gate (no GCP mutation)
./infra/bootstrap/adr146-sandbox-egress-foundation.sh plan
./infra/bootstrap/adr146-sandbox-egress-foundation.sh static-check
./infra/bootstrap/adr146-sandbox-egress-foundation.sh generate-probe-manifests
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
  --probe-pod adr146-restricted-probe \
  --nat-probe-pod adr146-nat-probe

# REQUIRED on success and failure — bounded cleanup of controlled probe Pods only
./infra/bootstrap/adr146-sandbox-egress-foundation.sh cleanup-controlled-probes --execute
```

Plan/verify/generate-probe-manifests/probe require a clean tree and print
`evidence.gitCommitSha` plus committed `evidence.inventorySha256` (fail closed
on dirty/mismatched inventory; never `UNAVAILABLE`).
`generate-probe-manifests` writes local YAML under
`infra/bootstrap/adr146-probe-manifests/` (gitignored) and never applies it.
Operators must run `cleanup-controlled-probes --execute` after probes (success
or failure); plain Pods are not auto-cleaned.

See `infra/dev/gke/RUNBOOK.md` for the exact push-last sequence:

1. pre-push founder-approved foundation apply (clean tree)
2. one final founder push
3. Argo Helm KSA/NP with last-good non-sandbox tags
4. sandbox-only image pin
5. controlled probes + structural/live verification, then `cleanup-controlled-probes`
6. approve `persai-dev-adr146-foundation`
7. when migrations co-present, approve `persai-dev-migrations` after step 6
8. remaining pins

Failure/rollback: remain on last-good non-sandbox pins; sandbox tag may roll
back; never disable Calico; never restore the removed plan
`networkAccessEnabled` boolean.

## Reset example

```bash
./infra/bootstrap/dev-gke-reset.sh
./infra/bootstrap/dev-gke-reset.sh --execute
EXPECTED_KUBE_CONTEXT="gke_your-project_your-region_your-dev-cluster" ./infra/bootstrap/dev-gke-reset.sh --execute
```
