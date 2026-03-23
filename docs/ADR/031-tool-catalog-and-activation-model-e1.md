# ADR-031: Tool catalog and activation model (Step 8 E1)

## Status
Accepted

## Context

Step 7 P1-P7 established plan/subscription/capability/quota/enforcement and class-level `toolAvailability` projection.  
Per-tool activation truth is still missing: runtime receives class-level availability only, and there is no canonical tool catalog persistence.

Step 8 E1 requires a minimal control-plane baseline for:

- canonical tool catalog entries
- plan-scoped tool activation state
- explicit per-tool availability projection to OpenClaw materialization

This slice must preserve current boundaries:

- backend remains governance/control plane
- OpenClaw remains behavior/runtime plane
- no backend tool execution routing
- no new billing provider workflow

## Decision

1. Add canonical tool catalog persistence:
   - `tool_catalog_tools`
   - fields: `code`, `displayName`, `description`, `toolClass`, `status`, provider-agnostic `providerHints`

2. Add plan-scoped activation persistence:
   - `plan_catalog_tool_activations`
   - one row per `(plan, tool)` with `activationStatus`
   - DB uniqueness and FK constraints enforce catalog integrity

3. Keep admin plan management API shape stable in E1.
   - No new public endpoints for per-tool activation in this slice.
   - Existing create/update plan flows auto-synchronize tool activation baselines from tool-class entitlement toggles.

4. Materialization updates tool availability projection from class-only baseline to catalog-backed per-tool baseline:
   - schema moved to `persai.effectiveToolAvailability.v2`
   - includes:
     - class-level availability summary
     - per-tool activation list derived from:
       - plan activation row
       - effective capability class guardrail
   - OpenClaw still receives explicit truth; backend still does not route runtime behavior.

## Consequences

### Positive

- Introduces canonical, reviewable per-tool activation truth without widening to runtime routing.
- Preserves Step 7 enforcement and percentage-limit UX behavior.
- Keeps Step 2 and O1-O6 foundations intact.

### Negative

- E1 does not expose per-tool activation controls in web/admin UI yet.
- E1 does not add per-tool runtime enforcement endpoints; class-level enforcement points remain the active gates.

## Out of scope (E1)

- tool policy envelope redesign (E2)
- channel/surface binding hardening (E3)
- Telegram connection UX/workflow expansion (E4/E5)
- provider fallback engine expansion (E6)
