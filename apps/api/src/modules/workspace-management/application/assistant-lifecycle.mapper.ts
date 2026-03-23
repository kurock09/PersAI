import type { Assistant } from "../domain/assistant.entity";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import type { AssistantMaterializedSpec } from "../domain/assistant-materialized-spec.entity";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type {
  AssistantGovernanceState,
  AssistantLifecycleState,
  AssistantPublishedVersionState
} from "./assistant-lifecycle.types";

export function toAssistantPublishedVersionState(
  publishedVersion: AssistantPublishedVersion
): AssistantPublishedVersionState {
  return {
    id: publishedVersion.id,
    version: publishedVersion.version,
    publishedByUserId: publishedVersion.publishedByUserId,
    publishedAt: publishedVersion.createdAt.toISOString(),
    snapshot: {
      displayName: publishedVersion.snapshotDisplayName,
      instructions: publishedVersion.snapshotInstructions
    }
  };
}

export function toAssistantLifecycleState(
  assistant: Assistant,
  latestPublishedVersion: AssistantPublishedVersion | null,
  governance: AssistantGovernance | null,
  materialization: AssistantMaterializedSpec | null
): AssistantLifecycleState {
  const governanceState: AssistantGovernanceState = {
    capabilityEnvelope: governance?.capabilityEnvelope ?? null,
    secretRefs: governance?.secretRefs ?? null,
    policyEnvelope: governance?.policyEnvelope ?? null,
    memoryControl: governance?.memoryControl ?? null,
    tasksControl: governance?.tasksControl ?? null,
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
      openclawBootstrapDocument: materialization?.openclawBootstrapDocument ?? null,
      openclawWorkspaceDocument: materialization?.openclawWorkspaceDocument ?? null
    },
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString()
  };
}
