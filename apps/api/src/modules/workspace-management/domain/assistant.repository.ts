import type { Assistant } from "./assistant.entity";
import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

export const ASSISTANT_REPOSITORY = Symbol("ASSISTANT_REPOSITORY");

export interface UpdateAssistantDraftInput {
  draftDisplayName: string | null;
  draftInstructions: string | null;
  draftTraits?: Record<string, number> | null;
  draftAvatarEmoji?: string | null;
  draftAvatarUrl?: string | null;
  draftAssistantGender?: string | null;
  draftVoiceProfile?: RuntimeAssistantVoiceProfile | null;
  draftArchetypeKey?: string | null;
}

export interface AssistantRepository {
  findById(id: string): Promise<Assistant | null>;
  findByUserId(userId: string): Promise<Assistant | null>;
  create(userId: string, workspaceId: string): Promise<Assistant>;
  updateDraft(userId: string, input: UpdateAssistantDraftInput): Promise<Assistant | null>;
  updateDraftByAssistantId(
    assistantId: string,
    input: UpdateAssistantDraftInput
  ): Promise<Assistant | null>;
  markApplyPending(userId: string, targetVersionId: string): Promise<Assistant | null>;
  markApplyPendingByAssistantId(
    assistantId: string,
    targetVersionId: string
  ): Promise<Assistant | null>;
  markApplyInProgress(userId: string, targetVersionId: string): Promise<Assistant | null>;
  markApplyInProgressByAssistantId(
    assistantId: string,
    targetVersionId: string
  ): Promise<Assistant | null>;
  markApplySucceeded(userId: string, appliedVersionId: string): Promise<Assistant | null>;
  markApplySucceededByAssistantId(
    assistantId: string,
    appliedVersionId: string
  ): Promise<Assistant | null>;
  markApplyFailed(
    userId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null>;
  markApplyFailedByAssistantId(
    assistantId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null>;
  markApplyDegraded(
    userId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null>;
  markApplyDegradedByAssistantId(
    assistantId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null>;
}
