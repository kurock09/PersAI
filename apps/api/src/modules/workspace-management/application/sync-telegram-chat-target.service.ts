import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
// ADR-074 Slice T2: VALUE import (not `import type`) — Nest needs the class
// symbol at runtime for DI. M2/T1 precedent: `import type` for an injectable
// is the known DI footgun that throws `UnknownDependenciesException` at boot.
import { AutoSelectNotificationChannelOnBindService } from "./auto-select-notification-channel-on-bind.service";

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
  private readonly logger = new Logger(SyncTelegramChatTargetService.name);

  constructor(
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly autoSelectNotificationChannelOnBindService: AutoSelectNotificationChannelOnBindService
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

    // ADR-074 Slice T2 — auto-route T1 pushes to first-bound notification
    // channel. Only the private-DM owner-claim transition counts as a "bind
    // completion" for routing purposes: it is the first moment when the
    // binding has a `telegramDmChatId` populated (above) AND an established
    // owner identity, which together is exactly what
    // `tryDeliverReminderToTelegram` requires. Group-chat updates and
    // non-claim metadata refreshes are NOT bind completions and must not
    // touch the user's notification preference.
    //
    // Best-effort: helper failures (e.g. assistant row missing in a
    // multi-shard race) must not roll back the bind itself. The helper
    // catches and logs internally; we still wrap it for total safety.
    if (input.claimOwner && isPrivateChat) {
      try {
        await this.autoSelectNotificationChannelOnBindService.execute({
          assistantId: input.assistantId,
          bindingChannel: "telegram"
        });
      } catch (error) {
        this.logger.warn(
          `AutoSelectNotificationChannelOnBind failed for assistant ${input.assistantId} after Telegram owner-claim; bind succeeded but preferred channel left unchanged: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}
