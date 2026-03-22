# ADR-010: Dev API Cloud SQL access via sidecar proxy

## Status
Accepted

## Context
Dev API runtime currently reaches Cloud SQL over direct Postgres host in `DATABASE_URL`.
This keeps startup simple, but leaves a networking/security tail in day-to-day dev deploy flow.
We need a narrow, low-risk hardening step without redesigning VPC or deployment topology.

## Decision
Use `cloud-sql-proxy` sidecar in the `api` deployment for dev.

- Enable sidecar in `infra/helm/values-dev.yaml` only.
- Keep base values disabled by default.
- Route API DB traffic to `127.0.0.1:5432` via proxy.
- Keep one existing secret source (`persai-api-secrets`) and update only `DATABASE_URL` host for dev runtime.

## Consequences
### Positive
- Removes direct DB host dependency from API process.
- Keeps change narrow (Helm + secret update), no broad infra redesign.
- Works with current GKE setup and Cloud SQL IAM role.

### Negative
- Adds one sidecar container to API pod.
- Still not full private-IP architecture; that remains a separate future slice.

## Alternatives considered
- Keep direct Postgres host in `DATABASE_URL` (rejected: leaves security/operational tail).
- Full private IP + NAT redesign in same slice (rejected: too broad for requested narrow scope).
