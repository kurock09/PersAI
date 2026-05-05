import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
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
import { type AssistantRuntimeWebChatTurnResult } from "./assistant-runtime.facade";
import { WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT } from "../domain/memory-source-policy";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { AssistantWebChatTurnState } from "./web-chat.types";
import { PrepareAssistantInboundTurnService } from "./prepare-assistant-inbound-turn.service";
import {
  createAssistantInboundConflict,
  toAssistantInboundHttpException
} from "./assistant-inbound-error";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { toRuntimeAttachmentRef, type MediaArtifact } from "./media/media.types";
import { AttachmentObjectAvailabilityService } from "./media/attachment-object-availability.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import { applyFinalDeliveryHonestyCorrection } from "./final-delivery-honesty";
import {
  SendNativeWebChatTurnService,
  type SendNativeWebChatTurnInput
} from "./send-native-web-chat-turn.service";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { AutoSkillRoutingStateService } from "./auto-skill-routing-state.service";
import { AssistantMediaJobService } from "./assistant-media-job.service";

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
    private readonly sendNativeWebChatTurnService: SendNativeWebChatTurnService,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService,
    private readonly attachmentObjectAvailabilityService: AttachmentObjectAvailabilityService,
    private readonly autoSkillRoutingStateService: AutoSkillRoutingStateService,
    private readonly webChatTurnAttemptService?: WebChatTurnAttemptService
  ) {}

  parseInput(payload: unknown): SendWebChatTurnRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Web chat payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const surfaceThreadKey = body.surfaceThreadKey;
    const message = body.message;
    const title = normalizeOptionalTitle(body.title);
    const deepModeEnabled =
      body.deepModeEnabled === undefined
        ? undefined
        : body.deepModeEnabled === true
          ? true
          : body.deepModeEnabled === false
            ? false
            : (() => {
                throw new BadRequestException("deepModeEnabled must be boolean or omitted.");
              })();
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
        chatId: prepared.chat.id,
        messageId: prepared.userMessage.id,
        channel: "web",
        attachments: userAttachments
      });
      const baseMessage = request.welcomeTurn
        ? resolveWelcomeUserMessage(prepared.welcomeFirstTurnPrompt, request.welcomeLocale)
        : prepared.userMessage.content;
      const currentTimeIso = new Date().toISOString();
      const skillRoutingContext = await this.autoSkillRoutingStateService.buildRuntimeContext({
        chatId: prepared.chat.id,
        currentUserMessageId: prepared.userMessage.id,
        state: prepared.chat.autoSkillRoutingState
      });
      const openMediaJobs = await this.assistantMediaJobService.listOpenJobsForChatContext({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        chatId: prepared.chat.id
      });
      const nativeTurnInput = this.buildNativeSyncTurnInput({
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
        userTimezone: prepared.workspaceTimezone,
        currentTimeIso,
        skillRoutingContext,
        deepMode: prepared.chat.deepModeEnabled,
        ...(prepared.quotaDegradeModelOverride
          ? {
              providerOverride: prepared.quotaDegradeModelOverride.provider,
              modelOverride: prepared.quotaDegradeModelOverride.model
            }
          : {})
      });
      this.logWebRuntimeRoute({
        route: "sync",
        assistantId: prepared.assistantId,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId })
      });

      let runtimeResponse: AssistantRuntimeWebChatTurnResult;
      try {
        runtimeResponse = await this.sendNativeWebChatTurnService.execute(nativeTurnInput);
      } catch (error: unknown) {
        throw toAssistantInboundHttpException(error);
      }
      if (runtimeResponse.runtimeTrace) {
        trace.attachExternalTrace(runtimeResponse.runtimeTrace);
      }
      trace.stage("runtime_done");
      pendingMediaForReconciliation = runtimeResponse.media;

      const assistantMessage = await this.assistantChatRepository.createMessage({
        chatId: prepared.chat.id,
        assistantId: prepared.assistantId,
        author: "assistant",
        content: runtimeResponse.assistantMessage
      });
      trace.stage("assistant_message_saved");
      if (
        runtimeResponse.deferredMediaJobs !== undefined &&
        runtimeResponse.deferredMediaJobs.length > 0
      ) {
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
        artifacts: runtimeResponse.media,
        channel: "web",
        assistantId: prepared.assistantId,
        chatId: prepared.chat.id,
        messageId: assistantMessage.id,
        workspaceId: prepared.assistant.workspaceId
      });
      mediaDeliveryCompleted = true;
      trace.stage("media_delivered");
      const finalAssistantContent = await this.persistFinalAssistantContentIfNeeded({
        assistantMessage,
        assistantId: prepared.assistantId,
        assistantText: runtimeResponse.assistantMessage,
        attemptedArtifactCount: runtimeResponse.media.length,
        deliveredAttachmentCount: delivered.attachments.length,
        deliveredAttachmentFilenames: delivered.attachments
          .map((attachment) => attachment.originalFilename)
          .filter((filename): filename is string => typeof filename === "string"),
        locale: request.welcomeLocale ?? null
      });

      await this.recordWebChatMemoryTurnService.execute({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        userMessageId: prepared.userMessage.id,
        assistantMessageId: assistantMessage.id,
        userContent: baseMessage,
        assistantContent: finalAssistantContent,
        memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
      });
      trace.stage("memory_recorded");
      await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
        assistant: prepared.assistant,
        userContent: baseMessage,
        assistantContent: finalAssistantContent,
        ...(runtimeResponse.usageAccounting === undefined
          ? {}
          : { usageAccounting: runtimeResponse.usageAccounting }),
        source: "web_chat_turn_sync"
      });
      trace.stage("quota_recorded");

      if (request.clientTurnId !== undefined) {
        const replayState = {
          clientTurnId: request.clientTurnId,
          chatId: prepared.chat.id,
          userMessageId: prepared.userMessage.id,
          assistantMessageId: assistantMessage.id,
          respondedAt: runtimeResponse.respondedAt,
          degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
          quotaFallbackReason: prepared.quotaDegradeReason,
          quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
          ...(runtimeResponse.turnRouting === undefined
            ? {}
            : { turnRouting: runtimeResponse.turnRouting }),
          completedAt: new Date().toISOString()
        };
        if (this.webChatTurnAttemptService) {
          await this.webChatTurnAttemptService.markCompleted({
            assistantId: prepared.assistantId,
            userId: prepared.userId,
            surfaceThreadKey: prepared.chat.surfaceThreadKey,
            clientTurnId: request.clientTurnId,
            assistantMessageId: assistantMessage.id,
            respondedAt: runtimeResponse.respondedAt,
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
      await this.autoSkillRoutingStateService.persistFromTurnRouting({
        chatId: prepared.chat.id,
        turnRouting: runtimeResponse.turnRouting
      });
      const persistedAutoSkillState = this.autoSkillRoutingStateService.extractStateFromTurnRouting(
        {
          turnRouting: runtimeResponse.turnRouting
        }
      );
      const postTurnSkillRoutingContext =
        await this.autoSkillRoutingStateService.buildRuntimeContext({
          chatId: prepared.chat.id,
          currentUserMessageId: prepared.userMessage.id,
          state:
            persistedAutoSkillState === undefined
              ? prepared.chat.autoSkillRoutingState
              : persistedAutoSkillState
        });
      if (
        await this.autoSkillRoutingStateService.shouldRunBackgroundCheck(
          postTurnSkillRoutingContext
        )
      ) {
        const backgroundSkillRoutingContext =
          this.autoSkillRoutingStateService.createBackgroundCheckContext(
            postTurnSkillRoutingContext
          );
        await this.autoSkillRoutingStateService.markBackgroundCheckQueued({
          chatId: prepared.chat.id,
          context: postTurnSkillRoutingContext
        });
        this.autoSkillRoutingStateService.runBackgroundCheck({
          chatId: prepared.chat.id,
          execute: () =>
            this.sendNativeWebChatTurnService.checkSkillRouting({
              ...nativeTurnInput,
              skillRoutingContext: backgroundSkillRoutingContext
            })
        });
      }

      trace.finish({
        status: "completed",
        outputPreview: finalAssistantContent
      });
      return {
        chat: prepared.chat,
        userMessage: prepared.userMessage,
        assistantMessage: {
          id: assistantMessage.id,
          chatId: assistantMessage.chatId,
          assistantId: assistantMessage.assistantId,
          author: assistantMessage.author,
          content: finalAssistantContent,
          attachments: delivered.attachments,
          createdAt: assistantMessage.createdAt.toISOString()
        },
        activeMediaJobs,
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
    if (chat === null || userMessage === null || assistantMessage === null) {
      throw new BadRequestException("Stored web turn replay state is incomplete.");
    }

    const [userAttachments, assistantAttachments] = await Promise.all([
      this.attachmentRepository.listByMessageId(userMessage.id),
      this.attachmentRepository.listByMessageId(assistantMessage.id)
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
        autoSkillRoutingState: chat.autoSkillRoutingState,
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

  private buildNativeSyncTurnInput(input: {
    assistantId: string;
    publishedVersionId: string;
    runtimeTier: import("./runtime-assignment").RuntimeTier;
    userId: string;
    workspaceId: string;
    surfaceThreadKey: string;
    userMessageId: string;
    userMessage: string;
    attachments: SendNativeWebChatTurnInput["attachments"];
    userTimezone: string;
    currentTimeIso: string;
    skillRoutingContext?: SendNativeWebChatTurnInput["skillRoutingContext"];
    deepMode?: SendNativeWebChatTurnInput["deepMode"];
    modelRoleOverride?: SendNativeWebChatTurnInput["modelRoleOverride"];
    providerOverride?: "openai" | "anthropic";
    modelOverride?: string;
  }): SendNativeWebChatTurnInput {
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
      userTimezone: input.userTimezone,
      currentTimeIso: input.currentTimeIso,
      ...(input.skillRoutingContext === undefined
        ? {}
        : { skillRoutingContext: input.skillRoutingContext }),
      ...(input.deepMode === undefined ? {} : { deepMode: input.deepMode }),
      ...(input.modelRoleOverride === undefined
        ? {}
        : { modelRoleOverride: input.modelRoleOverride }),
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    };
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
