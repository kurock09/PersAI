export type PlatformRolloutPatch = {
  capabilityEnvelope?: unknown;
  secretRefs?: unknown;
  policyEnvelope?: unknown;
  memoryControl?: unknown;
  tasksControl?: unknown;
  quotaHook?: unknown;
  auditHook?: unknown;
};

export type PlatformRolloutState = {
  id: string;
  status: "in_progress" | "applied" | "rolled_back" | "failed";
  rolloutPercent: number;
  targetPatch: PlatformRolloutPatch;
  totalAssistants: number;
  targetedAssistants: number;
  applySucceededCount: number;
  applyDegradedCount: number;
  applyFailedCount: number;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
};
