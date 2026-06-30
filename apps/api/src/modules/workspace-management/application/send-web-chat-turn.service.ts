import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  chatModeToDeepModeEnabled,
  isAssistantChatMode,
  type AssistantChatMode
} from "../domain/assistant-chat.entity";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository,
  type CompletedWebTurnReplayState
} from "../domain/assistant-channel-surface-binding.repository";
import { type AssistantRuntimeWebChatTurnResult } from "./assistant-runtime.facade";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { deriveEngagementSummary, type AssistantWebChatTurnState } from "./web-chat.types";
import { readPersistedDocumentLinkMetadata } from "./read-attachment-document-link";
import { PrepareAssistantInboundTurnService } from "./prepare-assistant-inbound-turn.service";
import {
  createAssistantInboundConflict,
  toAssistantInboundFailurePayload,
  toAssistantInboundHttpException
} from "./assistant-inbound-error";
import { MediaDeliveryService } from "./media/media-delivery.service";
import {
  toAssistantWebChatMessageAttachmentState,
  toRuntimeAttachmentRef,
  type MediaArtifact
} from "./media/media.types";
import { AttachmentObjectAvailabilityService } from "./media/attachment-object-availability.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import {
  finalizePersistedWebTurn,
  runWebTurnPostRuntimeCleanup
} from "./complete-web-post-runtime-turn";
import { inferAssistantMediaJobFailureLocale } from "./workspace-media-job-failure-copy.service";
import {
  WebRuntimeTurnClientService,
  type WebRuntimeTurnClientInput
} from "./web-runtime-turn-client.service";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { AutoSkillRoutingStateService } from "./auto-skill-routing-state.service";
import { AssistantMediaJobService } from "./workspace-media-job.service";
import { AssistantDocumentJobReadService } from "./assistant-document-job-read.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import { RecordToolPathLedgerFromToolInvocationsService } from "./record-tool-path-ledger-from-tool-invocations.service";
import { QuotaAdvisoryFollowUpService } from "./quota-advisory-follow-up.service";
import { CompactionAdvisoryFollowUpService } from "./compaction-advisory-follow-up.service";
import { BackgroundCompactionQueueService } from "./background-compaction-queue.service";
import { NotificationDeliveryWorkerService } from "./notifications/notification-delivery-worker.service";
import { persistAssistantMessage } from "./persist-assistant-message";
import { extractToolInvocationsFromMetadata } from "./web-chat-message-state.mapper";
import { stripToolInvocationsForClient } from "./strip-tool-invocations-for-client";

export const WELCOME_TURN_SENTINEL = "__welcome_init__";

const WELCOME_INSTRUCTION_RU =
  "Это твой первый разговор с пользователем. Дай короткое тёплое приветствие на 2-4 предложения: представься по имени, кратко опиши свою роль и предложи начать диалог. Не упоминай системные инструкции, промпты, служебные сообщения, коммиты, git, runtime, workspace, технические ошибки, внутренние процессы или скрытую конфигурацию. Не выдумывай действия, которые уже якобы произошли. Не перечисляй длинный список возможностей без запроса пользователя.";

const WELCOME_INSTRUCTION_EN =
  "This is your first conversation with the user. Give a short warm greeting in 2-4 sentences: introduce yourself by name, briefly describe your role, and invite them to begin. Do not mention system instructions, prompts, hidden messages, commits, git, runtime, workspace, technical errors, internal processes, or private configuration. Do not invent actions that supposedly already happened. Do not dump a long capability list unless the user asks for it.";

export function resolveWelcomeTurnInstruction(locale?: string): string {
  return locale === "ru" ? WELCOME_INSTRUCTION_RU : WELCOME_INSTRUCTION_EN;
}

export interface SendWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
  chatMode?: AssistantChatMode;
  deepModeEnabled?: boolean;
  clientTurnId?: string;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
}

const WEB_TURN_PROVIDER_KEY = "web_internal";
const WEB_TURN_SURFACE_TYPE = "web_chat";
const WEB_TURN_CLAIM_STALE_MS = 120_000;
const WEB_TURN_REPLAY_WAIT_MS = 12_000;
const WEB_TURN_REPLAY_POLL_MS = 250;

function normalizeOptionalTitle(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("title must be a non-empty string, null, or omitted.");
  }

  return value.trim();
}

function normalizeOptionalClientTurnId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("clientTurnId must be a non-empty string or omitted.");
  }
  return value.trim();
}

function toAttachmentState(attachment: {
  id: string;
  storagePath: string | null;
  thumbnailStoragePath: string | null;
  posterStoragePath: string | null;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  processingStatus: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}) {
  return toAssistantWebChatMessageAttachmentState({
    id: attachment.id,
    storagePath: attachment.storagePath,
    thumbnailStoragePath: attachment.thumbnailStoragePath,
    posterStoragePath: attachment.posterStoragePath,
    attachmentType: attachment.attachmentType,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    processingStatus: attachment.processingStatus,
    metadata: attachment.metadata,
    createdAt: attachment.createdAt,
    documentLink: readPersistedDocumentLinkMetadata(attachment.metadata)
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWelcomeUserMessage(
  welcomeFirstTurnPrompt: string | null,
  welcomeLocale?: string
): string {
  return welcomeFirstTurnPrompt ?? resolveWelcomeTurnInstruction(welcomeLocale);
}

@Injectable()
export class SendWebChatTurnService {
  private readonly logger = new Logger(SendWebChatTurnService.name);

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly webRuntimeTurnClientService: WebRuntimeTurnClientService,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService,
    private readonly recordToolPathLedgerFromToolInvocationsService: RecordToolPathLedgerFromToolInvocationsService,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly assistantDocumentJobReadService: AssistantDocumentJobReadService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService,
    private readonly attachmentObjectAvailabilityService: AttachmentObjectAvailabilityService,
    private readonly autoSkillRoutingStateService: AutoSkillRoutingStateService,
    private readonly notificationDeliveryWorkerService: NotificationDeliveryWorkerService,
    @Optional()
    private readonly quotaAdvisoryFollowUpService?: QuotaAdvisoryFollowUpService,
    private readonly webChatTurnAttemptService?: WebChatTurnAttemptService,
    @Optional()
    private readonly compactionAdvisoryFollowUpService?: CompactionAdvisoryFollowUpService,
    @Optional()
    private readonly backgroundCompactionQueueService?: BackgroundCompactionQueueService
  ) {}

  parseInput(payload: unknown): SendWebChatTurnRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Web chat payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const surfaceThreadKey = body.surfaceThreadKey;
    const message = body.message;
    const title = normalizeOptionalTitle(body.title);
    const chatMode =
      body.chatMode === undefined
        ? undefined
        : isAssistantChatMode(body.chatMode)
          ? body.chatMode
          : (() => {
              throw new BadRequestException("chatMode must be one of normal, smart, or project.");
            })();
    const deepModeEnabled =
      chatMode !== undefined
        ? chatModeToDeepModeEnabled(chatMode)
        : body.deepModeEnabled === undefined
          ? undefined
          : body.deepModeEnabled === true
            ? true
            : body.deepModeEnabled === false
              ? false
              : (() => {
                  throw new BadRequestException("deepModeEnabled must be boolean or omitted.");
                })();
    if (
      chatMode !== undefined &&
      body.deepModeEnabled !== undefined &&
      body.deepModeEnabled !== deepModeEnabled
    ) {
      throw new BadRequestException("chatMode conflicts with deepModeEnabled.");
    }
    const clientTurnId = normalizeOptionalClientTurnId(body.clientTurnId);
    const welcomeTurn = body.welcomeTurn === true;

    if (typeof surfaceThreadKey !== "string" || surfaceThreadKey.trim().length === 0) {
      throw new BadRequestException("surfaceThreadKey must be a non-empty string.");
    }
    if (!welcomeTurn && (typeof message !== "string" || message.trim().length === 0)) {
      throw new BadRequestException("message must be a non-empty string.");
    }

    const welcomeLocale =
      welcomeTurn && typeof body.welcomeLocale === "string" ? body.welcomeLocale : undefined;

    return {
      surfaceThreadKey: surfaceThreadKey.trim(),
      message: welcomeTurn ? WELCOME_TURN_SENTINEL : (message as string).trim(),
      ...(title !== undefined ? { title } : {}),
      ...(chatMode === undefined ? {} : { chatMode }),
      ...(deepModeEnabled === undefined ? {} : { deepModeEnabled }),
      ...(clientTurnId !== undefined ? { clientTurnId } : {}),
      ...(welcomeTurn ? { welcomeTurn: true } : {}),
      ...(welcomeLocale !== undefined ? { welcomeLocale } : {})
    };
  }

  async execute(
    userId: string,
    request: SendWebChatTurnRequest
  ): Promise<AssistantWebChatTurnState> {
    const replayTransport = await this.claimOrReplayWebTurn(userId, request);
    if (replayTransport !== null) {
      this.overviewLatencyTraceService
        .start({
          traceId: randomUUID(),
          surface: "web_chat_sync",
          threadKey: request.surfaceThreadKey
        })
        .finish({
          status: "replayed",
          outputPreview: replayTransport.assistantMessage.content
        });
      return replayTransport;
    }
    let preparedAssistantId: string | null = null;
    let pendingMediaForReconciliation: MediaArtifact[] = [];
    let mediaDeliveryCompleted = false;
    const trace = this.overviewLatencyTraceService.start({
      traceId: randomUUID(),
      surface: "web_chat_sync",
      threadKey: request.surfaceThreadKey
    });
    try {
      const prepared = await this.prepareAssistantInboundTurnService.execute({
        userId,
        surface: "web_chat",
        surfaceThreadKey: request.surfaceThreadKey,
        message: request.message,
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.chatMode === undefined ? {} : { chatMode: request.chatMode }),
        ...(request.deepModeEnabled === undefined
          ? {}
          : { deepModeEnabled: request.deepModeEnabled }),
        ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId })
      });
      preparedAssistantId = prepared.assistantId;
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
      trace.stage("prepared");

      const userAttachments = await this.attachmentRepository.listByMessageId(
        prepared.userMessage.id
      );
      await this.attachmentObjectAvailabilityService.assertRuntimeReadable({
        assistantId: prepared.assistantId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        messageId: prepared.userMessage.id,
        channel: "web",
        attachments: userAttachments
      });
      const baseMessage = request.welcomeTurn
        ? resolveWelcomeUserMessage(prepared.welcomeFirstTurnPrompt, request.welcomeLocale)
        : prepared.userMessage.content;
      const currentTimeIso = new Date().toISOString();
      const skillStateContext = this.autoSkillRoutingStateService.buildRuntimeContext({
        chatId: prepared.chat.id,
        currentUserMessageId: prepared.userMessage.id,
        decisionState: prepared.chat.skillDecisionState
      });
      const openMediaJobs = await this.assistantMediaJobService.listOpenJobsForChatContext({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        chatId: prepared.chat.id
      });
      const mediaJobDeliveryUpdates =
        (await this.assistantMediaJobService.listJobDeliveryUpdatesForChatContext?.({
          assistantId: prepared.assistantId,
          userId: prepared.userId,
          chatId: prepared.chat.id
        })) ?? [];
      const openDocumentJobs =
        await this.assistantDocumentJobReadService.listOpenJobsForRuntimeContext({
          assistantId: prepared.assistantId,
          userId: prepared.userId,
          chatId: prepared.chat.id
        });
      const documentJobDeliveryUpdates =
        (await this.assistantDocumentJobReadService.listJobDeliveryUpdatesForRuntimeContext?.({
          assistantId: prepared.assistantId,
          userId: prepared.userId,
          chatId: prepared.chat.id
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
      const webRuntimeTurnInput = this.buildWebRuntimeTurnInput({
        assistantId: prepared.assistantId,
        publishedVersionId: prepared.publishedVersionId,
        runtimeTier: prepared.runtimeTier,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userMessage: baseMessage,
        attachments: userAttachments.map((attachment) => toRuntimeAttachmentRef(attachment)),
        ...(openMediaJobs.length === 0 ? {} : { openMediaJobs }),
        ...(openDocumentJobs.length === 0 ? {} : { openDocumentJobs }),
        ...(jobDeliveryUpdates.length === 0 ? {} : { jobDeliveryUpdates }),
        userTimezone: prepared.workspaceTimezone,
        currentTimeIso,
        skillStateContext,
        chatMode: prepared.chat.chatMode,
        deepMode: prepared.chat.deepModeEnabled,
        ...(prepared.quotaDegradeModelOverride
          ? {
              providerOverride: prepared.quotaDegradeModelOverride.provider,
              modelOverride: prepared.quotaDegradeModelOverride.model
            }
          : {}),
        chatId: prepared.chat.id
      });
      this.logWebRuntimeRoute({
        route: "sync",
        assistantId: prepared.assistantId,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId })
      });

      await this.backgroundCompactionQueueService?.waitForActiveThreadCompaction({
        assistantId: prepared.assistantId,
        channel: "web",
        externalThreadKey: prepared.chat.surfaceThreadKey
      });

      let runtimeResponse: AssistantRuntimeWebChatTurnResult;
      try {
        runtimeResponse = await this.webRuntimeTurnClientService.execute(webRuntimeTurnInput);
      } catch (error: unknown) {
        if (
          await this.shouldRetryAfterCompactionWait(
            error,
            prepared.assistantId,
            prepared.chat.surfaceThreadKey
          )
        ) {
          try {
            runtimeResponse = await this.webRuntimeTurnClientService.execute(webRuntimeTurnInput);
          } catch (retryError: unknown) {
            throw toAssistantInboundHttpException(retryError);
          }
        } else {
          throw toAssistantInboundHttpException(error);
        }
      }
      if (runtimeResponse.runtimeTrace) {
        trace.attachExternalTrace(runtimeResponse.runtimeTrace);
      }
      trace.stage("runtime_done");
      pendingMediaForReconciliation = runtimeResponse.media;

      const assistantMessage = await persistAssistantMessage({
        chatRepository: this.assistantChatRepository,
        assistantMediaJobService: this.assistantMediaJobService,
        chatId: prepared.chat.id,
        assistantId: prepared.assistantId,
        content: runtimeResponse.assistantMessage,
        discoveredFilePaths: runtimeResponse.discoveredFilePaths,
        deferredMediaJobCount: runtimeResponse.deferredMediaJobs?.length,
        sourceUserMessageId: prepared.userMessage.id,
        toolInvocations:
          runtimeResponse.toolInvocations !== undefined &&
          runtimeResponse.toolInvocations.length > 0
            ? stripToolInvocationsForClient(runtimeResponse.toolInvocations)
            : undefined
      });
      trace.stage("assistant_message_saved");
      const postRuntime = await finalizePersistedWebTurn({
        logger: this.logger,
        assistantChatRepository: this.assistantChatRepository,
        attachmentRepository: this.attachmentRepository,
        assistantMediaJobService: this.assistantMediaJobService,
        assistantDocumentJobReadService: this.assistantDocumentJobReadService,
        mediaDeliveryService: this.mediaDeliveryService,
        trackWorkspaceQuotaUsageService: this.trackWorkspaceQuotaUsageService,
        notificationDeliveryWorkerService: this.notificationDeliveryWorkerService,
        quotaAdvisoryFollowUpService: this.quotaAdvisoryFollowUpService,
        compactionAdvisoryFollowUpService: this.compactionAdvisoryFollowUpService,
        appendModelCostLedgerEvents: ({ assistantMessageId, respondedAt }) =>
          this.appendModelCostLedgerEvents({
            assistantId: prepared.assistantId,
            workspaceId: prepared.workspaceId,
            userId: prepared.userId,
            assistantMessageId,
            respondedAt,
            traceId: trace.getTraceId(),
            ...(runtimeResponse.usageAccounting === undefined
              ? {}
              : { usageAccounting: runtimeResponse.usageAccounting }),
            ...(runtimeResponse.toolInvocations === undefined
              ? {}
              : { toolInvocations: runtimeResponse.toolInvocations })
          }),
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userContent: baseMessage,
        assistant: prepared.assistant,
        assistantMessage,
        assistantText: runtimeResponse.assistantMessage,
        mediaArtifacts: runtimeResponse.media,
        respondedAt: runtimeResponse.respondedAt,
        ...(runtimeResponse.usageAccounting === undefined
          ? {}
          : { usageAccounting: runtimeResponse.usageAccounting }),
        traceId: trace.getTraceId(),
        quotaSource: "web_chat_turn_sync",
        locale: inferAssistantMediaJobFailureLocale({
          preferredLocale: request.welcomeLocale ?? null,
          sourceText: baseMessage
        }),
        markTraceStage: (stage) => trace.stage(stage)
      });
      mediaDeliveryCompleted = true;

      const persistedSkillState = await runWebTurnPostRuntimeCleanup({
        logger: this.logger,
        replayInput:
          request.clientTurnId === undefined
            ? undefined
            : {
                bindingRepository: this.bindingRepository,
                webChatTurnAttemptService: this.webChatTurnAttemptService,
                assistantId: prepared.assistantId,
                userId: prepared.userId,
                surfaceThreadKey: prepared.chat.surfaceThreadKey,
                clientTurnId: request.clientTurnId,
                chatId: prepared.chat.id,
                userMessageId: prepared.userMessage.id,
                assistantMessageId: assistantMessage.id,
                respondedAt: runtimeResponse.respondedAt,
                degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
                quotaFallbackReason: prepared.quotaDegradeReason,
                quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
                followUpAssistantMessageId: postRuntime.followUpAssistantMessageId,
                ...(runtimeResponse.turnRouting === undefined
                  ? {}
                  : { turnRouting: runtimeResponse.turnRouting }),
                markTraceStage: (stage) => trace.stage(stage)
              },
        skillStateInput: {
          autoSkillRoutingStateService: this.autoSkillRoutingStateService,
          chatId: prepared.chat.id,
          turnRouting: runtimeResponse.turnRouting
        },
        skillStateFallback: {
          skillDecisionState: prepared.chat.skillDecisionState
        },
        skillStateFailureMessage: (error) =>
          `[web-turn] Non-blocking skill-state persistence failed for assistant ${prepared.assistantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        cleanupFailureMessage: (error) =>
          `[web-turn] Post-runtime cleanup failed for assistant ${prepared.assistantId}: ${
            error instanceof Error ? error.message : String(error)
          }`
      });

      trace.finish({
        status: "completed",
        outputPreview: postRuntime.finalAssistantContent
      });
      const finalSkillDecisionState = persistedSkillState.skillDecisionState as Parameters<
        typeof deriveEngagementSummary
      >[0];
      const engagementSummary = deriveEngagementSummary(finalSkillDecisionState);
      return {
        chat: {
          ...prepared.chat,
          skillDecisionState: persistedSkillState.skillDecisionState
        },
        userMessage: prepared.userMessage,
        assistantMessage: {
          id: assistantMessage.id,
          chatId: assistantMessage.chatId,
          assistantId: assistantMessage.assistantId,
          author: assistantMessage.author,
          content: postRuntime.finalAssistantContent,
          attachments: postRuntime.deliveredAttachments,
          createdAt: assistantMessage.createdAt.toISOString(),
          ...(runtimeResponse.toolInvocations !== undefined &&
          runtimeResponse.toolInvocations.length > 0
            ? { toolInvocations: stripToolInvocationsForClient(runtimeResponse.toolInvocations) }
            : {})
        },
        ...(postRuntime.followUpAssistantMessage === null
          ? {}
          : { followUpAssistantMessage: postRuntime.followUpAssistantMessage }),
        activeMediaJobs: postRuntime.activeMediaJobs,
        activeDocumentJobs: postRuntime.activeDocumentJobs,
        ...(engagementSummary !== null ? { engagementSummary } : {}),
        runtime: {
          respondedAt: runtimeResponse.respondedAt,
          degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
          quotaFallbackReason: prepared.quotaDegradeReason,
          quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
          ...(runtimeResponse.turnRouting === undefined
            ? {}
            : { turnRouting: runtimeResponse.turnRouting })
        }
      };
    } catch (error) {
      if (
        preparedAssistantId !== null &&
        pendingMediaForReconciliation.length > 0 &&
        !mediaDeliveryCompleted
      ) {
        await this.mediaDeliveryService.markUndeliveredArtifactsReconciliationRequired({
          assistantId: preparedAssistantId,
          artifacts: pendingMediaForReconciliation,
          reason: "web_sync_delivery_not_completed"
        });
      }
      if (request.clientTurnId !== undefined && preparedAssistantId !== null) {
        if (this.webChatTurnAttemptService !== undefined) {
          await this.webChatTurnAttemptService.markFailed({
            assistantId: preparedAssistantId,
            userId,
            surfaceThreadKey: request.surfaceThreadKey,
            clientTurnId: request.clientTurnId,
            code: "web_turn_failed",
            message: error instanceof Error ? error.message : "Web turn failed."
          });
        }
        await this.bindingRepository.releaseWebTurnProcessing(
          preparedAssistantId,
          WEB_TURN_PROVIDER_KEY,
          WEB_TURN_SURFACE_TYPE,
          request.clientTurnId
        );
      }
      trace.finish({ status: "failed" });
      throw error;
    }
  }

  private async claimOrReplayWebTurn(
    userId: string,
    request: SendWebChatTurnRequest
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
      throw new BadRequestException("Stored web turn replay state is incomplete.");
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
    const activeDocumentJobs = await this.assistantDocumentJobReadService.listOpenJobsForWebChat({
      assistantId,
      userId: chat.userId,
      chatId: chat.id
    });

    const replayEngagementSummary = deriveEngagementSummary(
      chat.skillDecisionState as Parameters<typeof deriveEngagementSummary>[0]
    );
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
        createdAt: assistantMessage.createdAt.toISOString(),
        ...(() => {
          const replayToolInvocations = extractToolInvocationsFromMetadata(
            assistantMessage.metadata
          );
          return replayToolInvocations.length > 0 ? { toolInvocations: replayToolInvocations } : {};
        })()
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
      activeDocumentJobs,
      ...(replayEngagementSummary !== null ? { engagementSummary: replayEngagementSummary } : {}),
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

  private buildWebRuntimeTurnInput(input: {
    assistantId: string;
    publishedVersionId: string;
    runtimeTier: import("./runtime-assignment").RuntimeTier;
    userId: string;
    workspaceId: string;
    surfaceThreadKey: string;
    userMessageId: string;
    userMessage: string;
    attachments: WebRuntimeTurnClientInput["attachments"];
    openMediaJobs?: WebRuntimeTurnClientInput["openMediaJobs"];
    openDocumentJobs?: WebRuntimeTurnClientInput["openDocumentJobs"];
    jobDeliveryUpdates?: WebRuntimeTurnClientInput["jobDeliveryUpdates"];
    userTimezone: string;
    currentTimeIso: string;
    skillStateContext?: WebRuntimeTurnClientInput["skillStateContext"];
    chatMode?: WebRuntimeTurnClientInput["chatMode"];
    deepMode?: WebRuntimeTurnClientInput["deepMode"];
    modelRoleOverride?: WebRuntimeTurnClientInput["modelRoleOverride"];
    providerOverride?: "openai" | "anthropic" | "deepseek";
    modelOverride?: string;
    chatId: string;
  }): WebRuntimeTurnClientInput {
    return {
      assistantId: input.assistantId,
      publishedVersionId: input.publishedVersionId,
      runtimeTier: input.runtimeTier,
      userId: input.userId,
      workspaceId: input.workspaceId,
      surfaceThreadKey: input.surfaceThreadKey,
      userMessageId: input.userMessageId,
      userMessage: input.userMessage,
      attachments: input.attachments,
      ...(input.openMediaJobs === undefined ? {} : { openMediaJobs: input.openMediaJobs }),
      ...(input.openDocumentJobs === undefined ? {} : { openDocumentJobs: input.openDocumentJobs }),
      ...(input.jobDeliveryUpdates === undefined
        ? {}
        : { jobDeliveryUpdates: input.jobDeliveryUpdates }),
      userTimezone: input.userTimezone,
      currentTimeIso: input.currentTimeIso,
      ...(input.skillStateContext === undefined
        ? {}
        : { skillStateContext: input.skillStateContext }),
      ...(input.chatMode === undefined ? {} : { chatMode: input.chatMode }),
      ...(input.deepMode === undefined ? {} : { deepMode: input.deepMode }),
      ...(input.modelRoleOverride === undefined
        ? {}
        : { modelRoleOverride: input.modelRoleOverride }),
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride }),
      chatId: input.chatId
    };
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
        surface: "web",
        purpose: "chat_main_reply",
        source: "web_chat_turn_sync",
        occurredAt: input.respondedAt,
        sourceEventId: input.assistantMessageId,
        requestCorrelationId: input.traceId,
        ...(input.usageAccounting === undefined ? {} : { usageAccounting: input.usageAccounting })
      });
    } catch (error) {
      this.logger.warn(
        `[web-turn] Non-blocking model cost ledger append failed for assistant ${input.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    await this.recordToolPathLedgerFromToolInvocationsService.recordFromToolInvocations({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: "web",
      source: "native_tool_inline",
      assistantMessageId: input.assistantMessageId,
      requestCorrelationId: input.traceId,
      ...(input.toolInvocations === undefined ? {} : { toolInvocations: input.toolInvocations })
    });
  }

  private logWebRuntimeRoute(input: {
    route: "sync";
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
}
