import type { Assistant } from "./assistant.entity";

export const ASSISTANT_REPOSITORY = Symbol("ASSISTANT_REPOSITORY");

export interface UpdateAssistantDraftInput {
  draftDisplayName: string | null;
  draftInstructions: string | null;
}

export interface AssistantRepository {
  findByUserId(userId: string): Promise<Assistant | null>;
  create(userId: string, workspaceId: string): Promise<Assistant>;
  updateDraft(userId: string, input: UpdateAssistantDraftInput): Promise<Assistant | null>;
  markApplyPending(userId: string, targetVersionId: string): Promise<Assistant | null>;
}
