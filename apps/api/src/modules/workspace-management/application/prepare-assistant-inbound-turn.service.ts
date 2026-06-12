import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { Assistant } from "../domain/assistant.entity";
import type {
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState,
  AssistantWebChatState
} from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  type AssistantInboundSurface,
  toAssistantInboundAbuseSurface
} from "./assistant-inbound.types";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { MergeStagedWebChatAttachmentsService } from "./merge-staged-web-chat-attachments.service";
import type { AssistantInboundQuotaDegradeReason } from "./enforce-assistant-capability-and-quota.service";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import { AssistantUploadMicroDescriptionJobService } from "./assistant-upload-micro-description-job.service";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import type { RuntimeTier } from "./runtime-assignment";
import type { AssistantChatMode } from "../domain/assistant-chat.entity";
import { getAttachmentDerivativeRefs } from "./media/media.types";
import {
  chatModeToDeepModeEnabled,
  isElevatedAssistantChatMode,
  normalizeAssistantChatModeForPaidLightMode
} from "../domain/assistant-chat.entity";

export interface PrepareAssistantInboundTurnInput {
  userId: string;
  surface: AssistantInboundSurface;
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
  chatMode?: AssistantChatMode;
  deepModeEnabled?: boolean;
  clientTurnId?: string;
}

export interface PreparedAssistantInboundTurn {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  quotaDegradeModelOverride: { provider: "openai" | "anthropic"; model: string } | null;
  quotaDegradeReason: AssistantInboundQuotaDegradeReason | null;
  welcomeFirstTurnPrompt: string | null;
  userId: string;
  workspaceId: string;
  workspaceTimezone: string;
}

@Injectable()
export class PrepareAssistantInboundTurnService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly mergeStagedWebChatAttachmentsService: MergeStagedWebChatAttachmentsService,
    private readonly assistantUploadMicroDescriptionJobService: AssistantUploadMicroDescriptionJobService,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository
  ) {}

  async execute(input: PrepareAssistantInboundTurnInput): Promise<PreparedAssistantInboundTurn> {
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByUserId(
      input.userId
    );
    const assistant = resolved.assistant;

    const existingChat = await this.assistantChatRepository.findChatBySurfaceThread(
      assistant.id,
      "web",
      input.surfaceThreadKey
    );
    const activeChatsCount =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );

    const quotaDecision = await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn({
      assistant,
      surface: input.surface,
      isNewThread: existingChat === null,
      activeSurfaceChatsCount: activeChatsCount
    });
    const abuseSurface = toAssistantInboundAbuseSurface(input.surface);
    if (abuseSurface !== null) {
      await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
        assistant,
        surface: abuseSurface
      });
    }

    const requestedMode: AssistantChatMode | undefined =
      input.chatMode ??
      (input.deepModeEnabled === undefined
        ? undefined
        : input.deepModeEnabled
          ? "smart"
          : "normal");
    const paidLightModeActive = quotaDecision.mode === "degrade_allowed";
    const normalizedRequestedMode = normalizeAssistantChatModeForPaidLightMode(
      requestedMode,
      paidLightModeActive
    );
    const requestedDeepModeEnabled =
      normalizedRequestedMode === undefined
        ? paidLightModeActive
          ? false
          : input.deepModeEnabled
        : chatModeToDeepModeEnabled(normalizedRequestedMode);

    const chat =
      existingChat !== null
        ? input.surface === "web_chat" &&
          ((normalizedRequestedMode !== undefined &&
            existingChat.chatMode !== normalizedRequestedMode) ||
            (requestedDeepModeEnabled !== undefined &&
              existingChat.deepModeEnabled !== requestedDeepModeEnabled) ||
            (paidLightModeActive && isElevatedAssistantChatMode(existingChat.chatMode)))
          ? await this.assistantChatRepository
              .updateChat(existingChat.id, {
                ...(normalizedRequestedMode === undefined
                  ? paidLightModeActive
                    ? { chatMode: "normal" as const, deepModeEnabled: false }
                    : {}
                  : { chatMode: normalizedRequestedMode }),
                ...(requestedDeepModeEnabled === undefined
                  ? paidLightModeActive
                    ? { deepModeEnabled: false }
                    : {}
                  : { deepModeEnabled: requestedDeepModeEnabled })
              })
              .then((updated) => updated ?? existingChat)
          : existingChat
        : await this.reserveWebChatUnderCap({
            assistant,
            surfaceThreadKey: input.surfaceThreadKey,
            title: input.title ?? (input.message.trim().slice(0, 50).replace(/\s+/g, " ") || null),
            ...(normalizedRequestedMode === undefined ? {} : { chatMode: normalizedRequestedMode }),
            deepModeEnabled: requestedDeepModeEnabled ?? false
          });

    if (input.surface === "web_chat") {
      await this.deleteStaleWebRuntimeThreadState({
        assistantId: assistant.id,
        surfaceThreadKey: chat.surfaceThreadKey,
        chatCreatedAt: chat.createdAt
      });
    }

    await this.enforceMessagesPerChatLimit({ assistant, chatId: chat.id });

    const userMessage = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: assistant.id,
      author: "user",
      content: input.message
    });

    if (input.surface === "web_chat") {
      await this.mergeStagedWebChatAttachmentsService.mergeIntoUserMessage({
        chatId: chat.id,
        assistantId: assistant.id,
        userMessageId: userMessage.id,
        userMessageCreatedAt: userMessage.createdAt,
        clientTurnId: input.clientTurnId ?? null
      });
    }

    const userAttachments = await this.attachmentRepository.listByMessageId(userMessage.id);
    await Promise.all(
      userAttachments.map((attachment) =>
        this.assistantUploadMicroDescriptionJobService.enqueueIfNeeded({
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          chatMode: chat.chatMode,
          attachmentId: attachment.id,
          assistantFileId: attachment.assistantFileId
        })
      )
    );
    const attachmentStates: AssistantWebChatMessageAttachmentState[] = userAttachments.map((a) => ({
      ...(() => {
        const refs = getAttachmentDerivativeRefs(
          a.metadata !== null && typeof a.metadata === "object" && !Array.isArray(a.metadata)
            ? (a.metadata as Record<string, unknown>)
            : null
        );
        return {
          ...(refs.thumbnailFileRef !== null ? { thumbnailFileRef: refs.thumbnailFileRef } : {}),
          ...(refs.posterFileRef !== null ? { posterFileRef: refs.posterFileRef } : {}),
          ...(refs.derivativesStatus !== null ? { derivativesStatus: refs.derivativesStatus } : {})
        };
      })(),
      id: a.id,
      fileRef: a.assistantFileId,
      attachmentType: a.attachmentType,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      processingStatus: a.processingStatus,
      ...(a.metadata?.fileDeleted === true ? { fileDeleted: true } : {}),
      createdAt: a.createdAt.toISOString()
    }));

    const activeWebChatsCurrent =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_turn_prepare"
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: assistant.workspaceId },
      select: { timezone: true }
    });
    if (workspace === null) {
      throw new NotFoundException("Workspace does not exist for this assistant.");
    }

    return {
      chat: {
        id: chat.id,
        assistantId: chat.assistantId,
        surface: chat.surface,
        surfaceThreadKey: chat.surfaceThreadKey,
        title: chat.title,
        chatMode: chat.chatMode,
        deepModeEnabled: chat.deepModeEnabled,
        skillDecisionState: chat.skillDecisionState,
        skillCadenceState: chat.skillCadenceState,
        archivedAt: chat.archivedAt?.toISOString() ?? null,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString()
      },
      userMessage: {
        id: userMessage.id,
        chatId: userMessage.chatId,
        assistantId: userMessage.assistantId,
        author: userMessage.author,
        content: userMessage.content,
        attachments: attachmentStates,
        createdAt: userMessage.createdAt.toISOString()
      },
      assistant,
      assistantId: assistant.id,
      publishedVersionId: resolved.publishedVersionId,
      runtimeTier: resolved.runtimeTier,
      quotaDegradeModelOverride:
        quotaDecision.mode === "degrade_allowed" ? resolved.quotaDegradeModelOverride : null,
      quotaDegradeReason: quotaDecision.mode === "degrade_allowed" ? quotaDecision.reason : null,
      welcomeFirstTurnPrompt: resolved.welcomeFirstTurnPrompt,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      workspaceTimezone: workspace.timezone
    };
  }

  private async reserveWebChatUnderCap(params: {
    assistant: Assistant;
    surfaceThreadKey: string;
    title: string | null;
    chatMode?: AssistantChatMode;
    deepModeEnabled: boolean;
  }) {
    const activeWebChatsLimit =
      await this.trackWorkspaceQuotaUsageService.resolveActiveWebChatsLimit(params.assistant);
    const result = await this.assistantChatRepository.getOrCreateWebChatBySurfaceThreadUnderCap({
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      workspaceId: params.assistant.workspaceId,
      surface: "web",
      surfaceThreadKey: params.surfaceThreadKey,
      title: params.title,
      ...(params.chatMode === undefined ? {} : { chatMode: params.chatMode }),
      deepModeEnabled: params.deepModeEnabled,
      activeWebChatsLimit
    });

    if (result.outcome === "cap_reached") {
      throw createAssistantInboundConflict(
        "active_chat_cap_reached",
        `Active web chats cap reached (${result.limit}). Archive an existing chat or continue in an existing thread.`,
        { limit: result.limit }
      );
    }

    return result.chat;
  }

  private async enforceMessagesPerChatLimit(params: {
    assistant: Assistant;
    chatId: string;
  }): Promise<void> {
    const messagesPerChatLimit =
      await this.trackWorkspaceQuotaUsageService.resolveMessagesPerChatLimit(params.assistant);
    if (messagesPerChatLimit === null || messagesPerChatLimit <= 0) {
      return;
    }
    const metadata = await this.assistantChatRepository.getChatListMetadata(params.chatId);
    if (metadata.messageCount < messagesPerChatLimit) {
      return;
    }
    throw createAssistantInboundConflict(
      "chat_message_limit_reached",
      `This chat reached its message limit (${messagesPerChatLimit}). Continue in a new chat or upgrade for longer conversations.`,
      { limit: messagesPerChatLimit }
    );
  }

  private async deleteStaleWebRuntimeThreadState(params: {
    assistantId: string;
    surfaceThreadKey: string;
    chatCreatedAt: Date;
  }): Promise<void> {
    const sessions = await this.prisma.runtimeSession.findMany({
      where: {
        assistantId: params.assistantId,
        channel: "web",
        externalThreadKey: params.surfaceThreadKey,
        createdAt: { lt: params.chatCreatedAt }
      },
      select: { id: true }
    });
    const sessionIds = sessions.map((session) => session.id);
    if (sessionIds.length === 0) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.runtimeTurnReceipt.deleteMany({
        where: {
          assistantId: params.assistantId,
          channel: "web",
          externalThreadKey: params.surfaceThreadKey
        }
      }),
      this.prisma.runtimeSessionCompaction.deleteMany({
        where: {
          runtimeSessionId: { in: sessionIds },
          assistantId: params.assistantId
        }
      }),
      this.prisma.runtimeSession.deleteMany({
        where: {
          id: { in: sessionIds },
          assistantId: params.assistantId,
          channel: "web",
          externalThreadKey: params.surfaceThreadKey
        }
      })
    ]);
  }
}
