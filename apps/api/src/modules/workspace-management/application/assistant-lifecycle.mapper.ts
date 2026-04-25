import type { Assistant } from "../domain/assistant.entity";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import type { AssistantMaterializedSpec } from "../domain/assistant-materialized-spec.entity";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type {
  AssistantGovernanceState,
  AssistantLifecycleState,
  AssistantPublishedVersionState
} from "./assistant-lifecycle.types";
import {
  applyAssistantGenderVoiceDefaults,
  normalizeAssistantVoiceProfile
} from "./assistant-voice-profile";
import { normalizeAssistantGender } from "./assistant-gender";
import {
  readRuntimeAssignmentStateFromMaterializedLayers,
  resolveRuntimeTierOverrideFromPolicyEnvelope
} from "./runtime-assignment";

/**
 * ADR-076 Slice 4 — only the new content-addressed shape (`/api/avatar/<hash>.<ext>`)
 * is exposed in lifecycle state. Legacy absolute URLs persisted in dev databases
 * are returned as `null` so the UI falls back to the emoji/sparkles avatar
 * instead of pointing the browser at a removed bearer-protected endpoint.
 * Re-uploading the avatar repopulates the field with a fresh hashed URL.
 */
function sanitizeAvatarUrl(rawAvatarUrl: string | null): string | null {
  if (rawAvatarUrl === null) {
    return null;
  }
  return rawAvatarUrl.startsWith("/api/avatar/") ? rawAvatarUrl : null;
}

export function toAssistantPublishedVersionState(
  publishedVersion: AssistantPublishedVersion
): AssistantPublishedVersionState {
  const assistantGender = normalizeAssistantGender(publishedVersion.snapshotAssistantGender);
  return {
    id: publishedVersion.id,
    version: publishedVersion.version,
    publishedByUserId: publishedVersion.publishedByUserId,
    publishedAt: publishedVersion.createdAt.toISOString(),
    snapshot: {
      displayName: publishedVersion.snapshotDisplayName,
      instructions: publishedVersion.snapshotInstructions,
      traits: publishedVersion.snapshotTraits,
      avatarEmoji: publishedVersion.snapshotAvatarEmoji,
      avatarUrl: sanitizeAvatarUrl(publishedVersion.snapshotAvatarUrl),
      assistantGender,
      voiceProfile: applyAssistantGenderVoiceDefaults({
        assistantGender,
        voiceProfile: normalizeAssistantVoiceProfile(publishedVersion.snapshotVoiceProfile)
      }),
      archetypeKey: publishedVersion.snapshotArchetypeKey
    }
  };
}

export function toAssistantLifecycleState(
  assistant: Assistant,
  latestPublishedVersion: AssistantPublishedVersion | null,
  governance: AssistantGovernance | null,
  materialization: AssistantMaterializedSpec | null
): AssistantLifecycleState {
  const assistantGender = normalizeAssistantGender(assistant.draftAssistantGender);
  const governanceState: AssistantGovernanceState = {
    capabilityEnvelope: governance?.capabilityEnvelope ?? null,
    secretRefs: governance?.secretRefs ?? null,
    policyEnvelope: governance?.policyEnvelope ?? null,
    runtimeTierOverride: resolveRuntimeTierOverrideFromPolicyEnvelope(
      governance?.policyEnvelope ?? null
    ),
    memoryControl: governance?.memoryControl ?? null,
    tasksControl: governance?.tasksControl ?? null,
    assistantPlanOverrideCode: governance?.assistantPlanOverrideCode ?? null,
    quotaPlanCode: governance?.quotaPlanCode ?? null,
    quotaHook: governance?.quotaHook ?? null,
    auditHook: governance?.auditHook ?? null,
    platformManagedUpdatedAt: governance?.updatedAt?.toISOString() ?? null
  };

  return {
    id: assistant.id,
    userId: assistant.userId,
    workspaceId: assistant.workspaceId,
    draft: {
      displayName: assistant.draftDisplayName,
      instructions: assistant.draftInstructions,
      traits: assistant.draftTraits,
      avatarEmoji: assistant.draftAvatarEmoji,
      avatarUrl: sanitizeAvatarUrl(assistant.draftAvatarUrl),
      assistantGender,
      voiceProfile: applyAssistantGenderVoiceDefaults({
        assistantGender,
        voiceProfile: normalizeAssistantVoiceProfile(assistant.draftVoiceProfile)
      }),
      archetypeKey: assistant.draftArchetypeKey,
      updatedAt: assistant.draftUpdatedAt?.toISOString() ?? null
    },
    latestPublishedVersion:
      latestPublishedVersion === null
        ? null
        : toAssistantPublishedVersionState(latestPublishedVersion),
    runtimeApply: {
      status: assistant.applyStatus,
      targetPublishedVersionId: assistant.applyTargetVersionId,
      appliedPublishedVersionId: assistant.applyAppliedVersionId,
      requestedAt: assistant.applyRequestedAt?.toISOString() ?? null,
      startedAt: assistant.applyStartedAt?.toISOString() ?? null,
      finishedAt: assistant.applyFinishedAt?.toISOString() ?? null,
      error:
        assistant.applyErrorCode === null && assistant.applyErrorMessage === null
          ? null
          : {
              code: assistant.applyErrorCode,
              message: assistant.applyErrorMessage
            }
    },
    governance: governanceState,
    materialization: {
      latestSpecId: materialization?.id ?? null,
      publishedVersionId: materialization?.publishedVersionId ?? null,
      sourceAction: materialization?.sourceAction ?? null,
      algorithmVersion: materialization?.algorithmVersion ?? null,
      contentHash: materialization?.contentHash ?? null,
      generatedAt: materialization?.createdAt?.toISOString() ?? null,
      runtimeAssignment: readRuntimeAssignmentStateFromMaterializedLayers(
        materialization?.layers ?? null
      ),
      assistantConfigDocument: materialization?.assistantConfigDocument ?? null,
      assistantWorkspaceDocument: materialization?.assistantWorkspaceDocument ?? null
    },
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString()
  };
}
