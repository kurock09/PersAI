export type AssistantApplyStatus =
  | "not_requested"
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "degraded";

export type Assistant = {
  id: string;
  userId: string;
  workspaceId: string;
  draftDisplayName: string | null;
  draftInstructions: string | null;
  draftTraits: Record<string, number> | null;
  draftAvatarEmoji: string | null;
  draftAvatarUrl: string | null;
  draftUpdatedAt: Date | null;
  applyStatus: AssistantApplyStatus;
  applyTargetVersionId: string | null;
  applyAppliedVersionId: string | null;
  applyRequestedAt: Date | null;
  applyStartedAt: Date | null;
  applyFinishedAt: Date | null;
  applyErrorCode: string | null;
  applyErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};
