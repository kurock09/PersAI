/**
 * Step 6 D4: canonical control-plane envelope for tasks / reminders / triggers governance.
 * OpenClaw owns execution and scheduling; PersAI owns visibility, ownership metadata, user controls, and audit routing.
 */
export const PERSAI_TASKS_CONTROL_SCHEMA_V1 = "persai.tasksControl.v1" as const;

export function createDefaultTasksControlEnvelope(): Record<string, unknown> {
  return {
    schema: PERSAI_TASKS_CONTROL_SCHEMA_V1,
    ownership: {
      schemaVersion: 1,
      /** Control-plane rows are scoped to the assistant’s primary user (MVP 1:1 assistant). */
      model: "user_assistant_owner"
    },
    sourceSurfaces: {
      schemaVersion: 1,
      /** Surfaces that may attach source/surface tags to task visibility records (not execution routing). */
      knownSurfaces: ["web"],
      requireSurfaceTag: true
    },
    controlLifecycle: {
      schemaVersion: 1,
      /** Labels for user-facing task control state; runtime execution phases stay OpenClaw-owned. */
      statusKinds: ["scheduled", "enabled", "disabled", "cancelled", "superseded"],
      executionOwnedBy: "openclaw_runtime"
    },
    enablement: {
      schemaVersion: 1,
      userMayDisable: true,
      userMayEnable: true
    },
    cancellation: {
      schemaVersion: 1,
      userMayCancel: true
    },
    commercialQuota: {
      schemaVersion: 1,
      /** Tasks/reminders/triggers are not a commercial quota dimension (Step 7 plan engine must not bill on task counts). */
      tasksExcludedFromPlanQuotas: true
    },
    audit: {
      schemaVersion: 1,
      delegateToGovernanceAuditHook: true
    }
  };
}
