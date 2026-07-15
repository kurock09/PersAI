import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

export interface AssistantDraftState {
  displayName: string | null;
  instructions: string | null;
  traits: Record<string, number> | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  assistantGender: string | null;
  voiceProfile: RuntimeAssistantVoiceProfile;
  /** ADR-074 V1 — selected Voice DNA archetype key (e.g. "warm-quiet"). */
  archetypeKey: string | null;
  updatedAt: string | null;
}

export interface AssistantPublishedVersionSnapshotState {
  displayName: string | null;
  instructions: string | null;
  traits: Record<string, number> | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  assistantGender: string | null;
  voiceProfile: RuntimeAssistantVoiceProfile;
  /** ADR-074 V1 — archetype key snapshot (locale-agnostic key). */
  archetypeKey: string | null;
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

export type AssistantRuntimeTier =
  | "free_shared_restricted"
  | "paid_shared_restricted"
  | "paid_isolated";

export type AssistantRuntimeAssignmentSource =
  | "platform_fallback"
  | "plan_default"
  | "assistant_override";

export interface AssistantRuntimeAssignmentState {
  schema: "persai.runtimeAssignment.v1";
  planDefaultTier: AssistantRuntimeTier | null;
  runtimeTierOverride: AssistantRuntimeTier | null;
  effectiveTier: AssistantRuntimeTier;
  source: AssistantRuntimeAssignmentSource;
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
  runtimeTierOverride: AssistantRuntimeTier | null;
  /** Step 6 D1: memory control-plane envelope (not runtime memory contents). */
  memoryControl: unknown | null;
  /** Step 6 D4: tasks/reminders/triggers control-plane envelope (not execution or scheduling). */
  tasksControl: unknown | null;
  assistantPlanOverrideCode: string | null;
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
  runtimeAssignment: AssistantRuntimeAssignmentState | null;
  assistantConfigDocument: string | null;
  assistantWorkspaceDocument: string | null;
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

export interface AssistantListItemRoleState {
  key: string;
  name: Record<string, string>;
}

export interface AssistantListItemState {
  id: string;
  displayName: string | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  role: AssistantListItemRoleState;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantLimitState {
  usedAssistants: number;
  maxAssistants: number;
}

export interface AssistantDirectoryState {
  assistants: AssistantListItemState[];
  activeAssistantId: string | null;
  assistantLimit: AssistantLimitState;
}

export interface AssistantLifecycleViewState extends AssistantDirectoryState {
  assistant: AssistantLifecycleState | null;
}
