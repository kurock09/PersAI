import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

export type AssistantApplyStatus =
  | "not_requested"
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "degraded";

/** ADR-146 — assistant-owned sandbox egress posture. */
export type AssistantSandboxEgressMode = "restricted" | "full_public";

export type Assistant = {
  id: string;
  userId: string;
  workspaceId: string;
  /**
   * Stable, URL/path-safe identifier for the assistant. After ADR-128 Slice 4
   * the workspace is flat and no longer uses the handle for path
   * classification, but the handle is still useful as an addressable name
   * in audit logs, pod annotations, and bash environment hints.
   * Generated from `draftDisplayName` and de-duplicated per workspace;
   * remains stable across rename.
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
  roleId: string;
  /** ADR-146 — owner-controlled sandbox egress; default `restricted`. */
  sandboxEgressMode: AssistantSandboxEgressMode;
  createdAt: Date;
  updatedAt: Date;
};
