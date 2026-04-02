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
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
export interface PrepareAssistantInboundTurnInput {
  userId: string;
  surface: AssistantInboundSurface;
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
}

export interface PreparedAssistantInboundTurn {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
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

    await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn({
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

    const chat =
      existingChat ??
      (await this.assistantChatRepository.createChat({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        surface: "web",
        surfaceThreadKey: input.surfaceThreadKey,
        title: input.title ?? (input.message.trim().slice(0, 50).replace(/\s+/g, " ") || null)
      }));

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
        userMessageCreatedAt: userMessage.createdAt
      });
    }

    const userAttachments = await this.attachmentRepository.listByMessageId(userMessage.id);
    const attachmentStates: AssistantWebChatMessageAttachmentState[] = userAttachments.map((a) => ({
      id: a.id,
      attachmentType: a.attachmentType,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      processingStatus: a.processingStatus,
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
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      workspaceTimezone: workspace.timezone
    };
  }
}
