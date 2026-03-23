export type AssistantGovernance = {
  id: string;
  assistantId: string;
  capabilityEnvelope: unknown | null;
  secretRefs: unknown | null;
  policyEnvelope: unknown | null;
  /** Control-plane memory governance (policy, provenance hooks, visibility, forget markers, audit routing). */
  memoryControl: unknown | null;
  /** Control-plane tasks/reminders/triggers governance (ownership, surfaces, lifecycle labels, enable/cancel, quota exclusion, audit). */
  tasksControl: unknown | null;
  quotaPlanCode: string | null;
  quotaHook: unknown | null;
  auditHook: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};
