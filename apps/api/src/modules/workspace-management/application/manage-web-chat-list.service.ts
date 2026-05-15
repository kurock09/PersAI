import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { RuntimeSharedCompactionConfig } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import type {
  AssistantChatSkillCadenceState,
  AssistantChatSkillDecisionState
} from "../domain/assistant-chat.entity";
import type { Assistant } from "../domain/assistant.entity";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { AssistantRuntimeError } from "./assistant-runtime.facade";
import { CompactNativeWebChatSessionService } from "./compact-native-web-chat-session.service";
import { ResolveNativeWebChatSessionStateService } from "./resolve-native-web-chat-session-state.service";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import type {
  AssistantWebChatActiveTurnState,
  AssistantWebChatActiveDocumentJobState,
  AssistantWebChatActiveMediaJobState,
  AssistantWebChatCompactionResult,
  AssistantWebChatCompactionState,
  AssistantWebChatListItemState,
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState
} from "./web-chat.types";
import { AssistantMediaJobService } from "./assistant-media-job.service";
import { AssistantDocumentJobReadService } from "./assistant-document-job-read.service";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  countRecentAutoCompactionStreak,
  isCompactionExhaustedAtPlanLimit,
  isLatestAutoCompactionWeak
} from "./compaction-advisory-state";

export interface UpdateWebChatRequest {
  title?: string | null;
  deepModeEnabled?: boolean;
}

export interface DeleteWebChatRequest {
  confirmText: string;
}

type EffectiveSharedCompactionConfig = Pick<
  RuntimeSharedCompactionConfig,
  "reserveTokens" | "keepRecentTokens" | "recentTurnsPreserve"
> & {
  autoCompactionEnabled: boolean;
};

function toChatState(chat: {
  id: string;
  assistantId: string;
  surface: "web" | "telegram";
  surfaceThreadKey: string;
  title: string | null;
  deepModeEnabled: boolean;
  skillDecisionState: AssistantChatSkillDecisionState | null;
  skillCadenceState: AssistantChatSkillCadenceState | null;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AssistantWebChatListItemState["chat"] {
  return {
    id: chat.id,
    assistantId: chat.assistantId,
    surface: chat.surface,
    surfaceThreadKey: chat.surfaceThreadKey,
    title: chat.title,
    deepModeEnabled: chat.deepModeEnabled,
    skillDecisionState: chat.skillDecisionState,
    skillCadenceState: chat.skillCadenceState,
    archivedAt: chat.archivedAt?.toISOString() ?? null,
    lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString()
  };
}

@Injectable()
export class ManageWebChatListService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly compactNativeWebChatSessionService: CompactNativeWebChatSessionService,
    private readonly resolveNativeWebChatSessionStateService: ResolveNativeWebChatSessionStateService,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly assistantDocumentJobReadService: AssistantDocumentJobReadService,
    private readonly webChatTurnAttemptService: WebChatTurnAttemptService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseUpdateInput(payload: unknown): UpdateWebChatRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Chat update payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const output: UpdateWebChatRequest = {};

    if ("title" in body) {
      const title = body.title;
      if (title === null) {
        output.title = null;
      } else if (typeof title !== "string") {
        throw new BadRequestException("title must be a string or null.");
      } else {
        const normalized = title.trim();
        if (normalized.length === 0) {
          throw new BadRequestException("title must be non-empty when provided as string.");
        }
        output.title = normalized;
      }
    }

    if ("deepModeEnabled" in body) {
      if (typeof body.deepModeEnabled !== "boolean") {
        throw new BadRequestException("deepModeEnabled must be boolean.");
      }
      output.deepModeEnabled = body.deepModeEnabled;
    }

    if (Object.keys(output).length === 0) {
      throw new BadRequestException("At least one chat update field is required.");
    }

    return output;
  }

  parseDeleteInput(payload: unknown): DeleteWebChatRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Delete payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const confirmText = body.confirmText;
    if (typeof confirmText !== "string") {
      throw new BadRequestException("confirmText must be a string.");
    }

    return {
      confirmText: confirmText.trim()
    };
  }

  async listChats(userId: string): Promise<AssistantWebChatListItemState[]> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chats = await this.assistantChatRepository.listChatsByAssistantId(assistant.id);
    const webChats = chats.filter((chat) => chat.surface === "web");

    const items = await Promise.all(
      webChats.map(async (chat) => {
        const metadata = await this.assistantChatRepository.getChatListMetadata(chat.id);
        return {
          chat: toChatState(chat),
          messageCount: metadata.messageCount,
          lastMessagePreview: metadata.lastMessagePreview,
          activeTurn: await this.getCompactActiveTurn({
            assistantId: assistant.id,
            userId,
            chatId: chat.id
          }),
          activeMediaJobs: await this.assistantMediaJobService.listOpenJobsForWebChat({
            assistantId: assistant.id,
            userId,
            chatId: chat.id
          }),
          activeDocumentJobs: await this.assistantDocumentJobReadService.listOpenJobsForWebChat({
            assistantId: assistant.id,
            userId,
            chatId: chat.id
          })
        };
      })
    );

    return items;
  }

  async updateChat(
    userId: string,
    chatId: string,
    request: UpdateWebChatRequest
  ): Promise<AssistantWebChatListItemState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const updated = await this.assistantChatRepository.updateChat(chatId, request);
    if (updated === null) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const metadata = await this.assistantChatRepository.getChatListMetadata(chatId);
    const activeTurn = await this.getCompactActiveTurn({
      assistantId: assistant.id,
      userId,
      chatId
    });
    return {
      chat: toChatState(updated),
      messageCount: metadata.messageCount,
      lastMessagePreview: metadata.lastMessagePreview,
      activeTurn,
      activeMediaJobs: await this.assistantMediaJobService.listOpenJobsForWebChat({
        assistantId: assistant.id,
        userId,
        chatId
      }),
      activeDocumentJobs: await this.assistantDocumentJobReadService.listOpenJobsForWebChat({
        assistantId: assistant.id,
        userId,
        chatId
      })
    };
  }

  async archiveChat(userId: string, chatId: string): Promise<AssistantWebChatListItemState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const archived = await this.assistantChatRepository.archiveChat(chatId);
    if (archived === null) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }
    const activeWebChatsCurrent =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_archive"
    });

    const metadata = await this.assistantChatRepository.getChatListMetadata(chatId);
    return {
      chat: toChatState(archived),
      messageCount: metadata.messageCount,
      lastMessagePreview: metadata.lastMessagePreview,
      activeTurn: null,
      activeMediaJobs: [],
      activeDocumentJobs: []
    };
  }

  async listChatMessages(
    userId: string,
    chatId: string,
    pagination: { cursor: string | null; limit: number }
  ): Promise<{
    messages: AssistantWebChatMessageState[];
    nextCursor: string | null;
    activeTurn: AssistantWebChatActiveTurnState | null;
    activeMediaJobs: AssistantWebChatActiveMediaJobState[];
    activeDocumentJobs: AssistantWebChatActiveDocumentJobState[];
  }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const allMessages = await this.assistantChatRepository.listMessagesByChatId(chatId);
    const messageIds = allMessages.map((m) => m.id);
    const allAttachments = await this.attachmentRepository.listByMessageIds(messageIds);
    const attachmentsByMessageId = new Map<string, AssistantWebChatMessageAttachmentState[]>();
    for (const att of allAttachments) {
      const list = attachmentsByMessageId.get(att.messageId) ?? [];
      list.push({
        id: att.id,
        fileRef: att.assistantFileId,
        attachmentType: att.attachmentType,
        originalFilename: att.originalFilename,
        mimeType: att.mimeType,
        sizeBytes: Number(att.sizeBytes),
        processingStatus: att.processingStatus,
        ...(att.metadata?.fileDeleted === true ? { fileDeleted: true } : {}),
        createdAt: att.createdAt.toISOString()
      });
      attachmentsByMessageId.set(att.messageId, list);
    }

    const mapped: AssistantWebChatMessageState[] = allMessages.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      assistantId: m.assistantId,
      author: m.author,
      content: m.content,
      attachments: attachmentsByMessageId.get(m.id) ?? [],
      createdAt: m.createdAt.toISOString()
    }));

    // Reverse pagination: newest first. No cursor = last N; cursor = N older than cursor.
    let endIndex = mapped.length;
    if (pagination.cursor) {
      const cursorIndex = mapped.findIndex((m) => m.id === pagination.cursor);
      if (cursorIndex >= 0) {
        endIndex = cursorIndex;
      }
    }

    const startIndex = Math.max(0, endIndex - pagination.limit);
    const page = mapped.slice(startIndex, endIndex);
    const nextCursor = startIndex > 0 && page.length > 0 ? page[0]!.id : null;

    const activeTurn = await this.webChatTurnAttemptService.getActiveTurnForChat({
      assistantId: assistant.id,
      userId,
      chatId
    });
    const activeMediaJobs = await this.assistantMediaJobService.listOpenJobsForWebChat({
      assistantId: assistant.id,
      userId,
      chatId
    });
    const activeDocumentJobs = await this.assistantDocumentJobReadService.listOpenJobsForWebChat({
      assistantId: assistant.id,
      userId,
      chatId
    });

    return { messages: page, nextCursor, activeTurn, activeMediaJobs, activeDocumentJobs };
  }

  private async getCompactActiveTurn(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<AssistantWebChatListItemState["activeTurn"]> {
    const activeTurn = await this.webChatTurnAttemptService.getActiveTurnForChat(input);
    if (activeTurn === null) {
      return null;
    }
    return {
      clientTurnId: activeTurn.clientTurnId,
      status: activeTurn.status,
      updatedAt: activeTurn.updatedAt,
      currentActivity: activeTurn.currentActivity,
      pendingUserMessageId: activeTurn.pendingUserMessageId,
      assistantMessageId: activeTurn.assistantMessageId
    };
  }

  async getChatCompactionState(
    userId: string,
    chatId: string
  ): Promise<AssistantWebChatCompactionState> {
    const { assistant, chat, messageCount, assistantMessageCount } =
      await this.resolveOwnedWebChatWithStats(userId, chatId);
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );
    const [runtimeSessionState, compactionConfig] = await Promise.all([
      this.resolveNativeWebChatSessionStateService.execute({
        assistantId: assistant.id,
        runtimeTier,
        workspaceId: assistant.workspaceId,
        surfaceThreadKey: chat.surfaceThreadKey,
        userId
      }),
      this.resolveEffectiveSharedCompactionConfig(assistant)
    ]);
    const sessionId = runtimeSessionState.session?.sessionId ?? null;
    const [recentAutoCompactionStreak, latestAutoCompactionWeak] = await Promise.all([
      this.readRecentAutoCompactionStreak(sessionId),
      this.readLatestAutoCompactionWeak({ sessionId })
    ]);
    return this.buildCompactionState({
      messageCount,
      assistantMessageCount,
      currentTokens: runtimeSessionState.session?.currentTokens ?? null,
      available: runtimeSessionState.found && runtimeSessionState.session !== null,
      sessionKey: null,
      compactionCount: runtimeSessionState.session?.compactionCount ?? 0,
      updatedAt: runtimeSessionState.session?.updatedAt ?? null,
      compactionConfig,
      totalTokensFresh: runtimeSessionState.session?.totalTokensFresh === true,
      recentAutoCompactionStreak,
      latestAutoCompactionWeak
    });
  }

  async compactChat(
    userId: string,
    chatId: string,
    instructions?: string
  ): Promise<{ state: AssistantWebChatCompactionState; result: AssistantWebChatCompactionResult }> {
    const { assistant, chat, messageCount, assistantMessageCount } =
      await this.resolveOwnedWebChatWithStats(userId, chatId);
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );
    const result = await this.compactNativeWebChatSessionService.execute({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      runtimeTier,
      surfaceThreadKey: chat.surfaceThreadKey,
      userId,
      ...(instructions ? { instructions } : {})
    });
    if (!result.compacted && this.isCompactionUnavailableReason(result.reason)) {
      throw this.createCompactionUnavailableError();
    }
    const compactionConfig = await this.resolveEffectiveSharedCompactionConfig(assistant);
    const sessionId = result.session?.sessionId ?? null;
    const [recentAutoCompactionStreak, latestAutoCompactionWeak] = await Promise.all([
      this.readRecentAutoCompactionStreak(sessionId),
      this.readLatestAutoCompactionWeak({ sessionId })
    ]);
    const state = this.buildCompactionState({
      messageCount,
      assistantMessageCount,
      currentTokens: result.session?.currentTokens ?? null,
      available: result.session !== null,
      sessionKey: null,
      compactionCount: result.session?.compactionCount ?? 0,
      updatedAt: result.session?.updatedAt ?? null,
      compactionConfig,
      totalTokensFresh: result.session?.totalTokensFresh === true,
      recentAutoCompactionStreak,
      latestAutoCompactionWeak,
      forceSuggestedFalse:
        result.compacted ||
        result.reason === "threshold_not_reached" ||
        result.reason === "nothing_to_compact"
    });
    return {
      state,
      result: {
        compacted: result.compacted,
        reason: null,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter
      }
    };
  }

  async hardDeleteChat(
    userId: string,
    chatId: string,
    request: DeleteWebChatRequest
  ): Promise<void> {
    if (request.confirmText !== "DELETE") {
      throw new BadRequestException("confirmText must equal DELETE for hard delete.");
    }

    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const attachments = await this.attachmentRepository.listByChatId(chat.id);
    const releasedBytes = attachments.reduce(
      (sum, attachment) => sum + attachment.sizeBytes,
      BigInt(0)
    );
    await this.mediaObjectStorage.deletePrefix(
      this.mediaObjectStorage.buildChatPrefix({
        assistantId: assistant.id,
        chatId: chat.id
      })
    );
    await this.attachmentRepository.deleteByChatId(chat.id);
    await this.trackWorkspaceQuotaUsageService.releaseMediaStorage({
      assistant,
      sizeBytes: releasedBytes,
      source: "web_chat_hard_delete_media_cleanup",
      metadata: { chatId: chat.id }
    });

    const deleted = await this.assistantChatRepository.hardDeleteChat(chatId, assistant.id);
    if (!deleted) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }
    const activeWebChatsCurrent =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_hard_delete"
    });
  }

  private async resolveOwnedWebChatWithStats(
    userId: string,
    chatId: string
  ): Promise<{
    assistant: NonNullable<Awaited<ReturnType<AssistantRepository["findByUserId"]>>>;
    chat: NonNullable<Awaited<ReturnType<AssistantChatRepository["findChatById"]>>>;
    messageCount: number;
    assistantMessageCount: number;
  }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const messages = await this.assistantChatRepository.listMessagesByChatId(chatId);
    return {
      assistant,
      chat,
      messageCount: messages.length,
      assistantMessageCount: messages.filter((message) => message.author === "assistant").length
    };
  }

  private buildCompactionState(input: {
    messageCount: number;
    assistantMessageCount: number;
    currentTokens: number | null;
    available: boolean;
    sessionKey: string | null;
    compactionCount: number;
    updatedAt: string | null;
    compactionConfig: EffectiveSharedCompactionConfig;
    totalTokensFresh: boolean;
    recentAutoCompactionStreak: number;
    latestAutoCompactionWeak: boolean;
    forceSuggestedFalse?: boolean;
  }): AssistantWebChatCompactionState {
    const tokenThreshold = Math.max(
      1,
      input.compactionConfig.reserveTokens - input.compactionConfig.keepRecentTokens
    );
    const tokenSuggested = input.currentTokens !== null && input.currentTokens >= tokenThreshold;
    const suggestionReason = input.forceSuggestedFalse
      ? null
      : tokenSuggested
        ? "token_threshold"
        : null;
    return {
      available: input.available,
      suggested: suggestionReason !== null,
      suggestionReason,
      exhaustedAtPlanLimit: isCompactionExhaustedAtPlanLimit({
        currentTokens: input.currentTokens,
        totalTokensFresh: input.totalTokensFresh,
        reserveTokens: input.compactionConfig.reserveTokens,
        autoCompactionEnabled: input.compactionConfig.autoCompactionEnabled,
        recentAutoCompactionStreak: input.recentAutoCompactionStreak,
        latestAutoCompactionWeak: input.latestAutoCompactionWeak
      }),
      recentAutoCompactionStreak: input.recentAutoCompactionStreak,
      messageCount: input.messageCount,
      assistantMessageCount: input.assistantMessageCount,
      currentTokens: input.currentTokens,
      sessionKey: input.sessionKey,
      compactionCount: input.compactionCount,
      lastCompactedAt: input.compactionCount > 0 ? input.updatedAt : null,
      reserveTokens: input.compactionConfig.reserveTokens,
      keepRecentTokens: input.compactionConfig.keepRecentTokens,
      autoCompactionEnabled: input.compactionConfig.autoCompactionEnabled
    };
  }

  private async readRecentAutoCompactionStreak(sessionId: string | null): Promise<number> {
    if (sessionId === null) {
      return 0;
    }
    const rows = await this.prisma.runtimeSessionCompaction.findMany({
      where: {
        runtimeSessionId: sessionId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
      select: { reason: true }
    });
    return countRecentAutoCompactionStreak(rows);
  }

  private async readLatestAutoCompactionWeak(input: {
    sessionId: string | null;
  }): Promise<boolean> {
    if (input.sessionId === null) {
      return false;
    }
    const session = await this.prisma.runtimeSession.findUnique({
      where: {
        id: input.sessionId
      },
      select: {
        currentTokens: true,
        compactionHintTokens: true,
        totalTokensFresh: true
      }
    });
    if (session === null) {
      return false;
    }
    return isLatestAutoCompactionWeak({
      latestCompactionBaselineTokens: session.compactionHintTokens,
      currentTokens: session.currentTokens,
      totalTokensFresh: session.totalTokensFresh
    });
  }

  private async resolveEffectiveSharedCompactionConfig(
    assistant: Assistant
  ): Promise<EffectiveSharedCompactionConfig> {
    const materializedSpec =
      await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (materializedSpec === null) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Assistant materialized runtime bundle is missing for shared compaction."
      );
    }

    const sharedCompaction = this.readEffectiveSharedCompactionConfig(
      materializedSpec.runtimeBundle ?? materializedSpec.runtimeBundleDocument
    );
    if (sharedCompaction === null) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Assistant materialized runtime bundle shared compaction config is invalid."
      );
    }

    return sharedCompaction;
  }

  private readEffectiveSharedCompactionConfig(
    runtimeBundle: unknown
  ): EffectiveSharedCompactionConfig | null {
    const bundle = this.readRuntimeBundle(runtimeBundle);
    const runtime = this.asObject(bundle?.runtime);
    const sharedCompaction = this.asObject(runtime?.sharedCompaction);
    const contextHydration = this.asObject(runtime?.contextHydration);
    const reserveTokens = this.asInteger(sharedCompaction?.reserveTokens);
    const keepRecentTokens = this.asInteger(sharedCompaction?.keepRecentTokens);
    const recentTurnsPreserve = this.asInteger(sharedCompaction?.recentTurnsPreserve);
    const autoCompactionEnabled = contextHydration?.autoCompactionWeb;
    if (
      reserveTokens === null ||
      keepRecentTokens === null ||
      recentTurnsPreserve === null ||
      typeof autoCompactionEnabled !== "boolean"
    ) {
      return null;
    }
    return {
      reserveTokens,
      keepRecentTokens,
      recentTurnsPreserve,
      autoCompactionEnabled
    };
  }

  private readRuntimeBundle(value: unknown): Record<string, unknown> | null {
    const direct = this.asObject(value);
    if (direct !== null) {
      return direct;
    }

    if (typeof value !== "string") {
      return null;
    }

    try {
      return this.asObject(JSON.parse(value));
    } catch {
      return null;
    }
  }

  private isCompactionUnavailableReason(reason: string | null): boolean {
    return (
      reason === "session_not_found" ||
      reason === "session_busy" ||
      reason === "runtime_bundle_missing"
    );
  }

  private createCompactionUnavailableError(): AssistantRuntimeError {
    return new AssistantRuntimeError(
      "compaction_unavailable",
      'Context compaction could not finish. Send a normal message in this thread, wait for a reply, then try "Compress now" again.'
    );
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asInteger(value: unknown): number | null {
    return Number.isInteger(value) ? (value as number) : null;
  }
}
