import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { runtimeOutputArtifactsToMediaArtifacts } from "./assistant-runtime.facade";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { RenderAssistantInboundSurfaceMessageService } from "./render-assistant-inbound-surface-message.service";
import { toAssistantInboundFailurePayload } from "./assistant-inbound-error";
import { MediaDeliveryService } from "./media/media-delivery.service";

const NOTIFICATION_WEB_CHAT_THREAD_KEY = "system:notifications";
const NOTIFICATION_WEB_CHAT_TITLE = "Notifications";
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

type StoredTelegramNotificationTarget = {
  chatId: string;
  chatType: string;
  title: string | null;
  username: string | null;
  source: "telegram_dm" | "telegram_group" | "web_telegram_dm";
  updatedAt: string;
};

type NotificationAssistant = {
  id: string;
  userId: string;
  workspaceId: string;
  preferredNotificationChannel: string;
  channelSurfaceBindings: Array<{ providerKey: string; metadata: unknown }>;
};

export type AssistantNotificationSource =
  | "user_reminder"
  | "background_task"
  | "idle_reengagement"
  | "system_event";

export type AssistantNotificationDeliveryStatus = "ok" | "error" | "skipped";

export type AssistantNotificationDeliveryTarget = "telegram" | "web" | "fallback_web" | "none";

export type AssistantNotificationDeliveryInput = {
  assistantId: string;
  source: AssistantNotificationSource;
  sourceId: string;
  status: AssistantNotificationDeliveryStatus;
  text?: string;
  artifacts?: RuntimeOutputArtifact[];
  metadata?: Record<string, unknown>;
};

export type AssistantNotificationDeliveryResult = {
  target: AssistantNotificationDeliveryTarget;
  deliveredAt?: string;
  chatId?: string;
  messageId?: string;
  attachmentIds?: string[];
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBindingMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeTelegramNotificationTarget(
  value: unknown
): StoredTelegramNotificationTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  const chatId = typeof value.chatId === "string" ? value.chatId.trim() : "";
  const chatType = typeof value.chatType === "string" ? value.chatType.trim() : "";
  const source = value.source;
  if (!chatId || !chatType) {
    return null;
  }
  if (source !== "telegram_dm" && source !== "telegram_group" && source !== "web_telegram_dm") {
    return null;
  }
  return {
    chatId,
    chatType,
    title: typeof value.title === "string" ? value.title.trim() || null : null,
    username: typeof value.username === "string" ? value.username.trim() || null : null,
    source,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
        ? value.updatedAt
        : new Date().toISOString()
  };
}

function resolveReminderTelegramTarget(metadata: Record<string, unknown>, sourceId: string) {
  const reminderTaskTargets = metadata.reminderTaskTargets;
  if (!isRecord(reminderTaskTargets)) {
    return null;
  }
  return normalizeTelegramNotificationTarget(reminderTaskTargets[sourceId]);
}

function resolveDefaultTelegramDmTarget(
  metadata: Record<string, unknown>
): StoredTelegramNotificationTarget | null {
  const dmChatId =
    typeof metadata.telegramDmChatId === "string" ? metadata.telegramDmChatId.trim() : "";
  if (dmChatId) {
    return {
      chatId: dmChatId,
      chatType: "private",
      title: null,
      username:
        typeof metadata.telegramDmUsername === "string"
          ? metadata.telegramDmUsername.trim() || null
          : null,
      source: "web_telegram_dm",
      updatedAt:
        typeof metadata.telegramDmUpdatedAt === "string" &&
        metadata.telegramDmUpdatedAt.trim().length > 0
          ? metadata.telegramDmUpdatedAt
          : new Date().toISOString()
    };
  }

  const legacyChatId =
    typeof metadata.reminderDeliveryChatId === "string"
      ? metadata.reminderDeliveryChatId.trim()
      : "";
  const legacyChatType =
    typeof metadata.reminderDeliveryChatType === "string"
      ? metadata.reminderDeliveryChatType.trim()
      : "";
  if (!legacyChatId || legacyChatType !== "private") {
    return null;
  }
  return {
    chatId: legacyChatId,
    chatType: "private",
    title: null,
    username:
      typeof metadata.reminderDeliveryUsername === "string"
        ? metadata.reminderDeliveryUsername.trim() || null
        : null,
    source: "web_telegram_dm",
    updatedAt:
      typeof metadata.reminderDeliveryUpdatedAt === "string" &&
      metadata.reminderDeliveryUpdatedAt.trim().length > 0
        ? metadata.reminderDeliveryUpdatedAt
        : new Date().toISOString()
  };
}

function stripReminderContextArtifact(value: string): string {
  const markerIndex = value.indexOf(REMINDER_CONTEXT_MARKER);
  if (markerIndex === -1) {
    return value.trim();
  }
  return value.slice(0, markerIndex).trim();
}

function parseTelegramMessageId(value: unknown): string | undefined {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.result)) {
    return undefined;
  }
  const messageId = value.result.message_id;
  return typeof messageId === "number" || typeof messageId === "string"
    ? String(messageId)
    : undefined;
}

@Injectable()
export class AssistantNotificationDeliveryService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly renderAssistantInboundSurfaceMessageService: RenderAssistantInboundSurfaceMessageService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async deliver(
    input: AssistantNotificationDeliveryInput
  ): Promise<AssistantNotificationDeliveryResult> {
    const assistant = await this.loadAssistant(input.assistantId);
    const rawText =
      input.source === "user_reminder" && input.text
        ? stripReminderContextArtifact(input.text)
        : input.text?.trim();
    if (input.status !== "ok" || !rawText) {
      return { target: "none" };
    }

    let text = rawText;
    try {
      const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
        input.assistantId
      );
      await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn({
        assistant: resolved.assistant,
        surface: "reminder_callback",
        isNewThread: false,
        activeSurfaceChatsCount: 0
      });
    } catch (error) {
      const failure = toAssistantInboundFailurePayload(error);
      text = this.renderAssistantInboundSurfaceMessageService.renderError(
        "reminder_callback",
        failure.code,
        failure.message
      ).text;
    }

    const preferred = assistant.preferredNotificationChannel;
    const hasExternalChannel =
      preferred !== "web" &&
      assistant.channelSurfaceBindings.some((binding) => binding.providerKey === preferred);

    if (preferred === "telegram") {
      const context = await this.resolveTelegramDeliveryContext({
        assistantId: assistant.id,
        source: input.source,
        sourceId: input.sourceId,
        bindings: assistant.channelSurfaceBindings
      });
      const telegramMessageId =
        context !== null &&
        (await this.tryDeliverNotificationToTelegram({
          text,
          context
        }));
      if (telegramMessageId !== false && context !== null) {
        let attachmentIds: string[] = [];
        if (input.artifacts && input.artifacts.length > 0) {
          const mediaResult = await this.persistAndDeliverMedia({
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            content: text,
            artifacts: input.artifacts,
            channel: "telegram",
            telegramContext: context
          });
          attachmentIds = mediaResult.attachmentIds;
        }
        return {
          target: "telegram",
          deliveredAt: new Date().toISOString(),
          chatId: context.target.chatId,
          ...(telegramMessageId === undefined ? {} : { messageId: telegramMessageId }),
          ...(attachmentIds.length === 0 ? {} : { attachmentIds })
        };
      }
    }

    const webResult = await this.deliverNotificationToWeb({
      assistantId: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      content: text,
      artifacts: input.artifacts ?? []
    });
    return {
      target: hasExternalChannel ? "fallback_web" : "web",
      deliveredAt: new Date().toISOString(),
      ...webResult
    };
  }

  private async loadAssistant(assistantId: string): Promise<NotificationAssistant> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        preferredNotificationChannel: true,
        channelSurfaceBindings: {
          where: {
            bindingState: "active",
            providerKey: { in: ["telegram", "whatsapp"] }
          },
          select: { providerKey: true, metadata: true }
        }
      }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return assistant;
  }

  private async resolveTelegramDeliveryContext(params: {
    assistantId: string;
    source: AssistantNotificationSource;
    sourceId: string;
    bindings: Array<{ providerKey: string; metadata: unknown }>;
  }): Promise<{ target: StoredTelegramNotificationTarget; botToken: string } | null> {
    const telegramBinding = params.bindings.find((binding) => binding.providerKey === "telegram");
    if (!telegramBinding) {
      return null;
    }

    const metadata = normalizeBindingMetadata(telegramBinding.metadata);
    const target =
      (params.source === "user_reminder"
        ? resolveReminderTelegramTarget(metadata, params.sourceId)
        : null) ?? resolveDefaultTelegramDmTarget(metadata);
    if (!target) {
      return null;
    }

    const botToken =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        `telegram_bot:${params.assistantId}`
      );
    if (!botToken) {
      return null;
    }
    return { target, botToken };
  }

  private async tryDeliverNotificationToTelegram(params: {
    text: string;
    context: { target: StoredTelegramNotificationTarget; botToken: string };
  }): Promise<string | undefined | false> {
    const response = await fetch(
      `https://api.telegram.org/bot${params.context.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.context.target.chatId,
          text: params.text
        })
      }
    ).catch(() => null);

    if (response?.ok !== true) {
      return false;
    }
    if (typeof response.json !== "function") {
      return undefined;
    }
    return parseTelegramMessageId(await response.json().catch(() => null));
  }

  private async persistAndDeliverMedia(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    content: string;
    artifacts: RuntimeOutputArtifact[];
    channel: "web" | "telegram";
    telegramContext?: { target: StoredTelegramNotificationTarget; botToken: string } | null;
  }): Promise<{ chatId: string; messageId: string; attachmentIds: string[] }> {
    const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
      assistantId: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      surface: "web",
      surfaceThreadKey: NOTIFICATION_WEB_CHAT_THREAD_KEY,
      title: NOTIFICATION_WEB_CHAT_TITLE
    });

    const message = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: params.assistantId,
      author: "assistant",
      content: params.content
    });

    const media = await this.mediaDeliveryService.deliver({
      artifacts: runtimeOutputArtifactsToMediaArtifacts(params.artifacts),
      channel: params.channel,
      assistantId: params.assistantId,
      chatId: chat.id,
      messageId: message.id,
      workspaceId: params.workspaceId,
      ...(params.channel === "telegram" && params.telegramContext
        ? {
            channelTarget: {
              channel: "telegram" as const,
              chatId: params.telegramContext.target.chatId,
              metadata: { botToken: params.telegramContext.botToken }
            }
          }
        : {})
    });
    return {
      chatId: chat.id,
      messageId: message.id,
      attachmentIds: media.attachments.map((attachment) => attachment.id)
    };
  }

  private async deliverNotificationToWeb(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    content: string;
    artifacts: RuntimeOutputArtifact[];
  }): Promise<{ chatId: string; messageId: string; attachmentIds?: string[] }> {
    const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
      assistantId: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      surface: "web",
      surfaceThreadKey: NOTIFICATION_WEB_CHAT_THREAD_KEY,
      title: NOTIFICATION_WEB_CHAT_TITLE
    });

    const message = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: params.assistantId,
      author: "assistant",
      content: params.content
    });

    if (params.artifacts.length === 0) {
      return { chatId: chat.id, messageId: message.id };
    }

    const media = await this.mediaDeliveryService.deliver({
      artifacts: runtimeOutputArtifactsToMediaArtifacts(params.artifacts),
      channel: "web",
      assistantId: params.assistantId,
      chatId: chat.id,
      messageId: message.id,
      workspaceId: params.workspaceId
    });
    return {
      chatId: chat.id,
      messageId: message.id,
      attachmentIds: media.attachments.map((attachment) => attachment.id)
    };
  }
}
