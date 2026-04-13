import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";

const REMINDER_CONTEXT_MESSAGES_MAX = 10;
const REMINDER_CONTEXT_PER_MESSAGE_MAX = 220;
const REMINDER_CONTEXT_TOTAL_MAX = 700;
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

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
  const markerIndex = value.indexOf(REMINDER_CONTEXT_MARKER);
  if (markerIndex === -1) {
    return value.trim();
  }
  return value.slice(0, markerIndex).trim();
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
