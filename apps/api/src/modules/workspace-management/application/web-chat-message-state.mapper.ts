import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type {
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState,
  AssistantWebChatPlatformNoticeState
} from "./web-chat.types";
import type { ClientRuntimeTurnToolInvocation } from "./strip-tool-invocations-for-client";
import {
  projectTurnEventForWire,
  type PublicTurnEvent,
  type TurnEventWithInternalBookkeeping
} from "./turn-event-wire-projection";

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

export function extractMessageLifecycleFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): {
  status?: "partial" | "truncated";
  stopReason?: "user_stopped";
} {
  if (metadata === null || metadata === undefined) {
    return {};
  }
  const status =
    metadata.status === "partial" || metadata.status === "truncated" ? metadata.status : undefined;
  const stopReason = metadata.stopReason === "user_stopped" ? "user_stopped" : undefined;
  return {
    ...(status !== undefined ? { status } : {}),
    ...(stopReason !== undefined ? { stopReason } : {})
  };
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
  const inlineMediaPlacement = extractInlineMediaPlacementFromMetadata(input.message.metadata);
  const turnEvents = extractTurnEventsFromMetadata(input.message.metadata);
  const lifecycle = extractMessageLifecycleFromMetadata(input.message.metadata);
  return {
    id: input.message.id,
    chatId: input.message.chatId,
    assistantId: input.message.assistantId,
    author: input.message.author,
    content: input.message.content,
    attachments: input.attachments,
    createdAt: input.message.createdAt.toISOString(),
    ...lifecycle,
    ...(platformNotice !== null ? { platformNotice } : {}),
    ...(workingNotes.length > 0 ? { workingNotes } : {}),
    ...(toolInvocations.length > 0 ? { toolInvocations } : {}),
    ...(inlineMediaPlacement.length > 0 ? { inlineMediaPlacement } : {}),
    ...(turnEvents.length > 0 ? { turnEvents } : {})
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

const TURN_EVENT_KINDS = new Set([
  "note",
  "tool_call",
  "answer_text",
  "delivery",
  "job_accepted",
  "turn_stopped",
  "turn_failed"
]);

/**
 * ADR-170 D1/D3/D7/D3.3.1 — projects the durable `turnEvents` log for the
 * client. A historical message with no log (or malformed/missing entries)
 * simply yields an empty array, which the caller then omits from the state
 * object — the general rule for empty input, not a special-cased legacy
 * branch. This reads `metadata.turnEvents` directly (not through
 * `AppendTurnEventsService`), so every entry is run through the SAME
 * `projectTurnEventForWire` the append primitive itself uses, stripping the
 * server-only `draftKey`/`draftKeys` idempotency bookkeeping before it ever
 * reaches the client.
 */
export function extractTurnEventsFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): PublicTurnEvent[] {
  if (metadata === null || metadata === undefined) {
    return [];
  }
  const value = metadata.turnEvents;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is TurnEventWithInternalBookkeeping => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.kind === "string" &&
        TURN_EVENT_KINDS.has(candidate.kind) &&
        typeof candidate.seq === "number" &&
        Number.isInteger(candidate.seq) &&
        typeof candidate.at === "string"
      );
    })
    .map(projectTurnEventForWire);
}

export function extractInlineMediaPlacementFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): Array<{ toolCallId: string; attachmentIds: string[] }> {
  if (metadata === null || metadata === undefined) {
    return [];
  }
  const value = metadata.inlineMediaPlacement;
  if (!Array.isArray(value)) {
    return [];
  }
  const placements: Array<{ toolCallId: string; attachmentIds: string[] }> = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.toolCallId !== "string" || candidate.toolCallId.trim().length === 0) {
      continue;
    }
    if (!Array.isArray(candidate.attachmentIds)) {
      continue;
    }
    const attachmentIds = candidate.attachmentIds.filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0
    );
    if (attachmentIds.length === 0) {
      continue;
    }
    placements.push({
      toolCallId: candidate.toolCallId.trim(),
      attachmentIds
    });
  }
  return placements;
}
