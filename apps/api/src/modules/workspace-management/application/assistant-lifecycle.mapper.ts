import type { Assistant } from "../domain/assistant.entity";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";

export function toAssistantLifecycleState(assistant: Assistant): AssistantLifecycleState {
  return {
    id: assistant.id,
    userId: assistant.userId,
    workspaceId: assistant.workspaceId,
    draft: {
      displayName: assistant.draftDisplayName,
      instructions: assistant.draftInstructions,
      updatedAt: assistant.draftUpdatedAt?.toISOString() ?? null
    },
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString()
  };
}
