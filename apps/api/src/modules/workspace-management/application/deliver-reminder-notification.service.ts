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

const REMINDER_WEB_CHAT_THREAD_KEY = "system:reminders";
const REMINDER_WEB_CHAT_TITLE = "Reminders";
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

type StoredTelegramReminderTarget = {
  chatId: string;
  chatType: string;
  title: string | null;
  username: string | null;
  source: "telegram_dm" | "telegram_group" | "web_telegram_dm";
  updatedAt: string;
};

type ReminderNotificationAssistant = {
  id: string;
  userId: string;
  workspaceId: string;
  preferredNotificationChannel: string;
  channelSurfaceBindings: Array<{ providerKey: string; metadata: unknown }>;
};

export type ReminderDeliveryTarget = "telegram" | "web" | "fallback_web" | "none";

export type ReminderNotificationDeliveryInput = {
  assistantId: string;
  jobId: string;
  status: "ok" | "error" | "skipped";
  summary?: string;
  artifacts?: RuntimeOutputArtifact[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBindingMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeTelegramReminderTarget(value: unknown): StoredTelegramReminderTarget | null {
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

function resolveTaskTelegramTarget(metadata: Record<string, unknown>, jobId: string) {
  const reminderTaskTargets = metadata.reminderTaskTargets;
  if (!isRecord(reminderTaskTargets)) {
    return null;
  }
  return normalizeTelegramReminderTarget(reminderTaskTargets[jobId]);
}

function resolveDefaultTelegramDmTarget(
  metadata: Record<string, unknown>
): StoredTelegramReminderTarget | null {
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

@Injectable()
export class DeliverReminderNotificationService {
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

  async execute(input: ReminderNotificationDeliveryInput): Promise<ReminderDeliveryTarget> {
    const assistant = await this.loadAssistant(input.assistantId);
    const rawSummary = input.summary ? stripReminderContextArtifact(input.summary) : undefined;
    if (input.status !== "ok" || !rawSummary) {
      return "none";
    }

    let summary = rawSummary;
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
      summary = this.renderAssistantInboundSurfaceMessageService.renderError(
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
        jobId: input.jobId,
        bindings: assistant.channelSurfaceBindings
      });
      const delivered =
        context !== null &&
        (await this.tryDeliverReminderToTelegram({
          summary,
          context
        }));
      if (delivered) {
        if (input.artifacts && input.artifacts.length > 0) {
          await this.persistAndDeliverMedia({
            assistantId: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId,
            content: summary,
            artifacts: input.artifacts,
            channel: "telegram",
            telegramContext: context
          });
        }
        return "telegram";
      }
    }

    const deliveredTo = hasExternalChannel ? "fallback_web" : "web";
    await this.deliverReminderToWeb({
      assistantId: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      content: summary,
      artifacts: input.artifacts ?? []
    });
    return deliveredTo;
  }

  private async loadAssistant(assistantId: string): Promise<ReminderNotificationAssistant> {
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
    jobId: string;
    bindings: Array<{ providerKey: string; metadata: unknown }>;
  }): Promise<{ target: StoredTelegramReminderTarget; botToken: string } | null> {
    const telegramBinding = params.bindings.find((binding) => binding.providerKey === "telegram");
    if (!telegramBinding) {
      return null;
    }

    const metadata = normalizeBindingMetadata(telegramBinding.metadata);
    const target =
      resolveTaskTelegramTarget(metadata, params.jobId) ?? resolveDefaultTelegramDmTarget(metadata);
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

  private async tryDeliverReminderToTelegram(params: {
    summary: string;
    context: { target: StoredTelegramReminderTarget; botToken: string };
  }): Promise<boolean> {
    const response = await fetch(
      `https://api.telegram.org/bot${params.context.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.context.target.chatId,
          text: params.summary
        })
      }
    ).catch(() => null);

    return response?.ok === true;
  }

  private async persistAndDeliverMedia(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    content: string;
    artifacts: RuntimeOutputArtifact[];
    channel: "web" | "telegram";
    telegramContext?: { target: StoredTelegramReminderTarget; botToken: string } | null;
  }): Promise<void> {
    if (params.artifacts.length === 0) {
      return;
    }
    const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
      assistantId: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      surface: "web",
      surfaceThreadKey: REMINDER_WEB_CHAT_THREAD_KEY,
      title: REMINDER_WEB_CHAT_TITLE
    });

    const message = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: params.assistantId,
      author: "assistant",
      content: params.content
    });

    await this.mediaDeliveryService.deliver({
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
  }

  private async deliverReminderToWeb(params: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    content: string;
    artifacts: RuntimeOutputArtifact[];
  }): Promise<void> {
    const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
      assistantId: params.assistantId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      surface: "web",
      surfaceThreadKey: REMINDER_WEB_CHAT_THREAD_KEY,
      title: REMINDER_WEB_CHAT_TITLE
    });

    const message = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: params.assistantId,
      author: "assistant",
      content: params.content
    });

    if (params.artifacts.length > 0) {
      await this.mediaDeliveryService.deliver({
        artifacts: runtimeOutputArtifactsToMediaArtifacts(params.artifacts),
        channel: "web",
        assistantId: params.assistantId,
        chatId: chat.id,
        messageId: message.id,
        workspaceId: params.workspaceId
      });
    }
  }
}
