export interface AssistantDraftState {
  displayName: string | null;
  instructions: string | null;
  traits: Record<string, number> | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  updatedAt: string | null;
}

export interface AssistantPublishedVersionSnapshotState {
  displayName: string | null;
  instructions: string | null;
  traits: Record<string, number> | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
}

export interface AssistantPublishedVersionState {
  id: string;
  version: number;
  publishedByUserId: string;
  publishedAt: string;
  snapshot: AssistantPublishedVersionSnapshotState;
}

export type AssistantRuntimeApplyStatus =
  | "not_requested"
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "degraded";

export interface AssistantRuntimeApplyErrorState {
  code: string | null;
  message: string | null;
}

export interface AssistantRuntimeApplyState {
  status: AssistantRuntimeApplyStatus;
  targetPublishedVersionId: string | null;
  appliedPublishedVersionId: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: AssistantRuntimeApplyErrorState | null;
}

export interface AssistantGovernanceState {
  capabilityEnvelope: unknown | null;
  secretRefs: unknown | null;
  policyEnvelope: unknown | null;
  /** Step 6 D1: memory control-plane envelope (not runtime memory contents). */
  memoryControl: unknown | null;
  /** Step 6 D4: tasks/reminders/triggers control-plane envelope (not execution or scheduling). */
  tasksControl: unknown | null;
  quotaPlanCode: string | null;
  quotaHook: unknown | null;
  auditHook: unknown | null;
  platformManagedUpdatedAt: string | null;
}

export interface AssistantMaterializationState {
  latestSpecId: string | null;
  publishedVersionId: string | null;
  sourceAction: "publish" | "rollback" | "reset" | null;
  algorithmVersion: number | null;
  contentHash: string | null;
  generatedAt: string | null;
  openclawBootstrapDocument: string | null;
  openclawWorkspaceDocument: string | null;
}

export interface AssistantLifecycleState {
  id: string;
  userId: string;
  workspaceId: string;
  draft: AssistantDraftState;
  latestPublishedVersion: AssistantPublishedVersionState | null;
  runtimeApply: AssistantRuntimeApplyState;
  governance: AssistantGovernanceState;
  materialization: AssistantMaterializationState;
  createdAt: string;
  updatedAt: string;
}
