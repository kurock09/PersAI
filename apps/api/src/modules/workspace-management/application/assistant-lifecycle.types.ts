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

export interface AssistantLifecycleState {
  id: string;
  userId: string;
  workspaceId: string;
  draft: AssistantDraftState;
  latestPublishedVersion: AssistantPublishedVersionState | null;
  createdAt: string;
  updatedAt: string;
}
