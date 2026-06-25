import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

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
  /**
   * ADR-126 Slice 3 — stable, URL/path-safe identifier used as the directory
   * name under `/workspace/outbound/<handle>/` inside session pods.
   * Generated from `draftDisplayName` and de-duplicated per workspace; remains
   * stable across rename.
   */
  handle: string;
  draftDisplayName: string | null;
  draftInstructions: string | null;
  draftTraits: Record<string, number> | null;
  draftAvatarEmoji: string | null;
  draftAvatarUrl: string | null;
  draftAssistantGender: string | null;
  draftVoiceProfile: RuntimeAssistantVoiceProfile | null;
  /** ADR-074 V1 — selected Voice DNA archetype key (e.g. "warm-quiet"). */
  draftArchetypeKey: string | null;
  draftUpdatedAt: Date | null;
  applyStatus: AssistantApplyStatus;
  applyTargetVersionId: string | null;
  applyAppliedVersionId: string | null;
  applyRequestedAt: Date | null;
  applyStartedAt: Date | null;
  applyFinishedAt: Date | null;
  applyErrorCode: string | null;
  applyErrorMessage: string | null;
  configDirtyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
