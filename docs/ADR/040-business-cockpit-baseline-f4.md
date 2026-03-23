# ADR-040: Business cockpit baseline (Step 9 F4)

## Status
Accepted

## Context

F3 introduced an ops cockpit for runtime/lifecycle operations. Product and commercial monitoring still lacked a concise business-facing cockpit baseline for usage, channel mix, publish/apply outcomes, and plan pressure.

F4 requires a serious, scanable business view while preserving separation from ops truth and avoiding a heavy BI platform.

## Decision

1. Add a dedicated business cockpit read endpoint:
   - `GET /api/v1/admin/business/cockpit`
   - role-gated via existing admin read authorization boundary.

2. Introduce a bounded business read model:
   - `ResolveAdminBusinessCockpitService`
   - `AdminBusinessCockpitState`.

3. Scope business cockpit metrics to high-signal baseline only:
   - active assistants
   - active chats
   - channel split
   - publish/apply success snapshot (last 7 days)
   - quota pressure snapshot
   - plan usage snapshot.

4. Keep strict separation:
   - business cockpit is read-only commercial/product visibility.
   - ops cockpit remains the operational/runtime-control view.

## Consequences

### Positive
- Admins get a compact commercial/product cockpit without manual DB/log digging.
- Business and operations views remain distinct and easier to reason about.
- Existing F1/F2/F3 boundaries remain intact.

### Negative
- F4 does not provide long-range trends, custom filtering, cohort analysis, or BI exports.
- Channel split remains baseline and bounded to currently available control-plane signals.

## Out of scope (F4)
- heavy BI platform capabilities
- vanity-only metrics and decorative dashboards
- deep historical analytics/reporting workflows
