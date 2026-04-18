import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RuntimeTurnAutoCompactionState } from "@persai/runtime-contract";
import { type RuntimeMediaArtifact } from "./assistant-runtime.facade";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { InboundMediaService } from "./media/inbound-media.service";
import { toRuntimeAttachmentRef, type RawInboundAttachment } from "./media/media.types";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import { SendNativeTelegramTurnService } from "./send-native-telegram-turn.service";

export interface InternalTelegramTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
  assistantMessageId: string;
  chatId: string;
  workspaceId: string;
  autoCompaction?: RuntimeTurnAutoCompactionState;
  deduplicated?: boolean;
}

export interface TelegramRuntimeToolEvent {
  phase: "start" | "end";
  toolName: string;
  toolCallId: string;
  isError: boolean;
}

export interface TelegramAdapterTurnRequest {
  assistantId: string;
  threadId: string;
  conversationMode: "direct" | "group";
  externalUserKey: string | null;
  message: string;
  hasAttachments?: boolean;
  loadRawAttachments?: (assistantId: string) => Promise<RawInboundAttachment[]>;
  updateId?: number | null;
  onProcessingStarted?: (() => void) | undefined;
  onRuntimeTool?: ((event: TelegramRuntimeToolEvent) => Promise<void> | void) | undefined;
}

@Injectable()
export class HandleInternalTelegramTurnService {
  private readonly logger = new Logger(HandleInternalTelegramTurnService.name);
  private static readonly TELEGRAM_UPDATE_CLAIM_STALE_MS = 120_000;

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly inboundMediaService: InboundMediaService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService,
    private readonly sendNativeTelegramTurnService: SendNativeTelegramTurnService
  ) {}

  async execute(input: TelegramAdapterTurnRequest): Promise<InternalTelegramTurnResult> {
    return this.executeCore({
      assistantId: input.assistantId,
      threadId: input.threadId,
      conversationMode: input.conversationMode,
      externalUserKey: input.externalUserKey,
      message: input.message,
      updateId: input.updateId ?? null,
      hasAttachments: input.hasAttachments === true,
      loadRawAttachments: async (assistantId) =>
        input.loadRawAttachments ? input.loadRawAttachments(assistantId) : [],
      onProcessingStarted: input.onProcessingStarted,
      onRuntimeTool: input.onRuntimeTool
    });
  }

  private async executeCore(input: {
    assistantId: string;
    threadId: string;
    conversationMode: "direct" | "group";
    externalUserKey: string | null;
    message: string;
    updateId: number | null;
    hasAttachments: boolean;
    loadRawAttachments: (assistantId: string) => Promise<RawInboundAttachment[]>;
    onProcessingStarted?: (() => void) | undefined;
    onRuntimeTool?: ((event: TelegramRuntimeToolEvent) => Promise<void> | void) | undefined;
  }): Promise<InternalTelegramTurnResult> {
    const trace = this.overviewLatencyTraceService.start({
      traceId: randomUUID(),
      surface: "telegram",
      assistantId: input.assistantId,
      threadKey: input.threadId
    });
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      input.assistantId
    );
    trace.stage("resolved_context");
    const updateClaim = await this.claimTelegramUpdateIfNeeded(
      resolved.assistantId,
      input.updateId
    );
    trace.stage("update_claimed");
    if (updateClaim !== null && typeof updateClaim === "object") {
      trace.finish({
        status: "deduplicated",
        outputPreview: updateClaim.assistantMessage
      });
      return updateClaim;
    }
    const claimedUpdateId = updateClaim;
    input.onProcessingStarted?.();

    try {
      const quotaDecision = await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn(
        {
          assistant: resolved.assistant,
          surface: "telegram",
          isNewThread: false,
          activeSurfaceChatsCount: 0
        }
      );
      trace.stage("quota_checked");
      await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
        assistant: resolved.assistant,
        surface: "telegram",
        peerKey: input.threadId
      });
      trace.stage("abuse_checked");

      const workspace = await this.prisma.workspace.findUnique({
        where: { id: resolved.workspaceId },
        select: { timezone: true }
      });
      if (workspace === null) {
        throw new NotFoundException("Workspace does not exist for this assistant.");
      }
      trace.stage("workspace_loaded");
      const telegramBinding = await this.bindingRepository.findByAssistantProviderSurface(
        resolved.assistantId,
        "telegram",
        "telegram_bot"
      );
      const defaultDeepModeEnabled =
        telegramBinding !== null &&
        telegramBinding.config !== null &&
        typeof telegramBinding.config === "object" &&
        !Array.isArray(telegramBinding.config) &&
        (telegramBinding.config as Record<string, unknown>).defaultDeepModeEnabled === true;

      const rawAttachments = await input.loadRawAttachments(resolved.assistantId);
      if (rawAttachments.length > 0) {
        trace.stage("attachments_downloaded");
      }

      const chat = await this.chatRepository.findOrCreateChatBySurfaceThread({
        assistantId: resolved.assistantId,
        userId: resolved.userId,
        workspaceId: resolved.workspaceId,
        surface: "telegram",
        surfaceThreadKey: input.threadId,
        title: null
      });
      trace.stage("chat_loaded");

      const userMessage = await this.chatRepository.createMessage({
        chatId: chat.id,
        assistantId: resolved.assistantId,
        author: "user",
        content: input.message
      });
      trace.stage("user_message_saved");

      let enrichedMessage = input.message;
      let mediaSystemNotices: string[] = [];
      let runtimeAttachments: ReturnType<typeof toRuntimeAttachmentRef>[] = [];

      if (rawAttachments.length > 0) {
        const resolvedInboundMedia = await this.inboundMediaService.resolve({
          channel: "telegram",
          assistantId: resolved.assistantId,
          userId: resolved.userId,
          chatId: chat.id,
          messageId: userMessage.id,
          workspaceId: resolved.workspaceId,
          userMessage: input.message,
          rawAttachments
        });
        enrichedMessage = resolvedInboundMedia.enrichedMessage;
        mediaSystemNotices = resolvedInboundMedia.systemNotices;
        runtimeAttachments = resolvedInboundMedia.attachments.map((attachment) =>
          toRuntimeAttachmentRef(attachment)
        );
        trace.stage("attachments_resolved");
      } else {
        enrichedMessage = input.message;
      }

      const currentTimeIso = new Date().toISOString();
      const runtimeResponse = await this.sendNativeTelegramTurnService.execute(
        {
          assistantId: resolved.assistantId,
          publishedVersionId: resolved.publishedVersionId,
          runtimeTier: resolved.runtimeTier,
          workspaceId: resolved.workspaceId,
          ...(quotaDecision.mode === "degrade_allowed" && resolved.quotaDegradeModelOverride
            ? {
                providerOverride: resolved.quotaDegradeModelOverride.provider,
                modelOverride: resolved.quotaDegradeModelOverride.model
              }
            : {}),
          threadId: input.threadId,
          externalUserKey: input.externalUserKey,
          mode: input.conversationMode,
          userMessageId: userMessage.id,
          userMessage: input.message,
          attachments: runtimeAttachments,
          userTimezone: workspace.timezone,
          currentTimeIso,
          deepMode: defaultDeepModeEnabled
        },
        {
          onTool: input.onRuntimeTool
        }
      );
      if (runtimeResponse.runtimeTrace) {
        trace.attachExternalTrace(runtimeResponse.runtimeTrace);
      }
      trace.stage("runtime_done");

      const assistantMessage =
        mediaSystemNotices.length > 0
          ? `${mediaSystemNotices.join("\n")}\n\n${runtimeResponse.assistantMessage}`
          : runtimeResponse.assistantMessage;

      const assistantChatMessage = await this.chatRepository.createMessage({
        chatId: chat.id,
        assistantId: resolved.assistantId,
        author: "assistant",
        content: assistantMessage
      });
      trace.stage("assistant_message_saved");

      await this.trackWorkspaceQuotaUsageService.recordInboundTurnUsage({
        assistant: resolved.assistant,
        userContent: enrichedMessage,
        assistantContent: assistantMessage,
        source: "telegram_turn_sync"
      });
      trace.stage("quota_recorded");
      if (claimedUpdateId !== null) {
        await this.bindingRepository.completeTelegramUpdateProcessing(
          resolved.assistantId,
          "telegram",
          "telegram_bot",
          claimedUpdateId,
          new Date()
        );
        trace.stage("update_completed");
      }

      trace.finish({
        status: "completed",
        outputPreview: assistantMessage
      });
      return {
        ...runtimeResponse,
        assistantMessage,
        media: runtimeResponse.media,
        assistantMessageId: assistantChatMessage.id,
        chatId: chat.id,
        workspaceId: resolved.workspaceId
      };
    } catch (error) {
      if (claimedUpdateId !== null) {
        await this.releaseTelegramUpdateClaimBestEffort(resolved.assistantId, claimedUpdateId);
      }
      trace.finish({ status: "failed" });
      throw error;
    }
  }

  private async claimTelegramUpdateIfNeeded(
    assistantId: string,
    updateId: number | null | undefined
  ): Promise<number | InternalTelegramTurnResult | null> {
    if (updateId === null || updateId === undefined) {
      return null;
    }
    const claim = await this.bindingRepository.claimTelegramUpdateProcessing(
      assistantId,
      "telegram",
      "telegram_bot",
      updateId,
      new Date(),
      HandleInternalTelegramTurnService.TELEGRAM_UPDATE_CLAIM_STALE_MS
    );
    if (claim === "claimed" || claim === "missing_binding") {
      return claim === "claimed" ? updateId : null;
    }
    this.logger.warn(
      `[telegram-turn] Dropped duplicate Telegram update ${updateId} for assistant ${assistantId} (${claim})`
    );
    return this.buildDeduplicatedResult();
  }

  private buildDeduplicatedResult(): InternalTelegramTurnResult {
    return {
      assistantMessage: "",
      respondedAt: new Date().toISOString(),
      media: [],
      assistantMessageId: "",
      chatId: "",
      workspaceId: "",
      deduplicated: true
    };
  }

  private async releaseTelegramUpdateClaimBestEffort(
    assistantId: string,
    updateId: number
  ): Promise<void> {
    try {
      await this.bindingRepository.releaseTelegramUpdateProcessing(
        assistantId,
        "telegram",
        "telegram_bot",
        updateId
      );
    } catch (error) {
      this.logger.warn(
        `[telegram-turn] Non-fatal: failed to release Telegram update claim ${updateId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
