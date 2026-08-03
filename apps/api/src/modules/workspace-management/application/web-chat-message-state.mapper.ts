import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type {
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState,
  AssistantWebChatPlatformNoticeState
} from "./web-chat.types";
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
  const turnEvents = extractTurnEventsFromMetadata(input.message.metadata);
  const conversationalPublish = extractConversationalPublishFromMetadata(input.message.metadata);
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
    ...(turnEvents.length > 0 ? { turnEvents } : {}),
    ...(conversationalPublish ? { conversationalPublish: true } : {})
  };
}

export function extractConversationalPublishFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.conversationalPublish === true;
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
