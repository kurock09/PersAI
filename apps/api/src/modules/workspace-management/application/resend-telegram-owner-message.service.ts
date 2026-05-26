import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import {
  isTelegramOwnerClaimExpired,
  resolveTelegramBindingMetadataState
} from "./telegram-integration.metadata";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";
import type { TelegramIntegrationState } from "./telegram-integration.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

function telegramBotSecretKey(assistantId: string): string {
  return `telegram_bot:${assistantId}`;
}

function buildPendingClaimPrompt(locale: string): string {
  return locale === "ru"
    ? "Чтобы подтвердить владельца ассистента, отправьте сюда актуальный 6-значный код из PersAI."
    : "To confirm that you are the assistant owner, send the current 6-digit code from PersAI here.";
}

function buildClaimedWelcome(locale: string): string {
  return locale === "ru"
    ? "Привязка Telegram уже подтверждена. Можете продолжать общение здесь."
    : "Telegram owner claim is already complete. You can continue chatting here.";
}

@Injectable()
export class ResendTelegramOwnerMessageService {
  constructor(
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async execute(userId: string): Promise<TelegramIntegrationState> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId })).assistant;

    const binding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistant.id,
        "telegram",
        "telegram_bot"
      );
    if (binding === null || binding.bindingState !== "active") {
      throw new BadRequestException("Telegram bot is not connected.");
    }

    const metadata = resolveTelegramBindingMetadataState(binding.metadata);
    const chatId = metadata.telegramOwnerTelegramChatId;
    if (!chatId) {
      throw new BadRequestException(
        "Telegram chat is not known yet. Open the bot chat and send any message first."
      );
    }

    const integration = await this.resolveTelegramIntegrationStateService.execute(userId);
    const freshState = integration.ownerClaim;
    const locale = await this.resolveWorkspaceLocale(assistant.workspaceId);
    const message =
      freshState.status === "claimed"
        ? buildClaimedWelcome(locale)
        : buildPendingClaimPrompt(locale);

    const botToken =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        telegramBotSecretKey(assistant.id)
      );
    if (!botToken) {
      throw new ServiceUnavailableException("Telegram bot token is unavailable.");
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    }).catch(() => null);

    if (response?.ok !== true) {
      throw new ServiceUnavailableException("Telegram message could not be delivered.");
    }

    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));
    void governance;

    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "channel_binding",
      eventCode: "assistant.telegram_owner_message_resent",
      summary: "Telegram owner message resent from PersAI.",
      details: {
        ownerClaimStatus: freshState.status,
        ownerTelegramChatId: chatId,
        claimCodeExpiresAt: freshState.claimExpiresAt,
        claimCodeExpired: isTelegramOwnerClaimExpired(freshState.claimExpiresAt)
      }
    });

    return this.resolveTelegramIntegrationStateService.execute(userId);
  }

  private async resolveWorkspaceLocale(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { locale: true }
    });
    return workspace?.locale === "ru" ? "ru" : "en";
  }
}
