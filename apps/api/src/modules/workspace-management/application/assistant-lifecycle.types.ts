export interface AssistantDraftState {
  displayName: string | null;
  instructions: string | null;
  updatedAt: string | null;
}

export interface AssistantLifecycleState {
  id: string;
  userId: string;
  workspaceId: string;
  draft: AssistantDraftState;
  createdAt: string;
  updatedAt: string;
}
