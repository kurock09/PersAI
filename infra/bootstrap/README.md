# Infra Bootstrap (Manual-only)

This directory contains one-time/manual bootstrap/reset helpers.

## Script

- `infra/bootstrap/dev-gke-reset.sh`

## Safety model

- defaults to dry-run
- requires explicit `--execute`
- manual invocation only (never called by CI)

## Example

```bash
./infra/bootstrap/dev-gke-reset.sh
./infra/bootstrap/dev-gke-reset.sh --execute
```
