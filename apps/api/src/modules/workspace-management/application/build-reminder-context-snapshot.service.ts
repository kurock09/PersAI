import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";

const REMINDER_CONTEXT_MESSAGES_MAX = 10;
const REMINDER_CONTEXT_PER_MESSAGE_MAX = 220;
const REMINDER_CONTEXT_TOTAL_MAX = 700;
export const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

/**
 * Strip the `Recent context:\n…` block from a reminder text so the snapshot
 * (intended only as runtime LLM grounding context, never user-facing copy)
 * does not leak into the message we deliver to the user. Safe to call on
 * any text — returns the original trimmed text when no marker is present.
 *
 * Used by the cron-fire path before persisting the user-facing pushText into
 * a notification intent: the runtime sometimes echoes the full
 * brief-with-context back into `summary` instead of producing a short final
 * line, and we must not show that echo to the user.
 */
export function stripReminderContextSnapshot(value: string): string {
  const markerIndex = value.indexOf(REMINDER_CONTEXT_MARKER);
  if (markerIndex === -1) {
    return value.trim();
  }
  return value.slice(0, markerIndex).trim();
}

export type ReminderConversationContext = {
  channel: string;
  externalThreadKey: string;
};

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function stripExistingContext(value: string): string {
  return stripReminderContextSnapshot(value);
}

function toChatSurface(channel: string): "web" | "telegram" | null {
  const normalized = channel.trim().toLowerCase();
  if (normalized === "web" || normalized === "telegram") {
    return normalized;
  }
  return null;
}

@Injectable()
export class BuildReminderContextSnapshotService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async execute(params: {
    assistantId: string;
    reminderText: string;
    contextMessages?: number;
    conversationContext?: ReminderConversationContext;
  }): Promise<string> {
    const baseText = stripExistingContext(params.reminderText);
    const requestedCount = params.contextMessages;
    const maxMessages =
      typeof requestedCount === "number" && Number.isFinite(requestedCount)
        ? Math.min(REMINDER_CONTEXT_MESSAGES_MAX, Math.max(0, Math.floor(requestedCount)))
        : 0;
    if (maxMessages <= 0 || params.conversationContext === undefined) {
      return baseText;
    }

    const surface = toChatSurface(params.conversationContext.channel);
    if (surface === null) {
      return baseText;
    }
    const chat = await this.assistantChatRepository.findChatBySurfaceThread(
      params.assistantId,
      surface,
      params.conversationContext.externalThreadKey
    );
    if (chat === null) {
      return baseText;
    }

    const messages = await this.assistantChatRepository.listMessagesByChatId(chat.id);
    const recent = messages
      .filter(
        (message): message is typeof message & { author: "user" | "assistant"; content: string } =>
          (message.author === "user" || message.author === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim().length > 0
      )
      .slice(-maxMessages);
    if (recent.length === 0) {
      return baseText;
    }

    const lines: string[] = [];
    let total = 0;
    for (const message of recent) {
      const label = message.author === "user" ? "User" : "Assistant";
      const line = `- ${label}: ${truncateText(message.content.trim(), REMINDER_CONTEXT_PER_MESSAGE_MAX)}`;
      total += line.length;
      if (total > REMINDER_CONTEXT_TOTAL_MAX) {
        break;
      }
      lines.push(line);
    }

    if (lines.length === 0) {
      return baseText;
    }

    return `${baseText}${REMINDER_CONTEXT_MARKER}${lines.join("\n")}`;
  }
}
