import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type {
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState,
  AssistantWebChatPlatformNoticeState
} from "./web-chat.types";
import type { ClientRuntimeTurnToolInvocation } from "./strip-tool-invocations-for-client";

export function extractAssistantWebChatPlatformNotice(
  metadata: Record<string, unknown> | null | undefined
): AssistantWebChatPlatformNoticeState | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const kind = metadata.kind;
  if (kind !== "safety_inbound_warn" && kind !== "safety_inbound_restricted") {
    return null;
  }
  const reasonCode =
    typeof metadata.reasonCode === "string" && metadata.reasonCode.trim().length > 0
      ? metadata.reasonCode.trim()
      : "structural_abuse_signal";
  return { kind, reasonCode };
}

export function mapAssistantChatMessageToWebState(input: {
  message: Pick<
    AssistantChatMessage,
    "id" | "chatId" | "assistantId" | "author" | "content" | "metadata" | "createdAt"
  >;
  attachments: AssistantWebChatMessageAttachmentState[];
}): AssistantWebChatMessageState {
  const platformNotice = extractAssistantWebChatPlatformNotice(input.message.metadata);
  const workingNotes = extractWorkingNotesFromMetadata(input.message.metadata);
  const toolInvocations = extractToolInvocationsFromMetadata(input.message.metadata);
  return {
    id: input.message.id,
    chatId: input.message.chatId,
    assistantId: input.message.assistantId,
    author: input.message.author,
    content: input.message.content,
    attachments: input.attachments,
    createdAt: input.message.createdAt.toISOString(),
    ...(platformNotice !== null ? { platformNotice } : {}),
    ...(workingNotes.length > 0 ? { workingNotes } : {}),
    ...(toolInvocations.length > 0 ? { toolInvocations } : {})
  };
}

export function extractWorkingNotesFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string[] {
  if (metadata === null || metadata === undefined) {
    return [];
  }
  const value = metadata.workingNotes;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
}

export function extractToolInvocationsFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ClientRuntimeTurnToolInvocation[] {
  if (metadata === null || metadata === undefined) {
    return [];
  }
  const value = metadata.toolInvocations;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is ClientRuntimeTurnToolInvocation => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.name === "string" &&
      typeof candidate.iteration === "number" &&
      Number.isInteger(candidate.iteration) &&
      typeof candidate.ok === "boolean"
    );
  });
}
