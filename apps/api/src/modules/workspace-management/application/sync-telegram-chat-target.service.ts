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
  telegramUserId: number | null;
  claimOwner: boolean;
  systemWelcomeSentAt: string | null;
  runtimeHealth: "ok" | "invalid_token" | null;
  runtimeHealthMessage: string | null;
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
      username: normalizeOptionalString(row.username),
      telegramUserId:
        typeof row.telegramUserId === "number" && Number.isFinite(row.telegramUserId)
          ? row.telegramUserId
          : null,
      claimOwner: row.claimOwner === true,
      systemWelcomeSentAt:
        typeof row.systemWelcomeSentAt === "string" && row.systemWelcomeSentAt.trim().length > 0
          ? row.systemWelcomeSentAt.trim()
          : null,
      runtimeHealth:
        row.runtimeHealth === "ok" || row.runtimeHealth === "invalid_token"
          ? row.runtimeHealth
          : null,
      runtimeHealthMessage: normalizeOptionalString(row.runtimeHealthMessage)
    };
  }

  async execute(input: TelegramChatTargetSyncRequest): Promise<void> {
    const isPrivateChat = input.chatType === "private";
    const metadataPatch: Record<string, unknown> = {
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
    };

    if (input.claimOwner && isPrivateChat) {
      metadataPatch.telegramOwnerClaimStatus = "claimed";
      metadataPatch.telegramOwnerClaimedAt = new Date().toISOString();
      metadataPatch.telegramOwnerTelegramUserId = input.telegramUserId;
      metadataPatch.telegramOwnerTelegramUsername = input.username;
      metadataPatch.telegramOwnerTelegramChatId = input.telegramChatId;
      metadataPatch.telegramRuntimeHealth = "ok";
      metadataPatch.telegramRuntimeHealthUpdatedAt = new Date().toISOString();
      metadataPatch.telegramRuntimeHealthMessage = null;
    }

    if (input.systemWelcomeSentAt) {
      metadataPatch.telegramOwnerSystemWelcomeSentAt = input.systemWelcomeSentAt;
    }

    if (input.runtimeHealth) {
      metadataPatch.telegramRuntimeHealth = input.runtimeHealth;
      metadataPatch.telegramRuntimeHealthUpdatedAt = new Date().toISOString();
      metadataPatch.telegramRuntimeHealthMessage = input.runtimeHealthMessage;
    }

    await this.assistantChannelSurfaceBindingRepository.patchMetadata(
      input.assistantId,
      "telegram",
      "telegram_bot",
      metadataPatch
    );
  }
}
