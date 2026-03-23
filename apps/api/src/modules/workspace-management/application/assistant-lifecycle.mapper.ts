import type { Assistant } from "../domain/assistant.entity";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type {
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
  latestPublishedVersion: AssistantPublishedVersion | null
): AssistantLifecycleState {
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
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString()
  };
}
