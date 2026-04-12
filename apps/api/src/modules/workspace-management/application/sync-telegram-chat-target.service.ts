import { Inject, Injectable } from "@nestjs/common";
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

@Injectable()
export class SyncTelegramChatTargetService {
  constructor(
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository
  ) {}

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
      metadataPatch.telegramOwnerClaimCode = null;
      metadataPatch.telegramOwnerClaimedAt = new Date().toISOString();
      metadataPatch.telegramOwnerClaimExpiresAt = null;
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
