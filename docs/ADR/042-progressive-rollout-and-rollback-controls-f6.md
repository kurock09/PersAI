# ADR 042: Progressive rollout and rollback controls (Step 9 F6)

Date: 2026-03-24

## Status

Accepted

## Context

Step 9 F6 requires real platform-managed rollout and rollback controls while preserving:

- user-owned assistant draft/published-version truth immutability
- soft automatic platform updates
- lifecycle/apply truth integrity

The platform needs bounded operational controls to apply governance-layer updates progressively and to roll them back safely.

## Decision

Introduce explicit admin-controlled rollout operations for platform-managed governance layers only.

1. Add canonical rollout persistence:
   - `assistant_platform_rollouts`
   - `assistant_platform_rollout_items`
2. Add admin APIs:
   - `GET /api/v1/admin/platform-rollouts`
   - `POST /api/v1/admin/platform-rollouts`
   - `POST /api/v1/admin/platform-rollouts/{rolloutId}/rollback`
3. Keep user-owned truth untouched:
   - rollout mutates only `assistant_governance` fields
   - rollout never edits assistant draft or immutable published-version rows
4. Keep updates soft and automatic:
   - after governance update, runtime reapply is triggered against latest published version (`reapply=true`)
   - rollout proceeds per-target assistant and records outcomes (succeeded/degraded/failed/skipped)
5. Require dangerous-action step-up with action-scoped RBAC:
   - `admin.rollout.apply`
   - `admin.rollout.rollback`
   - roles: `ops_admin|super_admin` (legacy owner fallback preserved)
6. Keep rollback explicit:
   - store per-assistant pre-update governance snapshot in rollout item row
   - rollback restores snapshot and triggers reapply again
7. Audit all rollout control actions:
   - `admin.platform_rollout_applied`
   - `admin.platform_rollout_rolled_back`

## Consequences

### Positive

- Real progressive rollout control via explicit percentage targeting.
- Explicit rollback support with per-assistant snapshot restore.
- Safe boundary: platform-managed layers updated without mutating user-owned assistant version history.
- Better operator traceability through rollout records + audit events.

### Trade-offs / intentionally deferred

- No staged multi-wave scheduler/orchestrator yet (operators execute successive rollouts manually).
- No automatic rollback-on-threshold policy in this slice.
- No deep BI timeline for rollout outcomes; summary counters only.
