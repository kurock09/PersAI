import type { AssistantGovernance } from "./assistant-governance.entity";
import { createDefaultTasksControlEnvelope } from "./assistant-tasks-control.defaults";

function parsePolicyObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/**
 * Canonical merged tasks_control document for materialization and future Tasks Center (D5+).
 * Legacy: policyEnvelope.tasksControl when top-level tasks_control is absent.
 */
export function resolveEffectiveTasksControlFromGovernance(
  governance: AssistantGovernance | null
): Record<string, unknown> {
  if (governance === null) {
    return createDefaultTasksControlEnvelope();
  }

  const direct = governance.tasksControl;
  if (direct !== null && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const policyEnvelope = parsePolicyObject(governance.policyEnvelope);
  const legacy = parsePolicyObject(policyEnvelope?.tasksControl ?? null);
  if (legacy !== null) {
    return legacy;
  }

  return createDefaultTasksControlEnvelope();
}
