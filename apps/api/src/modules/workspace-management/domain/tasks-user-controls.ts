/**
 * Reads user affordance flags from resolved tasks_control envelope (D4).
 */

export type TasksUserControlFlags = {
  userMayDisable: boolean;
  userMayEnable: boolean;
  userMayCancel: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getTasksUserControlFlags(effectiveTasksControl: Record<string, unknown>): TasksUserControlFlags {
  const enablement = asRecord(effectiveTasksControl.enablement);
  const cancellation = asRecord(effectiveTasksControl.cancellation);

  return {
    userMayDisable: enablement?.userMayDisable !== false,
    userMayEnable: enablement?.userMayEnable !== false,
    userMayCancel: cancellation?.userMayCancel !== false
  };
}
