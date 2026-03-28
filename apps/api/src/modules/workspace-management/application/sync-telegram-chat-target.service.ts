import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";

export interface TelegramChatTargetSyncRequest {
  assistantId: string;
  telegramChatId: string;
  chatType: string;
  title: string | null;
  username: string | null;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class SyncTelegramChatTargetService {
  constructor(
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository
  ) {}

  parseInput(body: unknown): TelegramChatTargetSyncRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Body must be an object.");
    }

    const row = body as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      telegramChatId: normalizeRequiredString(row.telegramChatId, "telegramChatId"),
      chatType: normalizeRequiredString(row.chatType, "chatType"),
      title: normalizeOptionalString(row.title),
      username: normalizeOptionalString(row.username)
    };
  }

  async execute(input: TelegramChatTargetSyncRequest): Promise<void> {
    const isPrivateChat = input.chatType === "private";
    await this.assistantChannelSurfaceBindingRepository.patchMetadata(
      input.assistantId,
      "telegram",
      "telegram_bot",
      {
        ...(isPrivateChat
          ? {
              telegramDmChatId: input.telegramChatId,
              telegramDmUsername: input.username,
              telegramDmUpdatedAt: new Date().toISOString()
            }
          : {
              telegramLastGroupChatId: input.telegramChatId,
              telegramLastGroupChatType: input.chatType,
              telegramLastGroupChatTitle: input.title,
              telegramLastGroupUpdatedAt: new Date().toISOString()
            }),
        reminderDeliveryChatId: input.telegramChatId,
        reminderDeliveryChatType: input.chatType,
        reminderDeliveryChatTitle: input.title,
        reminderDeliveryUsername: input.username,
        reminderDeliveryUpdatedAt: new Date().toISOString()
      }
    );
  }
}
