export type AssistantGovernance = {
  id: string;
  assistantId: string;
  capabilityEnvelope: unknown | null;
  secretRefs: unknown | null;
  policyEnvelope: unknown | null;
  quotaPlanCode: string | null;
  quotaHook: unknown | null;
  auditHook: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};
