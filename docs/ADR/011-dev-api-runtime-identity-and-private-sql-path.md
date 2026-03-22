# ADR-011: Dev API runtime identity and private SQL path

## Status
Accepted

## Context
Step 2 runtime is functional in dev, but API database access and runtime identity are not yet production-like:

- API pod runs under default Kubernetes service account.
- Cloud SQL had direct public-IP access path.

We need a narrow hardening slice that keeps Step 2 scope unchanged while closing identity and connectivity tail risk.

## Decision
For dev API runtime:

- Use dedicated Kubernetes service account (`api-sa`) in Helm for API deployment.
- Use GKE Workload Identity mapping from `api-sa` to dedicated GCP service account (`api-runtime@...`).
- Keep Cloud SQL proxy sidecar enabled and force private-IP path (`--private-ip`).
- Remove direct public DB path by disabling Cloud SQL public IPv4 and using localhost DB URL through sidecar.

## Consequences
### Positive
- API runtime has least-privilege identity boundary.
- DB traffic is routed through private Cloud SQL path.
- Step 2 app flow stays unchanged while infra posture is hardened.

### Negative
- Slightly more setup complexity (KSA/GSA bindings and Cloud SQL network settings).
- Dev troubleshooting now spans both K8s and GCP IAM/network layers.

## Alternatives considered
- Keep default KSA and node SA roles (rejected: broad permissions).
- Keep Cloud SQL public path with authorized networks only (rejected: not target production-like posture).
