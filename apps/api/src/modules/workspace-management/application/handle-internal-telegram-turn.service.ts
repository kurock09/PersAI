import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  RuntimeChannelContext,
  RuntimeTurnAutoCompactionState
} from "@persai/runtime-contract";
import {
  type AssistantRuntimeWebChatTurnResult,
  type RuntimeMediaArtifact
} from "./assistant-runtime.facade";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import { EnforceInboundSafetyGateService } from "./enforce-inbound-safety-gate.service";
import { EnforceInboundSafetyPrecheckFollowThroughService } from "./enforce-inbound-safety-precheck-follow-through.service";
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
import {
  SendNativeTelegramTurnService,
  type SendNativeTelegramTurnInput
} from "./send-native-telegram-turn.service";
import { AttachmentObjectAvailabilityService } from "./media/attachment-object-availability.service";
import { AssistantMediaJobService } from "./assistant-media-job.service";
import { AssistantDocumentJobReadService } from "./assistant-document-job-read.service";
import { QuotaAdvisoryFollowUpService } from "./quota-advisory-follow-up.service";
import { CompactionAdvisoryFollowUpService } from "./compaction-advisory-follow-up.service";
import { toAssistantInboundFailurePayload } from "./assistant-inbound-error";
import { BackgroundCompactionQueueService } from "./background-compaction-queue.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import { RecordToolPathLedgerFromToolInvocationsService } from "./record-tool-path-ledger-from-tool-invocations.service";
import { AssistantUploadMicroDescriptionJobService } from "./assistant-upload-micro-description-job.service";
import { persistAssistantMessage } from "./persist-assistant-message";

export interface InternalTelegramTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
  assistantMessageId: string;
  chatId: string;
  workspaceId: string;
  autoCompaction?: RuntimeTurnAutoCompactionState;
  quotaAdvisoryFollowUpIntentId?: string | null;
  compactionAdvisoryFollowUpIntentId?: string | null;
  compactionQueueNoticeKind?: "compacted" | "exhausted" | null;
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
  channelContext?: RuntimeChannelContext;
  messageMetadata?: Record<string, unknown>;
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
    private readonly enforceInboundSafetyGateService: EnforceInboundSafetyGateService,
    private readonly enforceInboundSafetyPrecheckFollowThroughService: EnforceInboundSafetyPrecheckFollowThroughService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly inboundMediaService: InboundMediaService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService,
    private readonly sendNativeTelegramTurnService: SendNativeTelegramTurnService,
    private readonly attachmentObjectAvailabilityService: AttachmentObjectAvailabilityService,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly assistantDocumentJobReadService: AssistantDocumentJobReadService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService,
    private readonly recordToolPathLedgerFromToolInvocationsService: RecordToolPathLedgerFromToolInvocationsService,
    @Optional()
    private readonly quotaAdvisoryFollowUpService?: QuotaAdvisoryFollowUpService,
    @Optional()
    private readonly compactionAdvisoryFollowUpService?: CompactionAdvisoryFollowUpService,
    @Optional()
    private readonly backgroundCompactionQueueService?: BackgroundCompactionQueueService,
    @Optional()
    private readonly assistantUploadMicroDescriptionJobService?: AssistantUploadMicroDescriptionJobService
  ) {}

  async execute(input: TelegramAdapterTurnRequest): Promise<InternalTelegramTurnResult> {
    const coreInput = {
      assistantId: input.assistantId,
      threadId: input.threadId,
      conversationMode: input.conversationMode,
      externalUserKey: input.externalUserKey,
      message: input.message,
      updateId: input.updateId ?? null,
      hasAttachments: input.hasAttachments === true,
      loadRawAttachments: async (assistantId: string) =>
        input.loadRawAttachments ? input.loadRawAttachments(assistantId) : [],
      onProcessingStarted: input.onProcessingStarted,
      onRuntimeTool: input.onRuntimeTool
    };

    return this.executeCore(
      input.channelContext === undefined && input.messageMetadata === undefined
        ? coreInput
        : {
            ...coreInput,
            ...(input.channelContext === undefined ? {} : { channelContext: input.channelContext }),
            ...(input.messageMetadata === undefined
              ? {}
              : { messageMetadata: input.messageMetadata })
          }
    );
  }

  private async executeCore(input: {
    assistantId: string;
    threadId: string;
    conversationMode: "direct" | "group";
    externalUserKey: string | null;
    message: string;
    channelContext?: RuntimeChannelContext;
    messageMetadata?: Record<string, unknown>;
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
      await this.enforceInboundSafetyGateService.enforceActiveSafetyRestriction(
        resolved.assistant.userId
      );
      trace.stage("safety_checked");
      await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
        assistant: resolved.assistant,
        surface: "telegram",
        peerKey: input.threadId
      });
      trace.stage("abuse_checked");
      await this.enforceInboundSafetyPrecheckFollowThroughService.enforce({
        userId: resolved.assistant.userId,
        assistantId: resolved.assistantId,
        workspaceId: resolved.workspaceId,
        surface: "telegram",
        surfaceThreadKey: input.threadId,
        message: input.message,
        chatId: null,
        attachmentCount: input.hasAttachments ? 1 : 0
      });
      trace.stage("safety_precheck_checked");
      const quotaDecision = await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn(
        {
          assistant: resolved.assistant,
          surface: "telegram",
          isNewThread: false,
          activeSurfaceChatsCount: 0
        }
      );
      trace.stage("quota_checked");

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
        content: input.message,
        ...(input.messageMetadata === undefined ? {} : { metadata: input.messageMetadata })
      });
      trace.stage("user_message_saved");

      let enrichedMessage = input.message;
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
        await this.attachmentObjectAvailabilityService.assertRuntimeReadable({
          assistantId: resolved.assistantId,
          chatId: chat.id,
          messageId: userMessage.id,
          channel: "telegram",
          attachments: resolvedInboundMedia.attachments
        });
        await this.enqueueTelegramUploadMicroDescriptions({
          assistantId: resolved.assistantId,
          workspaceId: resolved.workspaceId,
          chatMode: "chatMode" in chat && typeof chat.chatMode === "string" ? chat.chatMode : null,
          attachments: resolvedInboundMedia.attachments
        });
        runtimeAttachments = resolvedInboundMedia.attachments.map((attachment) =>
          toRuntimeAttachmentRef(attachment)
        );
        trace.stage("attachments_resolved");
      } else {
        enrichedMessage = input.message;
      }

      const currentTimeIso = new Date().toISOString();
      const openMediaJobs = await this.assistantMediaJobService.listOpenJobsForChatContext({
        assistantId: resolved.assistantId,
        userId: chat.userId,
        chatId: chat.id
      });
      const mediaJobDeliveryUpdates =
        (await this.assistantMediaJobService.listJobDeliveryUpdatesForChatContext?.({
          assistantId: resolved.assistantId,
          userId: chat.userId,
          chatId: chat.id
        })) ?? [];
      const openDocumentJobs =
        await this.assistantDocumentJobReadService.listOpenJobsForRuntimeContext({
          assistantId: resolved.assistantId,
          userId: chat.userId,
          chatId: chat.id
        });
      const documentJobDeliveryUpdates =
        (await this.assistantDocumentJobReadService.listJobDeliveryUpdatesForRuntimeContext?.({
          assistantId: resolved.assistantId,
          userId: chat.userId,
          chatId: chat.id
        })) ?? [];
      const jobDeliveryUpdates = [...mediaJobDeliveryUpdates, ...documentJobDeliveryUpdates].sort(
        (left, right) => {
          const leftAt =
            left.deliveryStatus === "delivered_recently"
              ? Date.parse(left.deliveredAt ?? left.updatedAt)
              : Date.parse(left.completedAt ?? left.updatedAt);
          const rightAt =
            right.deliveryStatus === "delivered_recently"
              ? Date.parse(right.deliveredAt ?? right.updatedAt)
              : Date.parse(right.completedAt ?? right.updatedAt);
          if (left.deliveryStatus !== right.deliveryStatus) {
            return left.deliveryStatus === "finalizing_delivery" ? -1 : 1;
          }
          return rightAt - leftAt;
        }
      );
      const nativeTurnInput: SendNativeTelegramTurnInput = {
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
        ...(input.channelContext === undefined ? {} : { channelContext: input.channelContext }),
        userMessageId: userMessage.id,
        userMessage: enrichedMessage,
        attachments: runtimeAttachments,
        ...(openMediaJobs.length === 0 ? {} : { openMediaJobs }),
        ...(openDocumentJobs.length === 0 ? {} : { openDocumentJobs }),
        ...(jobDeliveryUpdates.length === 0 ? {} : { jobDeliveryUpdates }),
        userTimezone: workspace.timezone,
        currentTimeIso,
        deepMode: defaultDeepModeEnabled
      };
      let queueWaitResult =
        (await this.backgroundCompactionQueueService?.waitForActiveThreadCompaction({
          assistantId: resolved.assistantId,
          channel: "telegram",
          externalThreadKey: input.threadId
        })) ?? null;

      let runtimeResponse: Awaited<ReturnType<SendNativeTelegramTurnService["execute"]>>;
      try {
        runtimeResponse = await this.sendNativeTelegramTurnService.execute(nativeTurnInput, {
          onTool: input.onRuntimeTool
        });
      } catch (error: unknown) {
        const retryWaitResult = await this.waitForRetryAfterCompactionConflict(
          error,
          resolved.assistantId,
          input.threadId
        );
        if (retryWaitResult === null || retryWaitResult.readyForRetry === false) {
          throw error;
        }
        if (retryWaitResult.noticeKind !== null) {
          queueWaitResult = retryWaitResult;
        }
        runtimeResponse = await this.sendNativeTelegramTurnService.execute(nativeTurnInput, {
          onTool: input.onRuntimeTool
        });
      }
      if (runtimeResponse.runtimeTrace) {
        trace.attachExternalTrace(runtimeResponse.runtimeTrace);
      }
      trace.stage("runtime_done");

      const assistantMessage = runtimeResponse.assistantMessage;

      let assistantMessageId = "";
      let deliveredMedia = runtimeResponse.media;
      try {
        const assistantChatMessage = await persistAssistantMessage({
          chatRepository: this.chatRepository,
          assistantMediaJobService: this.assistantMediaJobService,
          chatId: chat.id,
          assistantId: resolved.assistantId,
          content: assistantMessage,
          discoveredFileRefIds: runtimeResponse.discoveredFileRefIds,
          deferredMediaJobCount: runtimeResponse.deferredMediaJobs?.length,
          sourceUserMessageId: userMessage.id
        });
        assistantMessageId = assistantChatMessage.id;
        trace.stage("assistant_message_saved");
      } catch (error) {
        this.logger.error(
          `[telegram-turn] Completed runtime turn could not persist assistant message for ${resolved.assistantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined
        );
        if (runtimeResponse.media.length > 0) {
          this.logger.warn(
            `[telegram-turn] Dropping ${runtimeResponse.media.length} media artifact(s) for completed turn because assistant message persistence failed for ${resolved.assistantId}.`
          );
          deliveredMedia = [];
        }
        trace.finish({
          status: "completed",
          outputPreview: assistantMessage
        });
        return {
          ...runtimeResponse,
          assistantMessage,
          media: deliveredMedia,
          assistantMessageId,
          chatId: chat.id,
          workspaceId: resolved.workspaceId,
          quotaAdvisoryFollowUpIntentId: null,
          compactionQueueNoticeKind: queueWaitResult?.noticeKind ?? null
        };
      }

      try {
        await this.trackWorkspaceQuotaUsageService.recordInboundTurnUsage({
          assistant: resolved.assistant,
          userContent: enrichedMessage,
          assistantContent: assistantMessage,
          ...(runtimeResponse.usageAccounting === undefined
            ? {}
            : { usageAccounting: runtimeResponse.usageAccounting }),
          source: "telegram_turn_sync"
        });
        trace.stage("quota_recorded");
      } catch (error) {
        this.logger.error(
          `[telegram-turn] Non-blocking quota accounting failure after completed runtime turn for ${resolved.assistantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined
        );
      }
      await this.appendModelCostLedgerEvents({
        assistantId: resolved.assistantId,
        workspaceId: resolved.workspaceId,
        userId: resolved.userId,
        assistantMessageId,
        respondedAt: runtimeResponse.respondedAt,
        traceId: trace.getTraceId(),
        ...(runtimeResponse.usageAccounting === undefined
          ? {}
          : { usageAccounting: runtimeResponse.usageAccounting }),
        ...(runtimeResponse.toolInvocations === undefined
          ? {}
          : { toolInvocations: runtimeResponse.toolInvocations })
      });
      const quotaAdvisoryFollowUp =
        (await this.quotaAdvisoryFollowUpService?.maybeCreateFollowUp({
          assistantId: resolved.assistantId,
          workspaceId: resolved.workspaceId,
          userId: resolved.userId,
          chatId: chat.id,
          surface: "telegram",
          surfaceThreadKey: input.threadId,
          mainAssistantMessage: assistantMessage,
          traceId: trace.getTraceId()
        })) ?? null;
      const compactionAdvisoryFollowUp =
        quotaAdvisoryFollowUp === null
          ? ((await this.compactionAdvisoryFollowUpService?.maybeCreateFollowUp({
              assistantId: resolved.assistantId,
              workspaceId: resolved.workspaceId,
              userId: resolved.userId,
              chatId: chat.id,
              surface: "telegram",
              surfaceThreadKey: input.threadId,
              externalUserKey: input.externalUserKey,
              mainAssistantMessage: assistantMessage,
              traceId: trace.getTraceId()
            })) ?? null)
          : null;
      if (quotaAdvisoryFollowUp !== null) {
        trace.stage("quota_advisory_follow_up_intent_created");
      }
      if (compactionAdvisoryFollowUp !== null) {
        trace.stage("compaction_advisory_follow_up_intent_created");
      }
      await this.completeTelegramUpdateBestEffort(resolved.assistantId, claimedUpdateId);
      trace.finish({
        status: "completed",
        outputPreview: assistantMessage
      });
      return {
        ...runtimeResponse,
        assistantMessage,
        media: deliveredMedia,
        assistantMessageId,
        chatId: chat.id,
        workspaceId: resolved.workspaceId,
        quotaAdvisoryFollowUpIntentId: quotaAdvisoryFollowUp?.intentId ?? null,
        compactionAdvisoryFollowUpIntentId: compactionAdvisoryFollowUp?.intentId ?? null,
        compactionQueueNoticeKind: queueWaitResult?.noticeKind ?? null
      };
    } catch (error) {
      if (claimedUpdateId !== null) {
        await this.releaseTelegramUpdateClaimBestEffort(resolved.assistantId, claimedUpdateId);
      }
      trace.finish({ status: "failed" });
      throw error;
    }
  }

  private async enqueueTelegramUploadMicroDescriptions(input: {
    assistantId: string;
    workspaceId: string;
    chatMode: string | null;
    attachments: Array<{ id: string; assistantFileId: string | null }>;
  }): Promise<void> {
    if (this.assistantUploadMicroDescriptionJobService === undefined) {
      return;
    }
    await Promise.all(
      input.attachments.map(async (attachment) => {
        try {
          await this.assistantUploadMicroDescriptionJobService?.enqueueIfNeeded({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            chatMode: input.chatMode,
            attachmentId: attachment.id,
            assistantFileId: attachment.assistantFileId
          });
        } catch (error) {
          this.logger.warn(
            `Failed to enqueue Telegram upload micro-description for attachment ${attachment.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );
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

  private async appendModelCostLedgerEvents(input: {
    assistantId: string;
    workspaceId: string;
    userId: string;
    assistantMessageId: string;
    respondedAt: string;
    traceId: string;
    usageAccounting?: AssistantRuntimeWebChatTurnResult["usageAccounting"];
    toolInvocations?: AssistantRuntimeWebChatTurnResult["toolInvocations"];
  }): Promise<void> {
    try {
      await this.recordModelCostLedgerService.recordChatMainReplyEvents({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        surface: "telegram",
        purpose: "chat_main_reply",
        source: "telegram_turn_sync",
        occurredAt: input.respondedAt,
        sourceEventId: input.assistantMessageId,
        requestCorrelationId: input.traceId,
        ...(input.usageAccounting === undefined ? {} : { usageAccounting: input.usageAccounting })
      });
    } catch (error) {
      this.logger.warn(
        `[telegram-turn] Non-blocking model cost ledger append failed for assistant ${input.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    await this.recordToolPathLedgerFromToolInvocationsService.recordFromToolInvocations({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: "telegram",
      source: "native_tool_inline",
      assistantMessageId: input.assistantMessageId,
      requestCorrelationId: input.traceId,
      ...(input.toolInvocations === undefined ? {} : { toolInvocations: input.toolInvocations })
    });
  }

  private buildDeduplicatedResult(): InternalTelegramTurnResult {
    return {
      assistantMessage: "",
      respondedAt: new Date().toISOString(),
      media: [],
      assistantMessageId: "",
      chatId: "",
      workspaceId: "",
      quotaAdvisoryFollowUpIntentId: null,
      compactionQueueNoticeKind: null,
      deduplicated: true
    };
  }

  private async waitForRetryAfterCompactionConflict(
    error: unknown,
    assistantId: string,
    threadId: string
  ): Promise<{
    waited: boolean;
    readyForRetry: boolean;
    noticeKind: "compacted" | "exhausted" | null;
  } | null> {
    if (
      this.backgroundCompactionQueueService === undefined ||
      toAssistantInboundFailurePayload(error).code !== "native_runtime_conflict"
    ) {
      return null;
    }

    return this.backgroundCompactionQueueService.waitForActiveThreadCompaction({
      assistantId,
      channel: "telegram",
      externalThreadKey: threadId
    });
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

  private async completeTelegramUpdateBestEffort(
    assistantId: string,
    updateId: number | null
  ): Promise<boolean> {
    if (updateId === null) {
      return false;
    }
    try {
      await this.bindingRepository.completeTelegramUpdateProcessing(
        assistantId,
        "telegram",
        "telegram_bot",
        updateId,
        new Date()
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[telegram-turn] Non-fatal: failed to finalize Telegram update ${updateId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await this.releaseTelegramUpdateClaimBestEffort(assistantId, updateId);
      return false;
    }
  }
}
