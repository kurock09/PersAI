import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository,
  type CompletedWebTurnReplayState
} from "../domain/assistant-channel-surface-binding.repository";
import {
  type AssistantRuntimeWebChatTurnStreamChunk,
  type RuntimeMediaArtifact
} from "./assistant-runtime.facade";
import { WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT } from "../domain/memory-source-policy";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { Assistant } from "../domain/assistant.entity";
import type {
  AssistantWebChatMessageState,
  AssistantWebChatState,
  AssistantWebChatTurnState
} from "./web-chat.types";
import { PrepareAssistantInboundTurnService } from "./prepare-assistant-inbound-turn.service";
import { toAssistantInboundFailurePayload } from "./assistant-inbound-error";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { toRuntimeAttachmentRef } from "./media/media.types";
import { AttachmentObjectAvailabilityService } from "./media/attachment-object-availability.service";
import { resolveWelcomeTurnInstruction } from "./send-web-chat-turn.service";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import type { RuntimeTier } from "./runtime-assignment";
import {
  OverviewLatencyTraceService,
  type OverviewLatencyTraceHandle
} from "./overview-latency-trace.service";
import { applyFinalDeliveryHonestyCorrection } from "./final-delivery-honesty";
import {
  StreamNativeWebChatTurnService,
  type StreamNativeWebChatTurnInput
} from "./stream-native-web-chat-turn.service";
import { SendNativeWebChatTurnService } from "./send-native-web-chat-turn.service";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { AutoSkillRoutingStateService } from "./auto-skill-routing-state.service";
import {
  createCadenceWatchdog,
  DEFAULT_CADENCE_THRESHOLDS,
  type CadenceWatchdogStallReport
} from "./cadence-watchdog";
import { AssistantMediaJobService } from "./assistant-media-job.service";
import { QuotaAdvisoryFollowUpService } from "./quota-advisory-follow-up.service";
import { CompactionAdvisoryFollowUpService } from "./compaction-advisory-follow-up.service";
import { BackgroundCompactionQueueService } from "./background-compaction-queue.service";
import { NotificationDeliveryWorkerService } from "./notifications/notification-delivery-worker.service";

export interface StreamWebChatTurnPrepared {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  quotaDegradeModelOverride: { provider: "openai" | "anthropic"; model: string } | null;
  quotaDegradeReason: "token_budget_limit_reached" | null;
  welcomeFirstTurnPrompt: string | null;
  userId: string;
  workspaceId: string;
  workspaceTimezone: string;
  traceHandle?: OverviewLatencyTraceHandle;
  clientTurnId?: string;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
}

export interface StreamWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
  deepModeEnabled?: boolean;
  clientTurnId?: string;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
}

export type StreamWebChatTurnPreparation =
  | { mode: "prepared"; prepared: StreamWebChatTurnPrepared }
  | { mode: "replayed"; transport: AssistantWebChatTurnState };

const WEB_TURN_PROVIDER_KEY = "web_internal";
const WEB_TURN_SURFACE_TYPE = "web_chat";
const WEB_TURN_CLAIM_STALE_MS = 120_000;
const WEB_TURN_REPLAY_WAIT_MS = 12_000;
const WEB_TURN_REPLAY_POLL_MS = 250;
/**
 * Maximum number of times we will (re)open the runtime stream for a single web
 * chat turn. The first attempt always counts; on stall we may attempt once more.
 */
const WEB_TURN_MAX_STREAM_ATTEMPTS = 2;

function toAttachmentState(attachment: {
  id: string;
  assistantFileId: string | null;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  processingStatus: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}) {
  return {
    id: attachment.id,
    fileRef: attachment.assistantFileId,
    attachmentType: attachment.attachmentType,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.sizeBytes),
    processingStatus: attachment.processingStatus,
    ...(attachment.metadata?.fileDeleted === true ? { fileDeleted: true } : {}),
    createdAt: attachment.createdAt.toISOString()
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseWebThreadProviderMessageId(providerRef: string | null): string | null {
  if (typeof providerRef !== "string") {
    return null;
  }
  const match = providerRef.match(/^web_thread:[^:]+:(.+)$/);
  return match?.[1] ?? null;
}

function resolveWelcomeUserMessage(
  welcomeFirstTurnPrompt: string | null,
  welcomeLocale?: string
): string {
  return welcomeFirstTurnPrompt ?? resolveWelcomeTurnInstruction(welcomeLocale);
}

export interface StreamWebChatTurnOutcomeCompleted {
  status: "completed";
  transport: AssistantWebChatTurnState;
}

export interface StreamWebChatTurnOutcomeInterrupted {
  status: "interrupted";
  transport: AssistantWebChatTurnState | null;
}

export interface StreamWebChatTurnOutcomeFailed {
  status: "failed";
  transport: AssistantWebChatTurnState | null;
  code: string;
  message: string;
}

export type StreamWebChatTurnOutcome =
  | StreamWebChatTurnOutcomeCompleted
  | StreamWebChatTurnOutcomeInterrupted
  | StreamWebChatTurnOutcomeFailed;

@Injectable()
export class StreamWebChatTurnService {
  private readonly logger = new Logger(StreamWebChatTurnService.name);

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly streamNativeWebChatTurnService: StreamNativeWebChatTurnService,
    private readonly sendNativeWebChatTurnService: SendNativeWebChatTurnService,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService,
    private readonly attachmentObjectAvailabilityService: AttachmentObjectAvailabilityService,
    private readonly autoSkillRoutingStateService: AutoSkillRoutingStateService,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly notificationDeliveryWorkerService: NotificationDeliveryWorkerService,
    @Optional()
    private readonly quotaAdvisoryFollowUpService?: QuotaAdvisoryFollowUpService,
    private readonly webChatTurnAttemptService?: WebChatTurnAttemptService,
    @Optional()
    private readonly compactionAdvisoryFollowUpService?: CompactionAdvisoryFollowUpService,
    @Optional()
    private readonly backgroundCompactionQueueService?: BackgroundCompactionQueueService
  ) {}

  async prepare(
    userId: string,
    request: StreamWebChatTurnRequest
  ): Promise<StreamWebChatTurnPreparation> {
    const trace = this.overviewLatencyTraceService.start({
      traceId: randomUUID(),
      surface: "web_chat_stream",
      threadKey: request.surfaceThreadKey
    });
    trace.stage("prepare_begin");
    try {
      const replayTransport = await this.claimOrReplayWebTurn(userId, request);
      trace.stage("replay_claim_checked");
      if (replayTransport !== null) {
        trace.finish({
          status: "replayed",
          outputPreview: replayTransport.assistantMessage.content
        });
        return { mode: "replayed", transport: replayTransport };
      }

      const prepared = await this.prepareAssistantInboundTurnService.execute({
        userId,
        surface: "web_chat",
        surfaceThreadKey: request.surfaceThreadKey,
        message: request.message,
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.deepModeEnabled === undefined
          ? {}
          : { deepModeEnabled: request.deepModeEnabled }),
        ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId })
      });
      trace.stage("prepared");
      if (request.clientTurnId !== undefined && this.webChatTurnAttemptService) {
        await this.webChatTurnAttemptService.markRunning({
          assistantId: prepared.assistantId,
          userId: prepared.userId,
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          clientTurnId: request.clientTurnId,
          chatId: prepared.chat.id,
          userMessageId: prepared.userMessage.id
        });
      }
      return {
        mode: "prepared",
        prepared: {
          ...prepared,
          traceHandle: trace,
          ...(request.clientTurnId !== undefined ? { clientTurnId: request.clientTurnId } : {}),
          ...(request.welcomeTurn ? { welcomeTurn: true } : {}),
          ...(request.welcomeLocale !== undefined ? { welcomeLocale: request.welcomeLocale } : {})
        }
      };
    } catch (error) {
      trace.finish({ status: "failed" });
      throw error;
    }
  }

  async streamToCompletion(
    prepared: StreamWebChatTurnPrepared,
    callbacks: {
      isClientAborted: () => boolean;
      clientAbortSignal?: AbortSignal;
      onDelta: (delta: string, accumulated: string) => void;
      onThinking: (delta: string, accumulated: string) => void;
      onTool?: (payload: {
        phase: "start" | "end";
        toolName: string;
        toolCallId: string;
        isError: boolean;
      }) => void;
      onActivity?: (payload: {
        source: "skill" | "user" | "product" | "web";
        phase: "start";
        resultCount: number;
        skillName?: string | null;
        skillIconEmoji?: string | null;
      }) => void;
      onDone: (respondedAt: string) => void;
      /**
       * Fired when the cadence watchdog has detected a stalled stream and we are
       * about to abort the runtime call and retry. The client UI must clear any
       * accumulated assistant text it has rendered for this turn so that the
       * fresh deltas from the retry replace (rather than append to) the partial
       * frozen output.
       */
      onStreamReset?: (payload: { reason: string; attempt: number }) => void;
      getSseWriterStatsSummary?: () => string | null;
    }
  ): Promise<StreamWebChatTurnOutcome> {
    let accumulated = "";
    let respondedAt: string | null = null;
    let usageAccounting: AssistantRuntimeWebChatTurnStreamChunk["usageAccounting"] = undefined;
    let turnRouting: AssistantRuntimeWebChatTurnStreamChunk["turnRouting"] = null;
    let deferredMediaJobs: AssistantRuntimeWebChatTurnStreamChunk["deferredMediaJobs"] = undefined;
    const collectedMedia: RuntimeMediaArtifact[] = [];
    let mediaDeliveryCompleted = false;
    const trace =
      prepared.traceHandle ??
      this.overviewLatencyTraceService.start({
        traceId: randomUUID(),
        surface: "web_chat_stream",
        assistantId: prepared.assistantId,
        threadKey: prepared.chat.surfaceThreadKey
      });
    trace.stage("stream_begin");
    const traceEnabled = trace.isEnabled();
    const cadenceState = traceEnabled ? createDeltaCadenceState() : null;

    const userAttachments = await this.attachmentRepository.listByMessageId(
      prepared.userMessage.id
    );
    await this.attachmentObjectAvailabilityService.assertRuntimeReadable({
      assistantId: prepared.assistantId,
      chatId: prepared.chat.id,
      messageId: prepared.userMessage.id,
      channel: "web",
      attachments: userAttachments
    });
    trace.stage("attachments_loaded");
    const baseMessage = prepared.welcomeTurn
      ? resolveWelcomeUserMessage(prepared.welcomeFirstTurnPrompt, prepared.welcomeLocale)
      : prepared.userMessage.content;
    const openMediaJobs = await this.assistantMediaJobService.listOpenJobsForChatContext({
      assistantId: prepared.assistantId,
      userId: prepared.userId,
      chatId: prepared.chat.id
    });
    const currentTimeIso = new Date().toISOString();
    const skillStateContext = await this.autoSkillRoutingStateService.buildRuntimeContext({
      chatId: prepared.chat.id,
      currentUserMessageId: prepared.userMessage.id,
      decisionState: prepared.chat.skillDecisionState,
      cadenceState: prepared.chat.skillCadenceState
    });
    const nativeTurnInput = this.buildNativeStreamTurnInput({
      assistantId: prepared.assistantId,
      publishedVersionId: prepared.publishedVersionId,
      runtimeTier: prepared.runtimeTier,
      surfaceThreadKey: prepared.chat.surfaceThreadKey,
      userId: prepared.userId,
      workspaceId: prepared.workspaceId,
      userMessageId: prepared.userMessage.id,
      userMessage: baseMessage,
      attachments: userAttachments.map((attachment) => toRuntimeAttachmentRef(attachment)),
      ...(openMediaJobs.length === 0 ? {} : { openMediaJobs }),
      userTimezone: prepared.workspaceTimezone,
      currentTimeIso,
      skillStateContext,
      deepMode: prepared.chat.deepModeEnabled,
      ...(prepared.quotaDegradeModelOverride
        ? {
            providerOverride: prepared.quotaDegradeModelOverride.provider,
            modelOverride: prepared.quotaDegradeModelOverride.model
          }
        : {})
    });
    trace.stage("native_turn_input_built");
    this.logWebRuntimeRoute({
      route: "stream",
      assistantId: prepared.assistantId,
      surfaceThreadKey: prepared.chat.surfaceThreadKey,
      ...(prepared.clientTurnId === undefined ? {} : { clientTurnId: prepared.clientTurnId })
    });
    const primaryRuntimeStartedAt = Date.now();
    let primaryFirstDeltaMs: number | null = null;
    const stallReports: CadenceWatchdogStallReport[] = [];
    let lastAttemptStatus: "completed" | "client-aborted" | "stalled" | "retry_after_compaction" =
      "completed";

    try {
      await this.backgroundCompactionQueueService?.waitForActiveThreadCompaction({
        assistantId: prepared.assistantId,
        channel: "web",
        externalThreadKey: prepared.chat.surfaceThreadKey
      });
      trace.stage("runtime_stream_requested");

      for (let attempt = 1; attempt <= WEB_TURN_MAX_STREAM_ATTEMPTS; attempt++) {
        const isLastAttempt = attempt === WEB_TURN_MAX_STREAM_ATTEMPTS;
        const result = await this.streamRuntimeAttempt({
          attempt,
          isLastAttempt,
          prepared,
          nativeTurnInput,
          traceEnabled,
          cadenceState,
          accumulatedSoFar: accumulated,
          callbacks,
          trace,
          primaryRuntimeStartedAt,
          primaryFirstDeltaMs,
          onStallReport: (report) => stallReports.push(report)
        });

        accumulated = result.accumulated;
        respondedAt = result.respondedAt;
        usageAccounting = result.usageAccounting;
        turnRouting = result.turnRouting;
        deferredMediaJobs = result.deferredMediaJobs;
        for (const m of result.collectedMedia) collectedMedia.push(m);
        if (result.primaryFirstDeltaMs !== null) {
          primaryFirstDeltaMs = result.primaryFirstDeltaMs;
        }
        lastAttemptStatus = result.status;

        if (result.status === "completed" || result.status === "client-aborted") {
          break;
        }

        if (result.status === "retry_after_compaction") {
          if (isLastAttempt) {
            throw createAssistantInboundConflict(
              "native_runtime_conflict",
              "This web turn is already being processed."
            );
          }
          continue;
        }

        // result.status === "stalled"
        if (isLastAttempt) {
          this.logger.warn(
            this.composeWebStreamStallLogLine({
              eventName: "web_stream_stall_unrecovered",
              prepared,
              attempt,
              report: result.stallReport,
              accumulatedLen: accumulated.length
            })
          );
          break;
        }

        // Decide whether to retry. Heavy-state turns (tools fired, media collected,
        // or a runtime_done already received) are NOT retried - replaying them would
        // duplicate side effects. We only retry "pure text response" stalls.
        const safeToRetry =
          result.toolEventCount === 0 && collectedMedia.length === 0 && respondedAt === null;
        if (!safeToRetry) {
          this.logger.warn(
            this.composeWebStreamStallLogLine({
              eventName: "web_stream_stall_unrecovered",
              prepared,
              attempt,
              report: result.stallReport,
              accumulatedLen: accumulated.length,
              extraReason: "side_effects_present"
            })
          );
          break;
        }

        this.logger.warn(
          this.composeWebStreamStallLogLine({
            eventName: "web_stream_stall_recovery_attempted",
            prepared,
            attempt,
            report: result.stallReport,
            accumulatedLen: accumulated.length
          })
        );
        callbacks.onStreamReset?.({
          reason: result.stallReport?.reason ?? "unknown",
          attempt
        });
        accumulated = "";
        respondedAt = null;
        turnRouting = null;
        primaryFirstDeltaMs = null;
      }

      if (callbacks.isClientAborted() || lastAttemptStatus === "client-aborted") {
        if (prepared.clientTurnId !== undefined) {
          await this.bindingRepository.releaseWebTurnProcessing(
            prepared.assistantId,
            WEB_TURN_PROVIDER_KEY,
            WEB_TURN_SURFACE_TYPE,
            prepared.clientTurnId
          );
        }
        trace.finish({
          status: "interrupted",
          outputPreview: accumulated
        });
        if (collectedMedia.length > 0) {
          await this.mediaDeliveryService.settleUserStoppedArtifacts({
            assistantId: prepared.assistantId,
            artifacts: collectedMedia,
            reason: "web_stream_client_aborted_before_delivery"
          });
        }
        const interrupted = await this.persistInterruptedOutcome(
          prepared,
          accumulated,
          respondedAt
        );
        if (prepared.clientTurnId !== undefined && this.webChatTurnAttemptService) {
          await this.webChatTurnAttemptService.markInterrupted({
            assistantId: prepared.assistantId,
            userId: prepared.userId,
            surfaceThreadKey: prepared.chat.surfaceThreadKey,
            clientTurnId: prepared.clientTurnId,
            assistantMessageId: interrupted.transport?.assistantMessage.id ?? null,
            code: "client_aborted",
            message: "The user stopped this web chat turn."
          });
        }
        return interrupted;
      }

      if (
        stallReports.length > 0 &&
        lastAttemptStatus === "completed" &&
        accumulated.trim().length > 0
      ) {
        this.logger.warn(
          this.composeWebStreamStallLogLine({
            eventName: "web_stream_stall_recovered",
            prepared,
            attempt: stallReports.length + 1,
            report: stallReports[stallReports.length - 1] ?? null,
            accumulatedLen: accumulated.length
          })
        );
      }

      const cleanedAccumulated = accumulated.trim();
      if (cleanedAccumulated.length === 0 && collectedMedia.length === 0) {
        if (prepared.clientTurnId !== undefined) {
          if (this.webChatTurnAttemptService) {
            await this.webChatTurnAttemptService.markFailed({
              assistantId: prepared.assistantId,
              userId: prepared.userId,
              surfaceThreadKey: prepared.chat.surfaceThreadKey,
              clientTurnId: prepared.clientTurnId,
              code: "runtime_invalid_response",
              message: "Runtime stream finished without assistant output."
            });
          }
          await this.bindingRepository.releaseWebTurnProcessing(
            prepared.assistantId,
            WEB_TURN_PROVIDER_KEY,
            WEB_TURN_SURFACE_TYPE,
            prepared.clientTurnId
          );
        }
        trace.finish({ status: "failed" });
        return {
          status: "failed",
          transport: null,
          code: "runtime_invalid_response",
          message: "Runtime stream finished without assistant output."
        };
      }

      const assistantMessage = await this.assistantChatRepository.createMessage({
        chatId: prepared.chat.id,
        assistantId: prepared.assistantId,
        author: "assistant",
        content: cleanedAccumulated
      });
      trace.stage("assistant_message_saved");
      if (deferredMediaJobs !== undefined && deferredMediaJobs.length > 0) {
        await this.assistantMediaJobService.attachAcknowledgementMessageId({
          assistantId: prepared.assistantId,
          sourceUserMessageId: prepared.userMessage.id,
          assistantAcknowledgementMessageId: assistantMessage.id
        });
      }
      const activeMediaJobs = await this.assistantMediaJobService.listOpenJobsForWebChat({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        chatId: prepared.chat.id
      });

      const delivered = await this.mediaDeliveryService.deliver({
        artifacts: collectedMedia,
        channel: "web",
        assistantId: prepared.assistantId,
        chatId: prepared.chat.id,
        messageId: assistantMessage.id,
        workspaceId: prepared.workspaceId
      });
      mediaDeliveryCompleted = true;
      const attachmentStates = delivered.attachments;
      trace.stage("media_delivered");
      const finalAssistantContent = await this.persistFinalAssistantContentIfNeeded({
        assistantMessage,
        assistantId: prepared.assistantId,
        assistantText: cleanedAccumulated,
        attemptedArtifactCount: collectedMedia.length,
        deliveredAttachmentCount: attachmentStates.length,
        deliveredAttachmentFilenames: attachmentStates
          .map((attachment) => attachment.originalFilename)
          .filter((filename): filename is string => typeof filename === "string"),
        locale: prepared.welcomeLocale ?? null
      });

      await this.recordWebChatMemoryTurnService.execute({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        userMessageId: prepared.userMessage.id,
        assistantMessageId: assistantMessage.id,
        userContent: prepared.welcomeTurn
          ? resolveWelcomeUserMessage(prepared.welcomeFirstTurnPrompt, prepared.welcomeLocale)
          : prepared.userMessage.content,
        assistantContent: finalAssistantContent,
        memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
      });
      trace.stage("memory_recorded");
      await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
        assistant: prepared.assistant,
        userContent: baseMessage,
        assistantContent: finalAssistantContent,
        ...(usageAccounting === undefined ? {} : { usageAccounting }),
        source: "web_chat_turn_stream_completed"
      });
      trace.stage("quota_recorded");
      const quotaAdvisoryFollowUp =
        (await this.quotaAdvisoryFollowUpService?.maybeCreateFollowUp({
          assistantId: prepared.assistantId,
          workspaceId: prepared.workspaceId,
          userId: prepared.userId,
          chatId: prepared.chat.id,
          surface: "web",
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          mainAssistantMessage: finalAssistantContent,
          traceId: trace.getTraceId()
        })) ?? null;
      const compactionAdvisoryFollowUp =
        quotaAdvisoryFollowUp === null
          ? ((await this.compactionAdvisoryFollowUpService?.maybeCreateFollowUp({
              assistantId: prepared.assistantId,
              workspaceId: prepared.workspaceId,
              userId: prepared.userId,
              chatId: prepared.chat.id,
              surface: "web",
              surfaceThreadKey: prepared.chat.surfaceThreadKey,
              externalUserKey: prepared.userId,
              mainAssistantMessage: finalAssistantContent,
              traceId: trace.getTraceId()
            })) ?? null)
          : null;
      let followUpAssistantMessageId: string | null = null;
      let followUpAssistantMessage: {
        id: string;
        chatId: string;
        assistantId: string;
        author: "assistant";
        content: string;
        attachments: ReturnType<typeof toAttachmentState>[];
        createdAt: string;
      } | null = null;
      const followUpIntent = quotaAdvisoryFollowUp ?? compactionAdvisoryFollowUp;
      if (quotaAdvisoryFollowUp !== null) {
        trace.stage("quota_advisory_follow_up_intent_created");
      }
      if (compactionAdvisoryFollowUp !== null) {
        trace.stage("compaction_advisory_follow_up_intent_created");
      }
      if (followUpIntent !== null) {
        const delivery = await this.notificationDeliveryWorkerService.deliverIntentNow(
          followUpIntent.intentId
        );
        followUpAssistantMessageId = parseWebThreadProviderMessageId(delivery.providerRef);
        if (followUpAssistantMessageId !== null) {
          const deliveredFollowUp = await this.assistantChatRepository.findMessageByIdForAssistant(
            followUpAssistantMessageId,
            prepared.assistantId
          );
          if (deliveredFollowUp !== null) {
            const followUpAttachments = await this.attachmentRepository.listByMessageId(
              deliveredFollowUp.id
            );
            followUpAssistantMessage = {
              id: deliveredFollowUp.id,
              chatId: deliveredFollowUp.chatId,
              assistantId: deliveredFollowUp.assistantId,
              author: "assistant",
              content: deliveredFollowUp.content,
              attachments: followUpAttachments.map((attachment) => toAttachmentState(attachment)),
              createdAt: deliveredFollowUp.createdAt.toISOString()
            };
          }
        }
      }
      if (prepared.clientTurnId !== undefined) {
        const replayState = {
          clientTurnId: prepared.clientTurnId,
          chatId: prepared.chat.id,
          userMessageId: prepared.userMessage.id,
          assistantMessageId: assistantMessage.id,
          respondedAt: respondedAt ?? new Date().toISOString(),
          degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
          quotaFallbackReason: prepared.quotaDegradeReason,
          quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
          followUpAssistantMessageId,
          ...(turnRouting === undefined ? {} : { turnRouting }),
          completedAt: new Date().toISOString()
        };
        if (this.webChatTurnAttemptService) {
          await this.webChatTurnAttemptService.markCompleted({
            assistantId: prepared.assistantId,
            userId: prepared.userId,
            surfaceThreadKey: prepared.chat.surfaceThreadKey,
            clientTurnId: prepared.clientTurnId,
            assistantMessageId: assistantMessage.id,
            respondedAt: replayState.respondedAt,
            terminalPayload: replayState
          });
        }
        await this.bindingRepository.completeWebTurnProcessing(
          prepared.assistantId,
          WEB_TURN_PROVIDER_KEY,
          WEB_TURN_SURFACE_TYPE,
          replayState
        );
        trace.stage("replay_completed");
      }
      const persistedSkillState = await this.autoSkillRoutingStateService.persistFromTurnRouting({
        chatId: prepared.chat.id,
        currentUserMessageIndex: skillStateContext.currentUserMessageIndex,
        turnRouting
      });
      const postTurnSkillStateContext = await this.autoSkillRoutingStateService.buildRuntimeContext(
        {
          chatId: prepared.chat.id,
          currentUserMessageId: prepared.userMessage.id,
          decisionState: persistedSkillState.skillDecisionState,
          cadenceState: persistedSkillState.skillCadenceState
        }
      );
      if (
        await this.autoSkillRoutingStateService.shouldRunBackgroundCheck(postTurnSkillStateContext)
      ) {
        const backgroundSkillStateContext =
          this.autoSkillRoutingStateService.createBackgroundCheckContext(postTurnSkillStateContext);
        await this.autoSkillRoutingStateService.markBackgroundCheckQueued({
          chatId: prepared.chat.id,
          context: postTurnSkillStateContext
        });
        this.autoSkillRoutingStateService.runBackgroundCheck({
          chatId: prepared.chat.id,
          execute: () =>
            this.sendNativeWebChatTurnService.checkSkillRouting({
              ...nativeTurnInput,
              skillStateContext: backgroundSkillStateContext
            })
        });
      }
      const refreshedChat = await this.assistantChatRepository.findChatById(prepared.chat.id);
      if (refreshedChat === null) {
        throw new NotFoundException("Chat does not exist for this assistant.");
      }

      trace.finish({
        status: "completed",
        outputPreview: finalAssistantContent
      });
      this.logger.log(
        this.composeWebStreamTimingLogLine({
          eventName: "web_stream_timing",
          assistantId: prepared.assistantId,
          threadKey: prepared.chat.surfaceThreadKey,
          clientTurnId: prepared.clientTurnId ?? null,
          firstDeltaMs: primaryFirstDeltaMs,
          totalRuntimeMs: Date.now() - primaryRuntimeStartedAt,
          cadence: cadenceState,
          sseWriterStatsSummary: callbacks.getSseWriterStatsSummary?.() ?? null,
          extraFields: null
        })
      );
      return {
        status: "completed",
        transport: {
          chat: {
            id: refreshedChat.id,
            assistantId: refreshedChat.assistantId,
            surface: refreshedChat.surface,
            surfaceThreadKey: refreshedChat.surfaceThreadKey,
            title: refreshedChat.title,
            deepModeEnabled: refreshedChat.deepModeEnabled,
            skillDecisionState: refreshedChat.skillDecisionState,
            skillCadenceState: refreshedChat.skillCadenceState,
            archivedAt: refreshedChat.archivedAt?.toISOString() ?? null,
            lastMessageAt: refreshedChat.lastMessageAt?.toISOString() ?? null,
            createdAt: refreshedChat.createdAt.toISOString(),
            updatedAt: refreshedChat.updatedAt.toISOString()
          },
          userMessage: prepared.userMessage,
          assistantMessage: {
            id: assistantMessage.id,
            chatId: assistantMessage.chatId,
            assistantId: assistantMessage.assistantId,
            author: assistantMessage.author,
            content: finalAssistantContent,
            attachments: attachmentStates,
            createdAt: assistantMessage.createdAt.toISOString()
          },
          ...(followUpAssistantMessage === null ? {} : { followUpAssistantMessage }),
          activeMediaJobs,
          runtime: {
            respondedAt: respondedAt ?? new Date().toISOString(),
            degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
            quotaFallbackReason: prepared.quotaDegradeReason,
            quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
            ...(turnRouting === undefined ? {} : { turnRouting })
          }
        }
      };
    } catch (error) {
      if (prepared.clientTurnId !== undefined) {
        await this.bindingRepository.releaseWebTurnProcessing(
          prepared.assistantId,
          WEB_TURN_PROVIDER_KEY,
          WEB_TURN_SURFACE_TYPE,
          prepared.clientTurnId
        );
      }
      const normalized = toAssistantInboundFailurePayload(error);
      if (collectedMedia.length > 0 && !mediaDeliveryCompleted) {
        await this.mediaDeliveryService.markUndeliveredArtifactsReconciliationRequired({
          assistantId: prepared.assistantId,
          artifacts: collectedMedia,
          reason: "web_stream_delivery_not_completed"
        });
      }
      const interruptedOutcome = await this.persistInterruptedOutcome(
        prepared,
        accumulated,
        respondedAt
      );
      if (prepared.clientTurnId !== undefined && this.webChatTurnAttemptService) {
        await this.webChatTurnAttemptService.markInterrupted({
          assistantId: prepared.assistantId,
          userId: prepared.userId,
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          clientTurnId: prepared.clientTurnId,
          assistantMessageId: interruptedOutcome.transport?.assistantMessage.id ?? null,
          code: normalized.code,
          message: normalized.message
        });
      }
      trace.finish({
        status: "failed",
        outputPreview: accumulated
      });
      this.logger.warn(
        this.composeWebStreamTimingLogLine({
          eventName: "web_stream_timing_failed",
          assistantId: prepared.assistantId,
          threadKey: prepared.chat.surfaceThreadKey,
          clientTurnId: prepared.clientTurnId ?? null,
          firstDeltaMs: primaryFirstDeltaMs,
          totalRuntimeMs: Date.now() - primaryRuntimeStartedAt,
          cadence: cadenceState,
          sseWriterStatsSummary: callbacks.getSseWriterStatsSummary?.() ?? null,
          extraFields: `code=${normalized.code}`
        })
      );
      return {
        status: "failed",
        transport: interruptedOutcome.transport,
        code: normalized.code,
        message: normalized.message
      };
    }
  }

  private buildNativeStreamTurnInput(input: {
    assistantId: string;
    publishedVersionId: string;
    runtimeTier: RuntimeTier;
    surfaceThreadKey: string;
    userId: string;
    workspaceId: string;
    userMessageId: string;
    userMessage: string;
    attachments: StreamNativeWebChatTurnInput["attachments"];
    openMediaJobs?: StreamNativeWebChatTurnInput["openMediaJobs"];
    userTimezone: string;
    currentTimeIso: string;
    skillStateContext?: StreamNativeWebChatTurnInput["skillStateContext"];
    deepMode?: StreamNativeWebChatTurnInput["deepMode"];
    modelRoleOverride?: StreamNativeWebChatTurnInput["modelRoleOverride"];
    providerOverride?: "openai" | "anthropic";
    modelOverride?: string;
  }): StreamNativeWebChatTurnInput {
    return {
      assistantId: input.assistantId,
      publishedVersionId: input.publishedVersionId,
      runtimeTier: input.runtimeTier,
      surfaceThreadKey: input.surfaceThreadKey,
      userId: input.userId,
      workspaceId: input.workspaceId,
      userMessageId: input.userMessageId,
      userMessage: input.userMessage,
      attachments: input.attachments,
      ...(input.openMediaJobs === undefined ? {} : { openMediaJobs: input.openMediaJobs }),
      userTimezone: input.userTimezone,
      currentTimeIso: input.currentTimeIso,
      ...(input.skillStateContext === undefined
        ? {}
        : { skillStateContext: input.skillStateContext }),
      ...(input.deepMode === undefined ? {} : { deepMode: input.deepMode }),
      ...(input.modelRoleOverride === undefined
        ? {}
        : { modelRoleOverride: input.modelRoleOverride }),
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    };
  }

  private logWebRuntimeRoute(input: {
    route: "stream";
    assistantId: string;
    surfaceThreadKey: string;
    clientTurnId?: string;
  }): void {
    this.logger.log(
      `web_runtime_route route=${input.route} mode=native primary=native shadow=none assistantId=${
        input.assistantId
      } threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId ?? "n/a"}`
    );
  }

  private executeRuntimeStream(input: {
    nativeTurnInput: StreamNativeWebChatTurnInput;
    signal?: AbortSignal;
    traceEnabled?: boolean;
  }): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk> {
    const options: { signal?: AbortSignal; traceEnabled?: boolean } = {};
    if (input.signal !== undefined) {
      options.signal = input.signal;
    }
    if (input.traceEnabled === true) {
      options.traceEnabled = true;
    }
    return this.streamNativeWebChatTurnService.execute(input.nativeTurnInput, options);
  }

  private async shouldRetryAfterCompactionWait(
    error: unknown,
    assistantId: string,
    surfaceThreadKey: string
  ): Promise<boolean> {
    if (
      this.backgroundCompactionQueueService === undefined ||
      toAssistantInboundFailurePayload(error).code !== "native_runtime_conflict"
    ) {
      return false;
    }

    const waitResult = await this.backgroundCompactionQueueService.waitForActiveThreadCompaction({
      assistantId,
      channel: "web",
      externalThreadKey: surfaceThreadKey
    });
    return waitResult.readyForRetry;
  }

  private async streamRuntimeAttempt(input: {
    attempt: number;
    isLastAttempt: boolean;
    prepared: StreamWebChatTurnPrepared;
    nativeTurnInput: StreamNativeWebChatTurnInput;
    traceEnabled: boolean;
    cadenceState: DeltaCadenceState | null;
    accumulatedSoFar: string;
    callbacks: {
      isClientAborted: () => boolean;
      clientAbortSignal?: AbortSignal;
      onDelta: (delta: string, accumulated: string) => void;
      onThinking: (delta: string, accumulated: string) => void;
      onTool?: (payload: {
        phase: "start" | "end";
        toolName: string;
        toolCallId: string;
        isError: boolean;
      }) => void;
      onActivity?: (payload: {
        source: "skill" | "user" | "product" | "web";
        phase: "start";
        resultCount: number;
        skillName?: string | null;
        skillIconEmoji?: string | null;
      }) => void;
      onDone: (respondedAt: string) => void;
    };
    trace: OverviewLatencyTraceHandle;
    primaryRuntimeStartedAt: number;
    primaryFirstDeltaMs: number | null;
    onStallReport: (report: CadenceWatchdogStallReport) => void;
  }): Promise<{
    status: "completed" | "client-aborted" | "stalled" | "retry_after_compaction";
    accumulated: string;
    respondedAt: string | null;
    usageAccounting: AssistantRuntimeWebChatTurnStreamChunk["usageAccounting"];
    turnRouting: AssistantRuntimeWebChatTurnStreamChunk["turnRouting"];
    deferredMediaJobs: AssistantRuntimeWebChatTurnStreamChunk["deferredMediaJobs"];
    collectedMedia: RuntimeMediaArtifact[];
    primaryFirstDeltaMs: number | null;
    toolEventCount: number;
    stallReport: CadenceWatchdogStallReport | null;
  }> {
    let accumulated = input.attempt === 1 ? input.accumulatedSoFar : "";
    let respondedAt: string | null = null;
    let usageAccounting: AssistantRuntimeWebChatTurnStreamChunk["usageAccounting"] = undefined;
    let turnRouting: AssistantRuntimeWebChatTurnStreamChunk["turnRouting"] = null;
    let deferredMediaJobs: AssistantRuntimeWebChatTurnStreamChunk["deferredMediaJobs"] = undefined;
    const collectedMedia: RuntimeMediaArtifact[] = [];
    let primaryFirstDeltaMs = input.primaryFirstDeltaMs;
    let toolEventCount = 0;
    let capturedStallReport: CadenceWatchdogStallReport | null = null;

    const internalAbort = new AbortController();
    const watchdog = createCadenceWatchdog(DEFAULT_CADENCE_THRESHOLDS, (report) => {
      capturedStallReport = report;
      input.onStallReport(report);
      this.logger.warn(
        this.composeWebStreamStallLogLine({
          eventName: "web_stream_stall_detected",
          prepared: input.prepared,
          attempt: input.attempt,
          report,
          accumulatedLen: accumulated.length
        })
      );
      // Aborting the runtime fetch makes the for-await loop throw an AbortError
      // which we catch below and translate into a "stalled" outcome.
      internalAbort.abort();
    });

    const combinedSignal = combineAbortSignals([
      input.callbacks.clientAbortSignal,
      internalAbort.signal
    ]);

    watchdog.arm();
    try {
      for await (const chunk of this.executeRuntimeStream({
        nativeTurnInput: input.nativeTurnInput,
        traceEnabled: input.traceEnabled,
        ...(combinedSignal === undefined ? {} : { signal: combinedSignal })
      })) {
        if (input.callbacks.isClientAborted()) {
          return {
            status: "client-aborted",
            accumulated,
            respondedAt,
            usageAccounting,
            turnRouting,
            deferredMediaJobs,
            collectedMedia,
            primaryFirstDeltaMs,
            toolEventCount,
            stallReport: capturedStallReport
          };
        }

        if (chunk.type === "delta" && typeof chunk.delta === "string") {
          if (accumulated.length === 0 && input.attempt === 1) {
            input.trace.stage("first_delta");
          }
          if (primaryFirstDeltaMs === null) {
            primaryFirstDeltaMs = Date.now() - input.primaryRuntimeStartedAt;
          }
          if (input.cadenceState !== null) {
            recordDeltaArrival(input.cadenceState);
          }
          watchdog.recordDelta();
          accumulated += chunk.delta;
          input.callbacks.onDelta(chunk.delta, accumulated);
        }

        if (
          chunk.type === "thinking" &&
          typeof chunk.delta === "string" &&
          typeof chunk.accumulated === "string"
        ) {
          watchdog.recordActivity();
          input.callbacks.onThinking(chunk.delta, chunk.accumulated);
        }

        if (
          chunk.type === "tool" &&
          (chunk.toolPhase === "start" || chunk.toolPhase === "end") &&
          typeof chunk.toolName === "string" &&
          typeof chunk.toolCallId === "string"
        ) {
          toolEventCount += 1;
          if (input.cadenceState !== null) {
            recordToolPhase(input.cadenceState, chunk.toolPhase);
          }
          // Suspend the silent watchdog for the tool's execution span instead
          // of treating tool phases as generic activity. Long tools
          // (image_generate, video_generate, slow web_fetch) routinely take
          // 15–60 s with no intermediate chunks; the previous behavior reset
          // the silent timer on tool_started but then fired ~`silentMs` later
          // mid-tool, aborted the runtime, and surfaced the false-positive
          // "Streaming ended before a full answer was completed." banner.
          if (chunk.toolPhase === "start") {
            watchdog.recordToolStarted();
          } else {
            watchdog.recordToolFinished();
          }
          if (input.prepared.clientTurnId !== undefined && this.webChatTurnAttemptService) {
            await this.webChatTurnAttemptService.markCurrentActivity({
              assistantId: input.prepared.assistantId,
              userId: input.prepared.userId,
              surfaceThreadKey: input.prepared.chat.surfaceThreadKey,
              clientTurnId: input.prepared.clientTurnId,
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              phase: chunk.toolPhase,
              isError: chunk.isError === true
            });
          }
          input.callbacks.onTool?.({
            phase: chunk.toolPhase,
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            isError: chunk.isError === true
          });
        }

        if (chunk.type === "media" && Array.isArray(chunk.media)) {
          watchdog.recordActivity();
          collectedMedia.push(...chunk.media);
        }

        if (
          chunk.type === "activity" &&
          (chunk.activitySource === "skill" ||
            chunk.activitySource === "user" ||
            chunk.activitySource === "product" ||
            chunk.activitySource === "web") &&
          chunk.activityPhase === "start"
        ) {
          watchdog.recordActivity();
          input.callbacks.onActivity?.({
            source: chunk.activitySource,
            phase: chunk.activityPhase,
            resultCount: Math.max(0, chunk.activityResultCount ?? 0),
            ...(chunk.activitySkillName === undefined
              ? {}
              : { skillName: chunk.activitySkillName }),
            ...(chunk.activitySkillIconEmoji === undefined
              ? {}
              : { skillIconEmoji: chunk.activitySkillIconEmoji })
          });
        }

        if (chunk.type === "done" && typeof chunk.respondedAt === "string") {
          watchdog.recordActivity();
          respondedAt = chunk.respondedAt;
          usageAccounting = chunk.usageAccounting;
          turnRouting = chunk.turnRouting ?? null;
          deferredMediaJobs = chunk.deferredMediaJobs;
          if (chunk.runtimeTrace) {
            input.trace.attachExternalTrace(chunk.runtimeTrace);
          }
          input.trace.stage("runtime_done");
          input.callbacks.onDone(chunk.respondedAt);
        }
      }
    } catch (error) {
      // If the abort came from our internal watchdog (and not the client), this
      // is a stall, not a real error. Propagate everything else upward so the
      // outer `try/catch` in `streamToCompletion` can persist a partial state
      // and emit `web_stream_timing_failed`.
      if (
        watchdog.hasStalled() &&
        internalAbort.signal.aborted &&
        !input.callbacks.isClientAborted() &&
        isAbortLikeError(error)
      ) {
        return {
          status: "stalled",
          accumulated,
          respondedAt,
          usageAccounting,
          turnRouting,
          deferredMediaJobs,
          collectedMedia,
          primaryFirstDeltaMs,
          toolEventCount,
          stallReport: capturedStallReport
        };
      }
      const safeToRetryAfterConflict =
        accumulated.length === 0 &&
        respondedAt === null &&
        collectedMedia.length === 0 &&
        toolEventCount === 0;
      if (
        safeToRetryAfterConflict &&
        (await this.shouldRetryAfterCompactionWait(
          error,
          input.prepared.assistantId,
          input.prepared.chat.surfaceThreadKey
        ))
      ) {
        return {
          status: "retry_after_compaction",
          accumulated,
          respondedAt,
          usageAccounting,
          turnRouting,
          deferredMediaJobs,
          collectedMedia,
          primaryFirstDeltaMs,
          toolEventCount,
          stallReport: capturedStallReport
        };
      }
      throw error;
    } finally {
      watchdog.dispose();
    }

    if (input.callbacks.isClientAborted()) {
      return {
        status: "client-aborted",
        accumulated,
        respondedAt,
        usageAccounting,
        turnRouting,
        deferredMediaJobs,
        collectedMedia,
        primaryFirstDeltaMs,
        toolEventCount,
        stallReport: capturedStallReport
      };
    }

    if (watchdog.hasStalled() && !input.isLastAttempt) {
      // Watchdog fired right as the stream cleanly finished; treat as completion
      // unless the result is unusable (caller checks accumulated emptiness).
      return {
        status: "completed",
        accumulated,
        respondedAt,
        usageAccounting,
        turnRouting,
        deferredMediaJobs,
        collectedMedia,
        primaryFirstDeltaMs,
        toolEventCount,
        stallReport: capturedStallReport
      };
    }

    return {
      status: "completed",
      accumulated,
      respondedAt,
      usageAccounting,
      turnRouting,
      deferredMediaJobs,
      collectedMedia,
      primaryFirstDeltaMs,
      toolEventCount,
      stallReport: capturedStallReport
    };
  }

  private composeWebStreamStallLogLine(input: {
    eventName:
      | "web_stream_stall_detected"
      | "web_stream_stall_recovery_attempted"
      | "web_stream_stall_recovered"
      | "web_stream_stall_unrecovered";
    prepared: StreamWebChatTurnPrepared;
    attempt: number;
    report: CadenceWatchdogStallReport | null;
    accumulatedLen: number;
    extraReason?: string;
  }): string {
    const reason = input.report?.reason ?? "unknown";
    const silent = input.report?.silentMs === undefined ? "n/a" : String(input.report.silentMs);
    const avg =
      input.report?.rollingAvgMs === undefined ? "n/a" : String(input.report.rollingAvgMs);
    const window =
      input.report?.rollingWindow === undefined ? "n/a" : String(input.report.rollingWindow);
    const observed = input.report?.observedGaps ?? 0;
    const extra = input.extraReason === undefined ? "" : ` extraReason=${input.extraReason}`;
    return (
      `${input.eventName} assistantId=${input.prepared.assistantId} ` +
      `threadKey=${input.prepared.chat.surfaceThreadKey} ` +
      `clientTurnId=${input.prepared.clientTurnId ?? "n/a"} ` +
      `attempt=${input.attempt} reason=${reason} silentMs=${silent} ` +
      `rollingAvgMs=${avg} rollingWindow=${window} observedGaps=${String(observed)} ` +
      `accumulatedLen=${String(input.accumulatedLen)}${extra}`
    );
  }

  private composeWebStreamTimingLogLine(input: {
    eventName: "web_stream_timing" | "web_stream_timing_failed";
    assistantId: string;
    threadKey: string;
    clientTurnId: string | null;
    firstDeltaMs: number | null;
    totalRuntimeMs: number;
    cadence: DeltaCadenceState | null;
    sseWriterStatsSummary: string | null;
    extraFields: string | null;
  }): string {
    const baseFields = `assistantId=${input.assistantId} threadKey=${input.threadKey} clientTurnId=${input.clientTurnId ?? "n/a"} firstDeltaMs=${input.firstDeltaMs ?? -1} totalRuntimeMs=${String(input.totalRuntimeMs)}`;
    const cadenceFields = input.cadence === null ? "" : ` ${formatDeltaCadence(input.cadence)}`;
    const sseFields =
      input.sseWriterStatsSummary === null ? "" : ` sse_${input.sseWriterStatsSummary}`;
    const extraFields = input.extraFields === null ? "" : ` ${input.extraFields}`;
    return `${input.eventName} ${baseFields}${cadenceFields}${sseFields}${extraFields}`;
  }

  private async claimOrReplayWebTurn(
    userId: string,
    request: StreamWebChatTurnRequest
  ): Promise<AssistantWebChatTurnState | null> {
    const clientTurnId = request.clientTurnId;
    if (clientTurnId === undefined) {
      return null;
    }
    const resolved =
      await this.resolveAssistantInboundRuntimeContextService.resolveByUserId(userId);
    const claimedAt = new Date();
    const claim = this.webChatTurnAttemptService
      ? await this.webChatTurnAttemptService.claim({
          assistantId: resolved.assistantId,
          userId,
          workspaceId: resolved.assistant.workspaceId,
          surfaceThreadKey: request.surfaceThreadKey,
          clientTurnId,
          claimedAt,
          staleAfterMs: WEB_TURN_CLAIM_STALE_MS
        })
      : await this.bindingRepository.claimWebTurnProcessing(
          resolved.assistantId,
          WEB_TURN_PROVIDER_KEY,
          WEB_TURN_SURFACE_TYPE,
          clientTurnId,
          claimedAt,
          WEB_TURN_CLAIM_STALE_MS
        );
    if (claim === "claimed") {
      return null;
    }
    if (claim === "duplicate_handled") {
      const completed = this.webChatTurnAttemptService
        ? await this.webChatTurnAttemptService.getCompletedReplay({
            assistantId: resolved.assistantId,
            userId,
            clientTurnId
          })
        : await this.bindingRepository.getCompletedWebTurnProcessing(
            resolved.assistantId,
            WEB_TURN_PROVIDER_KEY,
            WEB_TURN_SURFACE_TYPE,
            clientTurnId
          );
      return completed ? this.rebuildStoredWebTurnState(resolved.assistantId, completed) : null;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < WEB_TURN_REPLAY_WAIT_MS) {
      const completed = this.webChatTurnAttemptService
        ? await this.webChatTurnAttemptService.getCompletedReplay({
            assistantId: resolved.assistantId,
            userId,
            clientTurnId
          })
        : await this.bindingRepository.getCompletedWebTurnProcessing(
            resolved.assistantId,
            WEB_TURN_PROVIDER_KEY,
            WEB_TURN_SURFACE_TYPE,
            clientTurnId
          );
      if (completed !== null) {
        return this.rebuildStoredWebTurnState(resolved.assistantId, completed);
      }
      await delay(WEB_TURN_REPLAY_POLL_MS);
    }

    throw createAssistantInboundConflict(
      "web_turn_inflight",
      "This web turn is already being processed."
    );
  }

  private async rebuildStoredWebTurnState(
    assistantId: string,
    state: CompletedWebTurnReplayState
  ): Promise<AssistantWebChatTurnState> {
    const chat = await this.assistantChatRepository.findChatById(state.chatId);
    const userMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
      state.userMessageId,
      assistantId
    );
    const assistantMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
      state.assistantMessageId,
      assistantId
    );
    const followUpAssistantMessage =
      state.followUpAssistantMessageId === undefined || state.followUpAssistantMessageId === null
        ? null
        : await this.assistantChatRepository.findMessageByIdForAssistant(
            state.followUpAssistantMessageId,
            assistantId
          );
    if (chat === null || userMessage === null || assistantMessage === null) {
      throw new NotFoundException("Stored web turn replay state is incomplete.");
    }

    const [userAttachments, assistantAttachments, followUpAttachments] = await Promise.all([
      this.attachmentRepository.listByMessageId(userMessage.id),
      this.attachmentRepository.listByMessageId(assistantMessage.id),
      followUpAssistantMessage === null
        ? Promise.resolve([])
        : this.attachmentRepository.listByMessageId(followUpAssistantMessage.id)
    ]);
    const activeMediaJobs = await this.assistantMediaJobService.listOpenJobsForWebChat({
      assistantId,
      userId: chat.userId,
      chatId: chat.id
    });

    return {
      chat: {
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
      },
      userMessage: {
        id: userMessage.id,
        chatId: userMessage.chatId,
        assistantId: userMessage.assistantId,
        author: userMessage.author,
        content: userMessage.content,
        attachments: userAttachments.map((attachment) => toAttachmentState(attachment)),
        createdAt: userMessage.createdAt.toISOString()
      },
      assistantMessage: {
        id: assistantMessage.id,
        chatId: assistantMessage.chatId,
        assistantId: assistantMessage.assistantId,
        author: assistantMessage.author,
        content: assistantMessage.content,
        attachments: assistantAttachments.map((attachment) => toAttachmentState(attachment)),
        createdAt: assistantMessage.createdAt.toISOString()
      },
      ...(followUpAssistantMessage === null
        ? {}
        : {
            followUpAssistantMessage: {
              id: followUpAssistantMessage.id,
              chatId: followUpAssistantMessage.chatId,
              assistantId: followUpAssistantMessage.assistantId,
              author: followUpAssistantMessage.author,
              content: followUpAssistantMessage.content,
              attachments: followUpAttachments.map((attachment) => toAttachmentState(attachment)),
              createdAt: followUpAssistantMessage.createdAt.toISOString()
            }
          }),
      activeMediaJobs,
      runtime: {
        respondedAt: state.respondedAt,
        degradedByQuotaFallback: state.degradedByQuotaFallback,
        quotaFallbackReason:
          state.quotaFallbackReason === "token_budget_limit_reached"
            ? "token_budget_limit_reached"
            : null,
        quotaFallbackModel: state.quotaFallbackModel,
        ...(state.turnRouting === undefined ? {} : { turnRouting: state.turnRouting })
      }
    };
  }

  private async persistFinalAssistantContentIfNeeded(input: {
    assistantMessage: {
      id: string;
      chatId: string;
      assistantId: string;
      author: "assistant" | "user" | "system";
      content: string;
      createdAt: Date;
    };
    assistantId: string;
    assistantText: string;
    attemptedArtifactCount: number;
    deliveredAttachmentCount: number;
    deliveredAttachmentFilenames: string[];
    locale: string | null;
  }): Promise<string> {
    const finalAssistantContent = applyFinalDeliveryHonestyCorrection({
      assistantText: input.assistantText,
      attemptedArtifactCount: input.attemptedArtifactCount,
      deliveredAttachmentCount: input.deliveredAttachmentCount,
      deliveredAttachmentFilenames: input.deliveredAttachmentFilenames,
      locale: input.locale
    });
    if (finalAssistantContent === input.assistantMessage.content) {
      return finalAssistantContent;
    }
    const updated = await this.assistantChatRepository.updateMessageContent(
      input.assistantMessage.id,
      input.assistantId,
      finalAssistantContent
    );
    if (updated === null) {
      this.logger.warn(
        `Failed to persist final delivery-honesty correction for assistant message "${input.assistantMessage.id}".`
      );
    }
    return finalAssistantContent;
  }

  private async persistInterruptedOutcome(
    prepared: StreamWebChatTurnPrepared,
    partialOutput: string,
    respondedAt: string | null
  ): Promise<StreamWebChatTurnOutcomeInterrupted> {
    const cleanedPartial = partialOutput.trim();
    if (cleanedPartial.length === 0) {
      return {
        status: "interrupted",
        transport: null
      };
    }

    const partialAssistantMessage = await this.assistantChatRepository.createMessage({
      chatId: prepared.chat.id,
      assistantId: prepared.assistantId,
      author: "assistant",
      content: cleanedPartial
    });
    const systemMessage = await this.assistantChatRepository.createMessage({
      chatId: prepared.chat.id,
      assistantId: prepared.assistantId,
      author: "system",
      content:
        "Streaming ended before completion. Assistant partial output above is preserved as-is."
    });
    const refreshedChat = await this.assistantChatRepository.findChatById(prepared.chat.id);
    if (refreshedChat === null) {
      throw new NotFoundException("Chat does not exist for this assistant.");
    }
    await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
      assistant: prepared.assistant,
      userContent: prepared.userMessage.content,
      assistantContent: cleanedPartial,
      source: "web_chat_turn_stream_partial"
    });

    return {
      status: "interrupted",
      transport: {
        chat: {
          id: refreshedChat.id,
          assistantId: refreshedChat.assistantId,
          surface: refreshedChat.surface,
          surfaceThreadKey: refreshedChat.surfaceThreadKey,
          title: refreshedChat.title,
          deepModeEnabled: refreshedChat.deepModeEnabled,
          skillDecisionState: refreshedChat.skillDecisionState,
          skillCadenceState: refreshedChat.skillCadenceState,
          archivedAt: refreshedChat.archivedAt?.toISOString() ?? null,
          lastMessageAt: refreshedChat.lastMessageAt?.toISOString() ?? null,
          createdAt: refreshedChat.createdAt.toISOString(),
          updatedAt: refreshedChat.updatedAt.toISOString()
        },
        userMessage: prepared.userMessage,
        assistantMessage: {
          id: partialAssistantMessage.id,
          chatId: partialAssistantMessage.chatId,
          assistantId: partialAssistantMessage.assistantId,
          author: partialAssistantMessage.author,
          content: partialAssistantMessage.content,
          attachments: [],
          createdAt: partialAssistantMessage.createdAt.toISOString()
        },
        runtime: {
          respondedAt: respondedAt ?? systemMessage.createdAt.toISOString(),
          degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
          quotaFallbackReason: prepared.quotaDegradeReason,
          quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
          turnRouting: null
        }
      }
    };
  }
}

interface DeltaCadenceState {
  lastDeltaAtMs: number | null;
  lastToolEndAtMs: number | null;
  toolStartCount: number;
  toolEndCount: number;
  interDeltaSamplesMs: number[];
  postToolFirstDeltaSamplesMs: number[];
}

function createDeltaCadenceState(): DeltaCadenceState {
  return {
    lastDeltaAtMs: null,
    lastToolEndAtMs: null,
    toolStartCount: 0,
    toolEndCount: 0,
    interDeltaSamplesMs: [],
    postToolFirstDeltaSamplesMs: []
  };
}

function recordDeltaArrival(state: DeltaCadenceState): void {
  const nowMs = Date.now();
  if (state.lastDeltaAtMs !== null) {
    state.interDeltaSamplesMs.push(nowMs - state.lastDeltaAtMs);
  }
  if (state.lastToolEndAtMs !== null) {
    state.postToolFirstDeltaSamplesMs.push(nowMs - state.lastToolEndAtMs);
    state.lastToolEndAtMs = null;
  }
  state.lastDeltaAtMs = nowMs;
}

function recordToolPhase(state: DeltaCadenceState, phase: "start" | "end"): void {
  if (phase === "start") {
    state.toolStartCount += 1;
    return;
  }
  state.toolEndCount += 1;
  state.lastToolEndAtMs = Date.now();
}

function formatDeltaCadence(state: DeltaCadenceState): string {
  const interDelta = summarizeSamples(state.interDeltaSamplesMs);
  const postTool = summarizeSamples(state.postToolFirstDeltaSamplesMs);
  return [
    `toolStarts=${String(state.toolStartCount)}`,
    `toolEnds=${String(state.toolEndCount)}`,
    `interDeltaCount=${String(interDelta.count)}`,
    `interDeltaMaxMs=${String(interDelta.maxMs)}`,
    `interDeltaP95Ms=${String(interDelta.p95Ms)}`,
    `postToolFirstDeltaCount=${String(postTool.count)}`,
    `postToolFirstDeltaMaxMs=${String(postTool.maxMs)}`
  ].join(" ");
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  const controller = new AbortController();
  const onAbort = (event: Event): void => {
    const reason = (event.target as AbortSignal | null)?.reason;
    controller.abort(reason);
  };
  for (const s of live) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

function isAbortLikeError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof e.name === "string" && (e.name === "AbortError" || e.name === "AbortException")) {
    return true;
  }
  if (typeof e.code === "string" && (e.code === "ABORT_ERR" || e.code === "ECONNRESET")) {
    return true;
  }
  if (
    typeof e.message === "string" &&
    /\babort(ed)?\b|operation was aborted|terminated/i.test(e.message)
  ) {
    return true;
  }
  return false;
}

function summarizeSamples(samplesMs: number[]): {
  count: number;
  maxMs: number;
  p95Ms: number;
} {
  if (samplesMs.length === 0) {
    return { count: 0, maxMs: 0, p95Ms: 0 };
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const lastIndex = sorted.length - 1;
  const maxMs = sorted[lastIndex] ?? 0;
  const p95Index = Math.min(lastIndex, Math.floor(sorted.length * 0.95));
  const p95Ms = sorted[p95Index] ?? maxMs;
  return { count: samplesMs.length, maxMs, p95Ms };
}
