# ADR-065: Wave 1 Infrastructure Security Hardening

**Status:** Accepted
**Date:** 2026-04-05
**Supersedes:** none
**Relates to:** ADR-063 (tiered runtime strategy)

## Context

A code-level security audit of the PersAI + OpenClaw runtime deployment identified
several infrastructure-layer gaps that exist regardless of application-level
controls. These gaps apply to all three runtime tiers and can be fixed entirely
within Helm/infra without changing business logic or OpenClaw fork code.

### Findings addressed

| ID | Category | Risk |
|----|----------|------|
| C1 | `docker-dind` sidecar runs `privileged: true` | Sandbox escape if dind is compromised |
| C2 | `openclaw` container has no `securityContext` | Default capabilities, writable root FS |
| C3 | `openclaw` container has no `resources` | Unbounded CPU/RAM on shared node |
| H1 | All three tiers use identical sandbox Docker limits | No blast-radius differentiation |
| H2 | No per-pool session maintenance limits | Shared disk pressure across tiers |
| M1 | NetworkPolicy covers Ingress only; no Egress | Unrestricted outbound from openclaw pods |

### Out of scope (later waves)

- OpenClaw fork code changes (workspace isolation, exec timeout, concurrent turn mutex)
- Product-level limits in Admin Plans (mediaStorageBytesLimit, workspaceTotalBytesLimit)
- gVisor RuntimeClass migration (eliminates privileged dind entirely)

## Decision

### 1. securityContext on openclaw container

Add a locked-down security context to the `openclaw` main container:

```yaml
securityContext:
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

Add explicit writable `emptyDir` mounts for paths the runtime needs:

- `/tmp` — Node.js temp files, ffmpeg scratch
- `/home/node/.openclaw` — session transcripts, state (only when GCS FUSE is not the workspace root)

### 2. Per-pool resource limits

Each pool gets its own `resources` block on both the `openclaw` container and the
`docker-dind` sidecar (when sandbox is enabled). The dind limit must exceed the
sandbox Docker container limit plus ~200 Mi overhead.

| Resource | free_shared | paid_shared | isolated |
|----------|-------------|-------------|----------|
| openclaw CPU req/lim | 250m / 1 | 500m / 2 | 1 / 4 |
| openclaw RAM req/lim | 512Mi / 1Gi | 1Gi / 2Gi | 2Gi / 4Gi |
| openclaw ephemeral | 1Gi | 2Gi | 5Gi |
| dind CPU req/lim | 250m / 1 | 500m / 1 | 1 / 2 |
| dind RAM req/lim | 768Mi / 1280Mi | 1280Mi / 2304Mi | 2304Mi / 4352Mi |

### 3. Per-pool sandbox Docker limits

Override `agentDefaults.sandbox.docker` per pool so the sandbox container created
by the Docker backend gets tier-appropriate resource caps:

| Docker param | free_shared | paid_shared | isolated |
|--------------|-------------|-------------|----------|
| pidsLimit | 64 | 128 | 256 |
| memory | 512m | 1g | 2g |
| memorySwap | 512m | 1g | 2g |
| cpus | 0.5 | 1 | 2 |
| network | none | none | none |
| readOnlyRoot | true | true | true |
| capDrop | [ALL] | [ALL] | [ALL] |
| user | 0:0 | 0:0 | 0:0 |

### 4. Per-pool session maintenance

Override `sessionMaintenance` per pool to limit disk pressure by tier:

| Param | free_shared | paid_shared | isolated |
|-------|-------------|-------------|----------|
| maxEntries | 500 | 1000 | 2000 |
| maxDiskBytes | 256mb | 1gb | 2gb |
| highWaterBytes | 200mb | 800mb | 1600mb |
| rotateBytes | 10mb | 25mb | 25mb |

### 5. Egress NetworkPolicy

Add a second NetworkPolicy (`openclaw-egress-baseline`) that restricts outbound
traffic from openclaw pods to:

- kube-dns (UDP/TCP 53)
- PersAI internal API pods (TCP 3002)
- External HTTPS only (TCP 443), with GCP metadata endpoint blocked

### 6. Policy TS and UI reflect real limits

Extend `RuntimeTierSecurityPolicyState` with a new `sandboxLimits` field
carrying the actual numeric limits so the existing Admin Runtime UI
`TierSecurityCard` shows real differentiated values, not just identical
policy flags. The field is informational (read-only in UI).

## Consequences

- All openclaw pods run with least-privilege security context.
- Free-tier sandbox gets ~4x less resources than isolated, matching blast-radius intent.
- Egress policy blocks lateral movement and metadata access.
- dind still requires `privileged: true` (mitigated in a future gVisor wave).
- Session disk is bounded per tier; free users with heavy transcript history may hit earlier pruning.
- Admin UI shows differentiated limits without requiring any new editable controls.
