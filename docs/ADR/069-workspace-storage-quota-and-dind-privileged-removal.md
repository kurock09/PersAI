# ADR-069: Workspace Storage Quota Enforcement + dind Privileged Removal

## Status

Accepted

## Context

Live audit confirmed two remaining security gaps:

1. **Workspace storage quota not enforced**: assistants can create unlimited files on GCS FUSE workspace mount (`/mnt/workspaces/persai/{assistantId}/`). Kubernetes `ephemeral-storage` limits only apply to the overlay filesystem, not mounted volumes. A single free-tier user created 7.5 GB of test files. The existing `media_storage_bytes` quota only covers API upload path, not sandbox write/exec operations.

2. **docker-dind privileged: true**: all runtime pools run the dind sidecar with `privileged: true`, granting full host capabilities. The `docker:29.3.1-dind-rootless` image is already in use but the privileged flag negates its security benefits.

## Decision

### Workspace Storage Quota

Pass a per-plan `workspaceQuotaBytes` limit through the bootstrap payload to OpenClaw and enforce it at two points:

- **write tool** (`fs-bridge.ts`): pre-check before every file write
- **exec tool** (`bash-tools.exec.ts`): pre-check before execution + post-check warning after

The guard uses a cached `du -sb` call (30s TTL) to avoid per-operation filesystem scans on GCS FUSE.

Default limits: free = 500 MB, paid_shared = 5 GB, paid_isolated = 20 GB. Configurable per plan in Admin UI.

### dind Privileged Removal

Replace `privileged: true` with a minimal securityContext for rootless dind:
- `privileged: false`
- `runAsNonRoot: true`
- `runAsUser: 1000`
- `seccomp` and capabilities restricted to what rootless dind needs

This is a canary change — if rootless dind cannot start sandbox containers on GKE without privileged, the flag can be restored per-pool via Helm values override.

## Data Flow

```
PersAI Admin UI → Plan quota settings
    ↓
materialize-assistant-published-version.service.ts
    → openclawBootstrap.governance.workspaceQuotaBytes = 524288000
    ↓
OpenClaw persai-runtime-http.ts → extractWorkspaceQuotaBytes(bootstrap)
    ↓
PersaiRuntimeRequestCtx.workspaceQuotaBytes (AsyncLocalStorage)
    ↓
workspace-quota-guard.ts → cached du -sb + enforceWorkspaceQuota()
    ↓
fs-bridge.ts writeFile() → pre-check
bash-tools.exec.ts → pre-check + post-check
```

## Files Changed

### OpenClaw fork (lower-risk PersAI bridge files)

- `src/gateway/persai-runtime/persai-runtime-tool-policy.ts` — `extractWorkspaceQuotaBytes()`
- `src/agents/persai-runtime-context.ts` — `workspaceQuotaBytes` on `PersaiRuntimeRequestCtx`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — wire through all 3 turn types
- `src/gateway/persai-runtime/persai-runtime-http.ts` — extract + pass at all 3 call sites
- `src/agents/workspace-quota-guard.ts` — NEW: cached du + enforce
- `src/agents/sandbox/fs-bridge.ts` — write quota pre-check
- `src/agents/bash-tools.exec.ts` — exec pre-check + post-check

### PersAI

- `packages/config/src/api-config.ts` — `QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — `workspaceQuotaBytes` in bootstrap
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts` — resolve workspace quota from plan
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts` — types
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` — service
- `apps/web/app/admin/plans/page.tsx` — Admin UI field
- `infra/helm/templates/openclaw-deployment.yaml` — dind securityContext

## Consequences

- Free-tier users limited to 500 MB workspace. Blocks GCS billing abuse.
- `du -sb` cache (30s) means a fast burst of writes can briefly exceed quota by the amount written in one cache window. Acceptable trade-off vs filesystem-level quota.
- dind privileged removal closes the container escape vector. If GKE node kernel does not support unprivileged user namespaces, fallback is to re-enable privileged per-pool in values.
