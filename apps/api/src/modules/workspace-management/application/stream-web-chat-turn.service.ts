import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
import { InboundMediaService } from "./media/inbound-media.service";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { toRuntimeAttachmentRef } from "./media/media.types";
import { resolveWelcomeTurnInstruction } from "./send-web-chat-turn.service";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import type { RuntimeTier } from "./runtime-assignment";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import {
  StreamNativeWebChatTurnService,
  type StreamNativeWebChatTurnInput
} from "./stream-native-web-chat-turn.service";
import { WebRuntimeShadowComparisonService } from "./web-runtime-shadow-comparison.service";
import { type WebChatRuntimeMode } from "./web-runtime-mode";

export interface StreamWebChatTurnPrepared {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  quotaDegradeModelOverride: { provider: "openai" | "anthropic"; model: string } | null;
  quotaDegradeReason: "token_budget_limit_reached" | null;
  userId: string;
  workspaceId: string;
  workspaceTimezone: string;
  clientTurnId?: string;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
}

export interface StreamWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
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
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    private readonly streamNativeWebChatTurnService: StreamNativeWebChatTurnService,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly inboundMediaService: InboundMediaService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly webRuntimeShadowComparisonService: WebRuntimeShadowComparisonService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService
  ) {}

  async prepare(
    userId: string,
    request: StreamWebChatTurnRequest
  ): Promise<StreamWebChatTurnPreparation> {
    const replayTransport = await this.claimOrReplayWebTurn(userId, request.clientTurnId);
    if (replayTransport !== null) {
      return { mode: "replayed", transport: replayTransport };
    }

    const prepared = await this.prepareAssistantInboundTurnService.execute({
      userId,
      surface: "web_chat",
      surfaceThreadKey: request.surfaceThreadKey,
      message: request.message,
      ...(request.title !== undefined ? { title: request.title } : {})
    });
    return {
      mode: "prepared",
      prepared: {
        ...prepared,
        ...(request.clientTurnId !== undefined ? { clientTurnId: request.clientTurnId } : {}),
        ...(request.welcomeTurn ? { welcomeTurn: true } : {}),
        ...(request.welcomeLocale !== undefined ? { welcomeLocale: request.welcomeLocale } : {})
      }
    };
  }

  async streamToCompletion(
    prepared: StreamWebChatTurnPrepared,
    callbacks: {
      isClientAborted: () => boolean;
      clientAbortSignal?: AbortSignal;
      onDelta: (delta: string, accumulated: string) => void;
      onThinking: (delta: string, accumulated: string) => void;
      onDone: (respondedAt: string) => void;
    }
  ): Promise<StreamWebChatTurnOutcome> {
    let accumulated = "";
    let respondedAt: string | null = null;
    const collectedMedia: RuntimeMediaArtifact[] = [];
    const trace = this.overviewLatencyTraceService.start({
      traceId: randomUUID(),
      surface: "web_chat_stream",
      assistantId: prepared.assistantId,
      threadKey: prepared.chat.surfaceThreadKey
    });

    const userAttachments = await this.attachmentRepository.listByMessageId(
      prepared.userMessage.id
    );
    const baseMessage = prepared.welcomeTurn
      ? resolveWelcomeTurnInstruction(prepared.welcomeLocale)
      : prepared.userMessage.content;
    const runtimeMode = this.streamNativeWebChatTurnService.getMode();
    let primaryUserMessage = baseMessage;
    if (runtimeMode !== "native") {
      const attachmentContext =
        await this.inboundMediaService.buildContextForCurrentMessageAttachments(
          prepared.userMessage.id
        );
      primaryUserMessage = attachmentContext ? `${attachmentContext}\n${baseMessage}` : baseMessage;
    }
    trace.stage("attachment_context");
    const currentTimeIso = new Date().toISOString();
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
      route: "stream",
      mode: runtimeMode,
      assistantId: prepared.assistantId,
      surfaceThreadKey: prepared.chat.surfaceThreadKey,
      ...(prepared.clientTurnId === undefined ? {} : { clientTurnId: prepared.clientTurnId })
    });
    const primaryRuntimeStartedAt = Date.now();
    let primaryFirstDeltaMs: number | null = null;
    let primaryDeltaCount = 0;

    try {
      for await (const chunk of this.executeRuntimeStream({
        runtimeMode,
        nativeTurnInput,
        prepared,
        enrichedUserMessage: primaryUserMessage,
        currentTimeIso,
        ...(trace.isEnabled() ? { overviewTraceId: trace.getTraceId() } : {}),
        ...(callbacks.clientAbortSignal === undefined
          ? {}
          : { signal: callbacks.clientAbortSignal })
      })) {
        if (callbacks.isClientAborted()) {
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
          return this.persistInterruptedOutcome(prepared, accumulated, respondedAt);
        }

        if (chunk.type === "delta" && typeof chunk.delta === "string") {
          if (accumulated.length === 0) {
            trace.stage("first_delta");
          }
          if (primaryFirstDeltaMs === null) {
            primaryFirstDeltaMs = Date.now() - primaryRuntimeStartedAt;
          }
          primaryDeltaCount += 1;
          accumulated += chunk.delta;
          callbacks.onDelta(chunk.delta, accumulated);
        }

        if (
          chunk.type === "thinking" &&
          typeof chunk.delta === "string" &&
          typeof chunk.accumulated === "string"
        ) {
          callbacks.onThinking(chunk.delta, chunk.accumulated);
        }

        if (chunk.type === "media" && Array.isArray(chunk.media)) {
          collectedMedia.push(...chunk.media);
        }

        if (chunk.type === "done" && typeof chunk.respondedAt === "string") {
          respondedAt = chunk.respondedAt;
          if (chunk.runtimeTrace) {
            trace.attachExternalTrace(chunk.runtimeTrace);
          }
          trace.stage("runtime_done");
          callbacks.onDone(chunk.respondedAt);
        }
      }

      if (callbacks.isClientAborted()) {
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
        return this.persistInterruptedOutcome(prepared, accumulated, respondedAt);
      }

      const cleanedAccumulated = accumulated.trim();
      if (cleanedAccumulated.length === 0 && collectedMedia.length === 0) {
        if (prepared.clientTurnId !== undefined) {
          await this.bindingRepository.releaseWebTurnProcessing(
            prepared.assistantId,
            WEB_TURN_PROVIDER_KEY,
            WEB_TURN_SURFACE_TYPE,
            prepared.clientTurnId
          );
        }
        if (runtimeMode === "shadow") {
          this.webRuntimeShadowComparisonService.queueStreamNativeComparison({
            assistantId: prepared.assistantId,
            surfaceThreadKey: prepared.chat.surfaceThreadKey,
            ...(prepared.clientTurnId === undefined ? {} : { clientTurnId: prepared.clientTurnId }),
            primary: {
              status: "failed",
              runtimeMs: Date.now() - primaryRuntimeStartedAt,
              firstDeltaMs: primaryFirstDeltaMs,
              deltaCount: primaryDeltaCount,
              assistantText: accumulated,
              errorCode: "runtime_invalid_response",
              errorMessage: "Runtime stream finished without assistant output."
            },
            executeShadow: () => this.streamNativeWebChatTurnService.execute(nativeTurnInput)
          });
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

      const delivered = await this.mediaDeliveryService.deliver({
        artifacts: collectedMedia.map((m) => ({
          url: m.url,
          type: m.type,
          audioAsVoice: m.audioAsVoice
        })),
        channel: "web",
        assistantId: prepared.assistantId,
        chatId: prepared.chat.id,
        messageId: assistantMessage.id,
        workspaceId: prepared.workspaceId
      });
      const attachmentStates = delivered.attachments;
      trace.stage("media_delivered");

      await this.recordWebChatMemoryTurnService.execute({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        userMessageId: prepared.userMessage.id,
        assistantMessageId: assistantMessage.id,
        userContent: prepared.welcomeTurn
          ? resolveWelcomeTurnInstruction(prepared.welcomeLocale)
          : prepared.userMessage.content,
        assistantContent: cleanedAccumulated,
        memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
      });
      trace.stage("memory_recorded");
      await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
        assistant: prepared.assistant,
        userContent: prepared.userMessage.content,
        assistantContent: cleanedAccumulated,
        source: "web_chat_turn_stream_completed"
      });
      trace.stage("quota_recorded");
      if (runtimeMode === "legacy" || runtimeMode === "shadow") {
        await this.consumeBootstrapBestEffort(prepared.assistantId, prepared.runtimeTier);
        trace.stage("bootstrap_consumed");
      }
      if (prepared.clientTurnId !== undefined) {
        await this.bindingRepository.completeWebTurnProcessing(
          prepared.assistantId,
          WEB_TURN_PROVIDER_KEY,
          WEB_TURN_SURFACE_TYPE,
          {
            clientTurnId: prepared.clientTurnId,
            chatId: prepared.chat.id,
            userMessageId: prepared.userMessage.id,
            assistantMessageId: assistantMessage.id,
            respondedAt: respondedAt ?? new Date().toISOString(),
            degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
            quotaFallbackReason: prepared.quotaDegradeReason,
            quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null,
            completedAt: new Date().toISOString()
          }
        );
        trace.stage("replay_completed");
      }
      if (runtimeMode === "shadow") {
        this.webRuntimeShadowComparisonService.queueStreamNativeComparison({
          assistantId: prepared.assistantId,
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          ...(prepared.clientTurnId === undefined ? {} : { clientTurnId: prepared.clientTurnId }),
          primary: {
            status: "completed",
            runtimeMs: Date.now() - primaryRuntimeStartedAt,
            firstDeltaMs: primaryFirstDeltaMs,
            deltaCount: primaryDeltaCount,
            assistantText: cleanedAccumulated,
            errorCode: null,
            errorMessage: null
          },
          executeShadow: () => this.streamNativeWebChatTurnService.execute(nativeTurnInput)
        });
      }
      const refreshedChat = await this.assistantChatRepository.findChatById(prepared.chat.id);
      if (refreshedChat === null) {
        throw new NotFoundException("Chat does not exist for this assistant.");
      }

      trace.finish({
        status: "completed",
        outputPreview: cleanedAccumulated
      });
      return {
        status: "completed",
        transport: {
          chat: {
            id: refreshedChat.id,
            assistantId: refreshedChat.assistantId,
            surface: refreshedChat.surface,
            surfaceThreadKey: refreshedChat.surfaceThreadKey,
            title: refreshedChat.title,
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
            content: assistantMessage.content,
            attachments: attachmentStates,
            createdAt: assistantMessage.createdAt.toISOString()
          },
          runtime: {
            respondedAt: respondedAt ?? new Date().toISOString(),
            degradedByQuotaFallback: prepared.quotaDegradeModelOverride !== null,
            quotaFallbackReason: prepared.quotaDegradeReason,
            quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null
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
      const interruptedOutcome = await this.persistInterruptedOutcome(
        prepared,
        accumulated,
        respondedAt
      );
      if (runtimeMode === "shadow" && !callbacks.isClientAborted()) {
        this.webRuntimeShadowComparisonService.queueStreamNativeComparison({
          assistantId: prepared.assistantId,
          surfaceThreadKey: prepared.chat.surfaceThreadKey,
          ...(prepared.clientTurnId === undefined ? {} : { clientTurnId: prepared.clientTurnId }),
          primary: {
            status: "failed",
            runtimeMs: Date.now() - primaryRuntimeStartedAt,
            firstDeltaMs: primaryFirstDeltaMs,
            deltaCount: primaryDeltaCount,
            assistantText: accumulated,
            errorCode: normalized.code,
            errorMessage: normalized.message
          },
          executeShadow: () => this.streamNativeWebChatTurnService.execute(nativeTurnInput)
        });
      }
      trace.finish({
        status: "failed",
        outputPreview: accumulated
      });
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
    userTimezone: string;
    currentTimeIso: string;
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
      userTimezone: input.userTimezone,
      currentTimeIso: input.currentTimeIso,
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    };
  }

  private logWebRuntimeRoute(input: {
    route: "stream";
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

  private executeRuntimeStream(input: {
    runtimeMode: WebChatRuntimeMode;
    nativeTurnInput: StreamNativeWebChatTurnInput;
    prepared: StreamWebChatTurnPrepared;
    enrichedUserMessage: string;
    currentTimeIso: string;
    overviewTraceId?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk> {
    if (input.runtimeMode === "native") {
      return this.streamNativeWebChatTurnService.execute(
        input.nativeTurnInput,
        input.signal === undefined ? undefined : { signal: input.signal }
      );
    }

    return this.assistantRuntime.streamWebChatTurn({
      assistantId: input.prepared.assistantId,
      publishedVersionId: input.prepared.publishedVersionId,
      runtimeTier: input.prepared.runtimeTier,
      ...(input.prepared.quotaDegradeModelOverride
        ? {
            providerOverride: input.prepared.quotaDegradeModelOverride.provider,
            modelOverride: input.prepared.quotaDegradeModelOverride.model
          }
        : {}),
      ...(input.overviewTraceId === undefined ? {} : { overviewTraceId: input.overviewTraceId }),
      chatId: input.prepared.chat.id,
      surfaceThreadKey: input.prepared.chat.surfaceThreadKey,
      userMessageId: input.prepared.userMessage.id,
      userMessage: input.enrichedUserMessage,
      userTimezone: input.prepared.workspaceTimezone,
      currentTimeIso: input.currentTimeIso
    });
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
      throw new NotFoundException("Stored web turn replay state is incomplete.");
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
    runtimeTier: RuntimeTier
  ): Promise<void> {
    try {
      await this.assistantRuntime.consumeBootstrapWorkspace(assistantId, runtimeTier);
    } catch (error) {
      console.warn("[web-chat-stream] Non-fatal: failed to consume BOOTSTRAP.md:", error);
    }
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
          quotaFallbackModel: prepared.quotaDegradeModelOverride?.model ?? null
        }
      }
    };
  }
}
