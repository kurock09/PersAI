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
import {
  ASSISTANT_RUNTIME_FACADE,
  type AssistantRuntimeFacade,
  type AssistantRuntimeWebChatTurnResult
} from "./assistant-runtime.facade";
import { WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT } from "../domain/memory-source-policy";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { AssistantWebChatTurnState } from "./web-chat.types";
import { PrepareAssistantInboundTurnService } from "./prepare-assistant-inbound-turn.service";
import {
  createAssistantInboundConflict,
  toAssistantInboundFailurePayload,
  toAssistantInboundHttpException
} from "./assistant-inbound-error";
import { InboundMediaService } from "./media/inbound-media.service";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import {
  SendNativeWebChatTurnService,
  type SendNativeWebChatTurnInput
} from "./send-native-web-chat-turn.service";
import { WebRuntimeShadowComparisonService } from "./web-runtime-shadow-comparison.service";
import { type WebChatRuntimeMode } from "./web-runtime-mode";

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
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  processingStatus: string;
  createdAt: Date;
}) {
  return {
    id: attachment.id,
    attachmentType: attachment.attachmentType,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.sizeBytes),
    processingStatus: attachment.processingStatus,
    createdAt: attachment.createdAt.toISOString()
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    private readonly sendNativeWebChatTurnService: SendNativeWebChatTurnService,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly inboundMediaService: InboundMediaService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly webRuntimeShadowComparisonService: WebRuntimeShadowComparisonService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService
  ) {}

  parseInput(payload: unknown): SendWebChatTurnRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Web chat payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const surfaceThreadKey = body.surfaceThreadKey;
    const message = body.message;
    const title = normalizeOptionalTitle(body.title);
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
      ...(clientTurnId !== undefined ? { clientTurnId } : {}),
      ...(welcomeTurn ? { welcomeTurn: true } : {}),
      ...(welcomeLocale !== undefined ? { welcomeLocale } : {})
    };
  }

  async execute(
    userId: string,
    request: SendWebChatTurnRequest
  ): Promise<AssistantWebChatTurnState> {
    const replayTransport = await this.claimOrReplayWebTurn(userId, request.clientTurnId);
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
        ...(request.title !== undefined ? { title: request.title } : {})
      });
      preparedAssistantId = prepared.assistantId;
      trace.stage("prepared");

      const attachmentContext =
        await this.inboundMediaService.buildContextForCurrentMessageAttachments(
          prepared.userMessage.id
        );
      trace.stage("attachment_context");
      const enrichedUserMessage = attachmentContext
        ? `${attachmentContext}\n${prepared.userMessage.content}`
        : prepared.userMessage.content;
      const runtimeMode = this.sendNativeWebChatTurnService.getMode();
      const currentTimeIso = new Date().toISOString();
      const nativeTurnInput = this.buildNativeSyncTurnInput({
        assistantId: prepared.assistantId,
        publishedVersionId: prepared.publishedVersionId,
        runtimeTier: prepared.runtimeTier,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userMessage: enrichedUserMessage,
        userTimezone: prepared.workspaceTimezone,
        currentTimeIso,
        ...(prepared.quotaDegradeModelOverride
          ? {
              providerOverride: prepared.quotaDegradeModelOverride.provider,
              modelOverride: prepared.quotaDegradeModelOverride.model
            }
          : {})
      });
      this.logWebRuntimeRoute({
        route: "sync",
        mode: runtimeMode,
        assistantId: prepared.assistantId,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId })
      });

      const runtimeStartedAt = Date.now();
      let primaryRuntimeMs = 0;
      let runtimeResponse: AssistantRuntimeWebChatTurnResult;
      try {
        runtimeResponse = await this.executeSyncRuntimeTurn({
          runtimeMode,
          nativeTurnInput,
          assistantId: prepared.assistantId,
          publishedVersionId: prepared.publishedVersionId,
          runtimeTier: prepared.runtimeTier,
          chatId: prepared.chat.id,
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          userMessageId: prepared.userMessage.id,
          userMessage: enrichedUserMessage,
          userTimezone: prepared.workspaceTimezone,
          currentTimeIso,
          ...(prepared.quotaDegradeModelOverride
            ? {
                providerOverride: prepared.quotaDegradeModelOverride.provider,
                modelOverride: prepared.quotaDegradeModelOverride.model
              }
            : {}),
          ...(trace.isEnabled() ? { overviewTraceId: trace.getTraceId() } : {})
        });
        primaryRuntimeMs = Date.now() - runtimeStartedAt;
      } catch (error: unknown) {
        primaryRuntimeMs = Date.now() - runtimeStartedAt;
        if (runtimeMode === "shadow") {
          const primaryFailure = toAssistantInboundFailurePayload(error);
          this.webRuntimeShadowComparisonService.queueSyncNativeComparison({
            assistantId: prepared.assistantId,
            surfaceThreadKey: prepared.chat.surfaceThreadKey,
            ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId }),
            primary: {
              status: "failed",
              runtimeMs: primaryRuntimeMs,
              errorCode: primaryFailure.code,
              errorMessage: primaryFailure.message
            },
            executeShadow: () => this.sendNativeWebChatTurnService.execute(nativeTurnInput)
          });
        }
        throw toAssistantInboundHttpException(error);
      }
      if (runtimeResponse.runtimeTrace) {
        trace.attachExternalTrace(runtimeResponse.runtimeTrace);
      }
      trace.stage("runtime_done");

      const assistantMessage = await this.assistantChatRepository.createMessage({
        chatId: prepared.chat.id,
        assistantId: prepared.assistantId,
        author: "assistant",
        content: runtimeResponse.assistantMessage
      });
      trace.stage("assistant_message_saved");

      const delivered = await this.mediaDeliveryService.deliver({
        artifacts: runtimeResponse.media.map((m) => ({
          url: m.url,
          type: m.type,
          audioAsVoice: m.audioAsVoice
        })),
        channel: "web",
        assistantId: prepared.assistantId,
        chatId: prepared.chat.id,
        messageId: assistantMessage.id,
        workspaceId: prepared.assistant.workspaceId
      });
      trace.stage("media_delivered");

      await this.recordWebChatMemoryTurnService.execute({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        userMessageId: prepared.userMessage.id,
        assistantMessageId: assistantMessage.id,
        userContent: prepared.userMessage.content,
        assistantContent: runtimeResponse.assistantMessage,
        memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
      });
      trace.stage("memory_recorded");
      await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
        assistant: prepared.assistant,
        userContent: prepared.userMessage.content,
        assistantContent: assistantMessage.content,
        source: "web_chat_turn_sync"
      });
      trace.stage("quota_recorded");
      if (runtimeMode === "legacy" || runtimeMode === "shadow") {
        await this.consumeBootstrapBestEffort(prepared.assistantId, prepared.runtimeTier);
        trace.stage("bootstrap_consumed");
      }

      if (request.clientTurnId !== undefined) {
        await this.bindingRepository.completeWebTurnProcessing(
          prepared.assistantId,
          WEB_TURN_PROVIDER_KEY,
          WEB_TURN_SURFACE_TYPE,
          {
            clientTurnId: request.clientTurnId,
            chatId: prepared.chat.id,
            userMessageId: prepared.userMessage.id,
            assistantMessageId: assistantMessage.id,
            respondedAt: runtimeResponse.respondedAt,
            degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
            quotaFallbackReason: prepared.quotaDegradeReason,
            quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
            completedAt: new Date().toISOString()
          }
        );
        trace.stage("replay_completed");
      }

      if (runtimeMode === "shadow") {
        this.webRuntimeShadowComparisonService.queueSyncNativeComparison({
          assistantId: prepared.assistantId,
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId }),
          primary: {
            status: "completed",
            runtimeMs: primaryRuntimeMs,
            assistantMessage: runtimeResponse.assistantMessage
          },
          executeShadow: () => this.sendNativeWebChatTurnService.execute(nativeTurnInput)
        });
      }

      trace.finish({
        status: "completed",
        outputPreview: runtimeResponse.assistantMessage
      });
      return {
        chat: prepared.chat,
        userMessage: prepared.userMessage,
        assistantMessage: {
          id: assistantMessage.id,
          chatId: assistantMessage.chatId,
          assistantId: assistantMessage.assistantId,
          author: assistantMessage.author,
          content: assistantMessage.content,
          attachments: delivered.attachments,
          createdAt: assistantMessage.createdAt.toISOString()
        },
        runtime: {
          respondedAt: runtimeResponse.respondedAt,
          degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
          quotaFallbackReason: prepared.quotaDegradeReason,
          quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null
        }
      };
    } catch (error) {
      if (request.clientTurnId !== undefined && preparedAssistantId !== null) {
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
    clientTurnId: string | undefined
  ): Promise<AssistantWebChatTurnState | null> {
    if (clientTurnId === undefined) {
      return null;
    }
    const resolved =
      await this.resolveAssistantInboundRuntimeContextService.resolveByUserId(userId);
    const claim = await this.bindingRepository.claimWebTurnProcessing(
      resolved.assistantId,
      WEB_TURN_PROVIDER_KEY,
      WEB_TURN_SURFACE_TYPE,
      clientTurnId,
      new Date(),
      WEB_TURN_CLAIM_STALE_MS
    );
    if (claim === "claimed") {
      return null;
    }

    if (claim === "duplicate_handled") {
      const completed = await this.bindingRepository.getCompletedWebTurnProcessing(
        resolved.assistantId,
        WEB_TURN_PROVIDER_KEY,
        WEB_TURN_SURFACE_TYPE,
        clientTurnId
      );
      return completed ? this.rebuildStoredWebTurnState(resolved.assistantId, completed) : null;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < WEB_TURN_REPLAY_WAIT_MS) {
      const completed = await this.bindingRepository.getCompletedWebTurnProcessing(
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
      runtime: {
        respondedAt: state.respondedAt,
        degradedByQuotaFallback: state.degradedByQuotaFallback,
        quotaFallbackReason:
          state.quotaFallbackReason === "token_budget_limit_reached"
            ? "token_budget_limit_reached"
            : null,
        quotaFallbackModel: state.quotaFallbackModel
      }
    };
  }

  private async consumeBootstrapBestEffort(
    assistantId: string,
    runtimeTier: import("./runtime-assignment").RuntimeTier
  ): Promise<void> {
    try {
      await this.assistantRuntime.consumeBootstrapWorkspace(assistantId, runtimeTier);
    } catch (error) {
      console.warn("[web-chat] Non-fatal: failed to consume BOOTSTRAP.md:", error);
    }
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
    userTimezone: string;
    currentTimeIso: string;
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
      userTimezone: input.userTimezone,
      currentTimeIso: input.currentTimeIso,
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    };
  }

  private logWebRuntimeRoute(input: {
    route: "sync";
    mode: WebChatRuntimeMode;
    assistantId: string;
    surfaceThreadKey: string;
    clientTurnId?: string;
  }): void {
    if (input.mode === "legacy") {
      return;
    }

    this.logger.log(
      `web_runtime_route route=${input.route} mode=${input.mode} primary=${
        input.mode === "native" ? "native" : "legacy"
      } shadow=${input.mode === "shadow" ? "native" : "none"} assistantId=${
        input.assistantId
      } threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId ?? "n/a"}`
    );
  }

  private async executeSyncRuntimeTurn(input: {
    runtimeMode: WebChatRuntimeMode;
    nativeTurnInput: SendNativeWebChatTurnInput;
    assistantId: string;
    publishedVersionId: string;
    runtimeTier: import("./runtime-assignment").RuntimeTier;
    chatId: string;
    surfaceThreadKey: string;
    userMessageId: string;
    userMessage: string;
    userTimezone: string;
    currentTimeIso: string;
    providerOverride?: "openai" | "anthropic";
    modelOverride?: string;
    overviewTraceId?: string;
  }) {
    if (input.runtimeMode === "native") {
      return this.sendNativeWebChatTurnService.execute(input.nativeTurnInput);
    }

    return this.assistantRuntime.sendWebChatTurn({
      assistantId: input.assistantId,
      publishedVersionId: input.publishedVersionId,
      runtimeTier: input.runtimeTier,
      ...(input.providerOverride
        ? {
            providerOverride: input.providerOverride,
            modelOverride: input.modelOverride
          }
        : {}),
      ...(input.overviewTraceId ? { overviewTraceId: input.overviewTraceId } : {}),
      chatId: input.chatId,
      surfaceThreadKey: input.surfaceThreadKey,
      userMessageId: input.userMessageId,
      userMessage: input.userMessage,
      userTimezone: input.userTimezone,
      currentTimeIso: input.currentTimeIso
    });
  }
}
