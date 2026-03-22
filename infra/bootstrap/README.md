# Infra Bootstrap (Manual-only)

This directory contains one-time/manual bootstrap/reset helpers.

## Script

- `infra/bootstrap/dev-gke-reset.sh`

## Safety model

- defaults to dry-run
- requires explicit `--execute`
- manual invocation only (never called by CI)
- validates `kubectl` availability and prints current context
- optional context guard via `EXPECTED_KUBE_CONTEXT`

## Example

```bash
./infra/bootstrap/dev-gke-reset.sh
./infra/bootstrap/dev-gke-reset.sh --execute
EXPECTED_KUBE_CONTEXT="gke_your-project_your-region_your-dev-cluster" ./infra/bootstrap/dev-gke-reset.sh --execute
```
