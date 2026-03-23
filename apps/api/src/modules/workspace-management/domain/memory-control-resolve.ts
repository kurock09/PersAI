import type { AssistantGovernance } from "./assistant-governance.entity";
import { createDefaultMemoryControlEnvelope } from "./assistant-memory-control.defaults";

function parsePolicyObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/**
 * Canonical merged memory_control document for policy evaluation and materialization.
 * Legacy: policyEnvelope.memoryControl when top-level memory_control is absent.
 */
export function resolveEffectiveMemoryControlFromGovernance(
  governance: AssistantGovernance | null
): Record<string, unknown> {
  if (governance === null) {
    return createDefaultMemoryControlEnvelope();
  }

  const direct = governance.memoryControl;
  if (direct !== null && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const policyEnvelope = parsePolicyObject(governance.policyEnvelope);
  const legacy = parsePolicyObject(policyEnvelope?.memoryControl ?? null);
  if (legacy !== null) {
    return legacy;
  }

  return createDefaultMemoryControlEnvelope();
}
