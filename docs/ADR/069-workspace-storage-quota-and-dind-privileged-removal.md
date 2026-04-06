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

The guard uses a cached `du -sb` call (30s TTL) to avoid per-operation filesystem scans on GCS FUSE. The cache is invalidated after every write/exec-backed mutation, and after sandbox `remove` / `rename`, so quota reads do not stay stale after space is freed or files are atomically replaced. If `du` fails or returns malformed output, the guarded non-cleanup paths now fail safe instead of degrading to an effectively empty-workspace reading.

Cleanup commands (`rm`, `unlink`, `truncate`, `find -delete`) bypass the exec pre-check even when quota is exceeded, so the assistant can remediate without a deadlock.

Default limits: free = 500 MB, paid_shared = 5 GB, paid_isolated = 20 GB. Configurable per plan in Admin UI. The materialize service resolves workspace quota from the plan's `quotaAccounting.workspaceStorageBytesLimit`, falling back to `QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT` env var.

### dind Privileged — Canary Result

Attempted `privileged: false` with rootless securityContext (runAsNonRoot, runAsUser 1000, caps SETUID/SETGID). GKE nodes rejected it: `rootlesskit: fork/exec /proc/self/exe: operation not permitted`. Root cause: GKE Container-Optimized OS does not expose unprivileged user namespaces to pods without `privileged: true`.

**Decision:** revert to `privileged: true`. This remains a known infra trade-off documented here. Mitigation path: GKE Sandbox (gVisor) or a dedicated rootless-capable node pool with `sysctl net.ipv4.ip_unprivileged_port_start=0` and `/proc/sys/kernel/unprivileged_userns_clone=1`.

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
workspace-quota-guard.ts → cached du -sb + enforceWorkspaceQuota() + invalidateWorkspaceCache()
    ↓
fs-bridge.ts writeFile()/remove()/rename() → invalidate cache after mutation; writeFile fails safe if quota cannot be measured
bash-tools.exec.ts → pre-check (cleanup commands bypass) + periodic quota watch + invalidate cache + post-check
```

## Files Changed

### OpenClaw fork (lower-risk PersAI bridge files)

- `src/gateway/persai-runtime/persai-runtime-tool-policy.ts` — `extractWorkspaceQuotaBytes()`
- `src/agents/persai-runtime-context.ts` — `workspaceQuotaBytes` on `PersaiRuntimeRequestCtx`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — wire through all 3 turn types
- `src/gateway/persai-runtime/persai-runtime-http.ts` — extract + pass at all 3 call sites
- `src/agents/workspace-quota-guard.ts` — NEW: cached du + enforce + invalidateWorkspaceCache
- `src/agents/sandbox/fs-bridge.ts` — write quota pre-check + cache invalidation after write
- `src/agents/bash-tools.exec.ts` — exec pre-check (cleanup bypass) + cache invalidation + post-check

### PersAI

- `packages/config/src/api-config.ts` — `QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — `workspaceQuotaBytes` in bootstrap, resolved from plan `quotaAccounting` with env fallback
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts` — resolve workspace quota from plan
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts` — types
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` — service
- `apps/web/app/admin/plans/page.tsx` — Admin UI field
- `infra/helm/templates/openclaw-deployment.yaml` — dind securityContext

## Consequences

- Free-tier users limited to 500 MB workspace. Blocks GCS billing abuse.
- `du -sb` cache (30s) plus invalidation after mutations materially reduces stale-read tails, but pre/post-only `exec` checks were not sufficient to stop a single long-running command from writing multi-GB data before exit. `SR6b` added a mid-exec quota watch as an explicit stop-gap, and later live evidence showed one fast oversized write could still finish before the first scheduled poll, so `SR6d` tightens that first-poll window.
- `du` failure or malformed output no longer weakens quota enforcement into a fail-open "0 bytes used" reading on the guarded non-cleanup paths.
- sandbox `remove` / `rename` now invalidate the same cache, so quota reads do not stay stale after delete/replace operations that bypass the `exec` path.
- Cleanup commands bypass quota pre-check, preventing the deadlock where an assistant could neither delete nor write files after exceeding quota.
- Workspace quota is resolved from plan's `quotaAccounting.workspaceStorageBytesLimit`, so admin UI changes take effect on the next turn without pod restart.
- dind privileged removal was attempted but GKE COS rejected rootless dind. Reverted to `privileged: true` as a known infra trade-off. Mitigation path: GKE Sandbox (gVisor).
