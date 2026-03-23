# ADR-022: Tasks control domain hardening (Step 6 D4)

## Status

Accepted

## Context

PersAI must own **task/reminder/trigger visibility and user control** while OpenClaw owns **execution and scheduling**. Step 7 plan/entitlements work must not treat task counts as a commercial quota dimension.

Prior governance stored capability/policy/quota hooks but had no first-class **tasks control-plane envelope** parallel to `memory_control`.

## Decision

1. Add `assistant_governance.tasks_control` JSONB as the **canonical** store for `persai.tasksControl.v1`.

2. Default envelope includes explicit sections:
   - **ownership** — MVP model `user_assistant_owner` (scoped to the assistant’s primary user)
   - **sourceSurfaces** — known surfaces + `requireSurfaceTag` (metadata for future Tasks Center rows; not execution routing)
   - **controlLifecycle** — control-plane **statusKinds** (`scheduled`, `enabled`, `disabled`, `cancelled`, `superseded`) and `executionOwnedBy: openclaw_runtime`
   - **enablement** — `userMayDisable` / `userMayEnable`
   - **cancellation** — `userMayCancel`
   - **commercialQuota** — `tasksExcludedFromPlanQuotas: true` (explicit non-dimension for billing)
   - **audit** — `delegateToGovernanceAuditHook: true` (same pattern as memory control)

3. **Resolution** for materialization: `tasks_control` column → legacy `policyEnvelope.tasksControl` → defaults (`resolveEffectiveTasksControlFromGovernance`).

4. **Materialization** adds resolved `tasksControl` next to `memoryControl` on `openclawWorkspace` and includes raw `tasksControl` on the embedded governance layer snapshot in `layers`.

5. Expose `governance.tasksControl` on assistant lifecycle reads (OpenAPI + generated contracts).

6. **Migration** backfills from `policyEnvelope.tasksControl` when object-shaped, otherwise applies MVP default JSON.

## Consequences

### Positive

- Tasks/reminders/triggers have an explicit, versioned control contract without adding a backend scheduler or moving execution routing into `apps/api`.
- Plan engine (Step 7) can read `tasksExcludedFromPlanQuotas` instead of inferring.

### Negative

- New column and API field; clients must accept `tasksControl` (nullable in responses but required key in schema).

## Out of scope (D4)

- Tasks Center UI, task list tables, CRUD APIs, cron/queue, OpenClaw behavior changes, no-code automation builder (D5+ / channel slices).
