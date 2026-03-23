# ADR-039: Ops cockpit baseline (Step 9 F3)

## Status
Accepted

## Context

F1 and F2 established append-only audit truth and admin RBAC/step-up protections, but day-to-day operations still depended on manual log scanning and database inspection for basic lifecycle/runtime status checks.

F3 requires a serious, readable ops cockpit baseline that surfaces high-signal control-plane truth without widening into full BI or noisy raw metrics walls.

## Decision

1. Add a role-gated admin ops cockpit read endpoint:
   - `GET /api/v1/admin/ops/cockpit`
   - same read authorization boundary as other admin read surfaces (`ops_admin|business_admin|security_admin|super_admin` with narrow owner fallback compatibility).

2. Introduce a centralized read-model resolver:
   - `ResolveAdminOpsCockpitService`
   - aggregates:
     - assistant presence and latest published pointer
     - runtime apply status/error truth
     - runtime preflight snapshot
     - minimal topology awareness (`OPENCLAW_ADAPTER_ENABLED`, `OPENCLAW_BASE_URL` host)
     - high-signal incident projection.

3. Keep incident projection intentionally bounded:
   - `assistant_absent`
   - `assistant_not_published`
   - `runtime_preflight_unhealthy`
   - `runtime_apply_failed`
   - `runtime_apply_degraded`
   - `runtime_apply_in_progress`
   - no raw event dump and no broad BI expansion in F3.

4. Surface only already-supported operational controls:
   - reapply support is surfaced when a latest published version exists.
   - restart is explicitly marked unsupported in this slice.

5. Add a concise ops cockpit UI section in web `/app` admin area:
   - status snapshot, publish/apply truth, incident list, topology line, and reapply trigger.
   - preserves calm, readable operator-oriented design.

## Consequences

### Positive
- Operators can check baseline assistant/runtime health and publish/apply truth without raw DB/log inspection.
- Ops cockpit remains high-signal and readable.
- Existing RBAC and audit assumptions remain intact.

### Negative
- F3 does not add historical analytics, trend charts, or business KPI reporting.
- Restart control is not introduced.
- Scope remains focused to per-operator assistant/runtime baseline visibility.

## Out of scope (F3)
- full BI/business cockpit features
- broad metric dashboards or unbounded operational telemetry walls
- restart/redeploy orchestration controls
