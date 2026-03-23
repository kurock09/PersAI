export interface AssistantDraftState {
  displayName: string | null;
  instructions: string | null;
  updatedAt: string | null;
}

export interface AssistantPublishedVersionSnapshotState {
  displayName: string | null;
  instructions: string | null;
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

export interface AssistantLifecycleState {
  id: string;
  userId: string;
  workspaceId: string;
  draft: AssistantDraftState;
  latestPublishedVersion: AssistantPublishedVersionState | null;
  runtimeApply: AssistantRuntimeApplyState;
  createdAt: string;
  updatedAt: string;
}
