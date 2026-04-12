import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { resolveTelegramBindingMetadataState } from "./telegram-integration.metadata";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export interface ResolvedTelegramChannelRuntimeConfig {
  assistantId: string;
  workspaceId: string;
  locale: "ru" | "en";
  botToken: string;
  botUserId: number | null;
  botUsername: string | null;
  inbound: boolean;
  outbound: boolean;
  groupReplyMode: "mention_reply" | "all_messages";
  parseMode: string;
  accessMode: string;
  ownerClaimStatus: string;
  ownerClaimCode: string | null;
  ownerClaimCodeExpiresAt: string | null;
  ownerTelegramUserId: number | null;
  ownerTelegramUsername: string | null;
  ownerTelegramChatId: string | null;
  runtimeHealth: "ok" | "invalid_token";
  webhookSecret: string | null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveWebhookSecret(assistantId: string): string | null {
  const apiConfig = loadApiConfig(process.env);
  const hmacSecret = apiConfig.TELEGRAM_WEBHOOK_HMAC_SECRET?.trim() ?? "";
  if (hmacSecret.length === 0) {
    return null;
  }
  return createHmac("sha256", hmacSecret).update(assistantId).digest("hex").slice(0, 64);
}

function resolveWorkspaceLocale(raw: string | null | undefined): "ru" | "en" {
  if (typeof raw !== "string") {
    return "en";
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "ru" || normalized.startsWith("ru-") ? "ru" : "en";
}

@Injectable()
export class ResolveTelegramChannelRuntimeConfigService {
  constructor(
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async resolveByAssistantId(
    assistantId: string
  ): Promise<ResolvedTelegramChannelRuntimeConfig | null> {
    const [assistant, binding, botToken] = await Promise.all([
      this.prisma.assistant.findUnique({
        where: { id: assistantId },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              locale: true
            }
          }
        }
      }),
      this.bindingRepository.findByAssistantProviderSurface(
        assistantId,
        "telegram",
        "telegram_bot"
      ),
      this.platformRuntimeProviderSecretStoreService
        .resolveSecretValueByProviderKey(`telegram_bot:${assistantId}`)
        .catch(() => null)
    ]);

    if (assistant === null || binding === null || binding.bindingState !== "active" || !botToken) {
      return null;
    }

    const bindingConfig = asObject(binding.config);
    const bindingPolicy = asObject(binding.policy);
    const metadata = resolveTelegramBindingMetadataState(binding.metadata);

    return {
      assistantId,
      workspaceId: assistant.workspaceId,
      locale: resolveWorkspaceLocale(assistant.workspace?.locale),
      botToken,
      botUserId: metadata.telegramUserId,
      botUsername: metadata.username,
      inbound: bindingPolicy.inboundUserMessages !== false,
      outbound: bindingPolicy.outboundAssistantMessages !== false,
      groupReplyMode:
        bindingConfig.groupReplyMode === "all_messages" ? "all_messages" : "mention_reply",
      parseMode:
        typeof bindingConfig.defaultParseMode === "string"
          ? bindingConfig.defaultParseMode
          : "plain_text",
      accessMode: metadata.telegramAccessMode,
      ownerClaimStatus: metadata.telegramOwnerClaimStatus,
      ownerClaimCode: metadata.telegramOwnerClaimCode,
      ownerClaimCodeExpiresAt: metadata.telegramOwnerClaimExpiresAt,
      ownerTelegramUserId: metadata.telegramOwnerTelegramUserId,
      ownerTelegramUsername: metadata.telegramOwnerTelegramUsername,
      ownerTelegramChatId: metadata.telegramOwnerTelegramChatId,
      runtimeHealth: metadata.telegramRuntimeHealth,
      webhookSecret: resolveWebhookSecret(assistantId)
    };
  }
}
