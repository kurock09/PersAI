import type { TextGenerationUsageAccountingEnvelope } from "@persai/runtime-contract";
import type { AssistantChatMessage } from "../domain/assistant-chat-message.entity";
import type { AssistantChatRepository } from "../domain/assistant-chat.repository";
import type {
  AssistantChannelSurfaceBindingRepository,
  CompletedWebTurnReplayState
} from "../domain/assistant-channel-surface-binding.repository";
import type { AssistantChatMessageAttachmentRepository } from "../domain/assistant-chat-message-attachment.repository";
import type { Assistant } from "../domain/assistant.entity";
import type {
  AssistantRuntimeTurnRoutingSnapshot,
  RuntimeMediaArtifact
} from "./assistant-runtime.facade";
import type { AssistantDocumentJobReadService } from "./assistant-document-job-read.service";
import type { AssistantAsyncJobHandleStateService } from "./assistant-async-job-handle-state.service";
import type { AssistantMediaJobService } from "./workspace-media-job.service";
import type { AutoSkillRoutingStateService } from "./auto-skill-routing-state.service";
import type { CompactionAdvisoryFollowUpService } from "./compaction-advisory-follow-up.service";
import {
  applyFinalDeliveryHonestyCorrection,
  resolveUndeliveredArtifactKind
} from "./final-delivery-honesty";
import type { MediaDeliveryService } from "./media/media-delivery.service";
import type { NotificationDeliveryWorkerService } from "./notifications/notification-delivery-worker.service";
import type { QuotaAdvisoryFollowUpService } from "./quota-advisory-follow-up.service";
import { readPersistedDocumentLinkMetadata } from "./read-attachment-document-link";
import { toAssistantWebChatMessageAttachmentState } from "./media/media.types";
import type { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { AssistantWebChatMessageState } from "./web-chat.types";
import type { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";

type PersistedAttachment = Awaited<
  ReturnType<AssistantChatMessageAttachmentRepository["listByMessageId"]>
>[number];

type PersistedSkillState = Awaited<
  ReturnType<AutoSkillRoutingStateService["persistFromTurnRouting"]>
>;

type TraceStageRecorder = (stage: string) => void;

function toAttachmentState(attachment: PersistedAttachment) {
  const metadata =
    attachment.metadata !== null &&
    typeof attachment.metadata === "object" &&
    !Array.isArray(attachment.metadata)
      ? (attachment.metadata as Record<string, unknown>)
      : null;
  return toAssistantWebChatMessageAttachmentState({
    id: attachment.id,
    storagePath: attachment.storagePath,
    attachmentType: attachment.attachmentType,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    processingStatus: attachment.processingStatus,
    metadata,
    createdAt: attachment.createdAt,
    documentLink: readPersistedDocumentLinkMetadata(metadata)
  });
}

function parseWebThreadProviderMessageId(providerRef: string | null): string | null {
  if (typeof providerRef !== "string") {
    return null;
  }
  const match = providerRef.match(/^web_thread:[^:]+:(.+)$/);
  return match?.[1] ?? null;
}

async function persistFinalAssistantContentIfNeeded(input: {
  assistantChatRepository: Pick<AssistantChatRepository, "updateMessageContent">;
  logger: { warn(message: string): void };
  assistantMessage: Pick<AssistantChatMessage, "id" | "content">;
  assistantId: string;
  assistantText: string;
  deliveredAttachments: Awaited<ReturnType<MediaDeliveryService["deliver"]>>["attachments"];
  attemptedArtifactCount: number;
  attemptedArtifactKind: ReturnType<typeof resolveUndeliveredArtifactKind>;
  locale: string | null;
}): Promise<string> {
  const finalAssistantContent = applyFinalDeliveryHonestyCorrection({
    assistantText: input.assistantText,
    attemptedArtifactCount: input.attemptedArtifactCount,
    deliveredAttachmentCount: input.deliveredAttachments.length,
    deliveredAttachmentFilenames: input.deliveredAttachments
      .map((attachment) => attachment.originalFilename)
      .filter((filename): filename is string => typeof filename === "string"),
    attemptedArtifactKind: input.attemptedArtifactKind,
    locale: input.locale
  });
  if (finalAssistantContent === input.assistantMessage.content) {
    return finalAssistantContent;
  }
  const updated = await input.assistantChatRepository.updateMessageContent(
    input.assistantMessage.id,
    input.assistantId,
    finalAssistantContent
  );
  if (updated === null) {
    input.logger.warn(
      `Failed to persist final delivery-honesty correction for assistant message "${input.assistantMessage.id}".`
    );
  }
  return finalAssistantContent;
}

async function deliverFollowUpAssistantMessage(input: {
  logger: { warn(message: string): void };
  assistantChatRepository: Pick<AssistantChatRepository, "findMessageByIdForAssistant">;
  attachmentRepository: Pick<AssistantChatMessageAttachmentRepository, "listByMessageId">;
  notificationDeliveryWorkerService: Pick<NotificationDeliveryWorkerService, "deliverIntentNow">;
  quotaAdvisoryFollowUpService?:
    | Pick<QuotaAdvisoryFollowUpService, "maybeCreateFollowUp">
    | undefined;
  compactionAdvisoryFollowUpService?:
    | Pick<CompactionAdvisoryFollowUpService, "maybeCreateFollowUp">
    | undefined;
  assistantId: string;
  workspaceId: string;
  userId: string;
  chatId: string;
  surfaceThreadKey: string;
  mainAssistantMessage: string;
  traceId: string;
  markTraceStage?: TraceStageRecorder | undefined;
}): Promise<{
  followUpAssistantMessageId: string | null;
  followUpAssistantMessage: AssistantWebChatMessageState | null;
}> {
  try {
    const quotaAdvisoryFollowUp =
      (await input.quotaAdvisoryFollowUpService?.maybeCreateFollowUp({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        chatId: input.chatId,
        surface: "web",
        surfaceThreadKey: input.surfaceThreadKey,
        mainAssistantMessage: input.mainAssistantMessage,
        traceId: input.traceId
      })) ?? null;
    const compactionAdvisoryFollowUp =
      quotaAdvisoryFollowUp === null
        ? ((await input.compactionAdvisoryFollowUpService?.maybeCreateFollowUp({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            userId: input.userId,
            chatId: input.chatId,
            surface: "web",
            surfaceThreadKey: input.surfaceThreadKey,
            externalUserKey: input.userId,
            mainAssistantMessage: input.mainAssistantMessage,
            traceId: input.traceId
          })) ?? null)
        : null;

    if (quotaAdvisoryFollowUp !== null) {
      input.markTraceStage?.("quota_advisory_follow_up_intent_created");
    }
    if (compactionAdvisoryFollowUp !== null) {
      input.markTraceStage?.("compaction_advisory_follow_up_intent_created");
    }

    const followUpIntent = quotaAdvisoryFollowUp ?? compactionAdvisoryFollowUp;
    if (followUpIntent === null) {
      return {
        followUpAssistantMessageId: null,
        followUpAssistantMessage: null
      };
    }

    const delivery = await input.notificationDeliveryWorkerService.deliverIntentNow(
      followUpIntent.intentId
    );
    const followUpAssistantMessageId = parseWebThreadProviderMessageId(delivery.providerRef);
    if (followUpAssistantMessageId === null) {
      return {
        followUpAssistantMessageId: null,
        followUpAssistantMessage: null
      };
    }

    const deliveredFollowUp = await input.assistantChatRepository.findMessageByIdForAssistant(
      followUpAssistantMessageId,
      input.assistantId
    );
    if (deliveredFollowUp === null) {
      return {
        followUpAssistantMessageId,
        followUpAssistantMessage: null
      };
    }

    const followUpAttachments = await input.attachmentRepository.listByMessageId(
      deliveredFollowUp.id
    );
    return {
      followUpAssistantMessageId,
      followUpAssistantMessage: {
        id: deliveredFollowUp.id,
        chatId: deliveredFollowUp.chatId,
        assistantId: deliveredFollowUp.assistantId,
        author: "assistant",
        content: deliveredFollowUp.content,
        attachments: followUpAttachments.map((attachment) => toAttachmentState(attachment)),
        createdAt: deliveredFollowUp.createdAt.toISOString()
      }
    };
  } catch (error) {
    input.logger.warn(
      `[web-turn-follow-up] Non-blocking follow-up delivery failed for assistant ${input.assistantId} chat ${input.chatId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {
      followUpAssistantMessageId: null,
      followUpAssistantMessage: null
    };
  }
}

export async function finalizePersistedWebTurn(input: {
  logger: { warn(message: string): void };
  assistantChatRepository: Pick<
    AssistantChatRepository,
    "findMessageByIdForAssistant" | "updateMessageContent"
  >;
  attachmentRepository: Pick<AssistantChatMessageAttachmentRepository, "listByMessageId">;
  assistantMediaJobService: Pick<AssistantMediaJobService, "listOpenJobsForWebChat">;
  assistantDocumentJobReadService: Pick<AssistantDocumentJobReadService, "listOpenJobsForWebChat">;
  asyncJobHandleState: Pick<AssistantAsyncJobHandleStateService, "listOpenSandboxJobsForWebChat">;
  mediaDeliveryService: Pick<MediaDeliveryService, "deliver">;
  trackWorkspaceQuotaUsageService: Pick<TrackWorkspaceQuotaUsageService, "recordWebChatTurnUsage">;
  notificationDeliveryWorkerService: Pick<NotificationDeliveryWorkerService, "deliverIntentNow">;
  quotaAdvisoryFollowUpService?:
    | Pick<QuotaAdvisoryFollowUpService, "maybeCreateFollowUp">
    | undefined;
  compactionAdvisoryFollowUpService?:
    | Pick<CompactionAdvisoryFollowUpService, "maybeCreateFollowUp">
    | undefined;
  appendModelCostLedgerEvents: (input: {
    assistantMessageId: string;
    respondedAt: string;
  }) => Promise<void>;
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string;
  surfaceThreadKey: string;
  userMessageId: string;
  userContent: string;
  assistant: Assistant;
  assistantMessage: AssistantChatMessage;
  assistantText: string;
  mediaArtifacts: RuntimeMediaArtifact[];
  respondedAt: string;
  textUsageAccounting?: TextGenerationUsageAccountingEnvelope;
  traceId: string;
  quotaSource: "web_chat_turn_sync" | "web_chat_turn_stream_completed";
  locale: string | null;
  markTraceStage?: TraceStageRecorder | undefined;
}): Promise<{
  deliveredAttachments: Awaited<ReturnType<MediaDeliveryService["deliver"]>>["attachments"];
  finalAssistantContent: string;
  activeMediaJobs: Awaited<ReturnType<AssistantMediaJobService["listOpenJobsForWebChat"]>>;
  activeDocumentJobs: Awaited<
    ReturnType<AssistantDocumentJobReadService["listOpenJobsForWebChat"]>
  >;
  activeSandboxJobs: Awaited<
    ReturnType<AssistantAsyncJobHandleStateService["listOpenSandboxJobsForWebChat"]>
  >;
  followUpAssistantMessageId: string | null;
  followUpAssistantMessage: AssistantWebChatMessageState | null;
}> {
  const [activeMediaJobs, activeDocumentJobs, activeSandboxJobs, delivered] = await Promise.all([
    input.assistantMediaJobService.listOpenJobsForWebChat({
      assistantId: input.assistantId,
      userId: input.userId,
      chatId: input.chatId
    }),
    input.assistantDocumentJobReadService.listOpenJobsForWebChat({
      assistantId: input.assistantId,
      userId: input.userId,
      chatId: input.chatId
    }),
    input.asyncJobHandleState.listOpenSandboxJobsForWebChat({
      assistantId: input.assistantId,
      chatId: input.chatId
    }),
    input.mediaDeliveryService.deliver({
      artifacts: input.mediaArtifacts,
      channel: "web",
      assistantId: input.assistantId,
      chatId: input.chatId,
      messageId: input.assistantMessage.id,
      workspaceId: input.workspaceId
    })
  ]);
  input.markTraceStage?.("media_delivered");

  const finalAssistantContent = await persistFinalAssistantContentIfNeeded({
    assistantChatRepository: input.assistantChatRepository,
    logger: input.logger,
    assistantMessage: input.assistantMessage,
    assistantId: input.assistantId,
    assistantText: input.assistantText,
    deliveredAttachments: delivered.attachments,
    attemptedArtifactCount: input.mediaArtifacts.length,
    attemptedArtifactKind: resolveUndeliveredArtifactKind(input.mediaArtifacts),
    locale: input.locale
  });

  await Promise.all([
    input.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
      assistant: input.assistant,
      userContent: input.userContent,
      assistantContent: finalAssistantContent,
      ...(input.textUsageAccounting === undefined
        ? {}
        : { textUsageAccounting: input.textUsageAccounting }),
      source: input.quotaSource
    }),
    input.appendModelCostLedgerEvents({
      assistantMessageId: input.assistantMessage.id,
      respondedAt: input.respondedAt
    })
  ]);
  input.markTraceStage?.("quota_recorded");
  input.markTraceStage?.("cost_ledger_recorded");

  const followUp = await deliverFollowUpAssistantMessage({
    logger: input.logger,
    assistantChatRepository: input.assistantChatRepository,
    attachmentRepository: input.attachmentRepository,
    notificationDeliveryWorkerService: input.notificationDeliveryWorkerService,
    quotaAdvisoryFollowUpService: input.quotaAdvisoryFollowUpService,
    compactionAdvisoryFollowUpService: input.compactionAdvisoryFollowUpService,
    assistantId: input.assistantId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    chatId: input.chatId,
    surfaceThreadKey: input.surfaceThreadKey,
    mainAssistantMessage: finalAssistantContent,
    traceId: input.traceId,
    markTraceStage: input.markTraceStage
  });

  return {
    deliveredAttachments: delivered.attachments,
    finalAssistantContent,
    activeMediaJobs,
    activeDocumentJobs,
    activeSandboxJobs,
    followUpAssistantMessageId: followUp.followUpAssistantMessageId,
    followUpAssistantMessage: followUp.followUpAssistantMessage
  };
}

export async function completeWebTurnReplay(input: {
  bindingRepository: Pick<AssistantChannelSurfaceBindingRepository, "completeWebTurnProcessing">;
  webChatTurnAttemptService?: Pick<WebChatTurnAttemptService, "markCompleted"> | undefined;
  assistantId: string;
  userId: string;
  surfaceThreadKey: string;
  clientTurnId: string;
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  respondedAt: string;
  degradedByQuotaFallback: boolean;
  quotaFallbackReason: string | null;
  quotaFallbackModel: string | null;
  followUpAssistantMessageId: string | null;
  turnRouting?: AssistantRuntimeTurnRoutingSnapshot | null | undefined;
  markTraceStage?: TraceStageRecorder | undefined;
}): Promise<CompletedWebTurnReplayState> {
  const replayState: CompletedWebTurnReplayState = {
    clientTurnId: input.clientTurnId,
    chatId: input.chatId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    respondedAt: input.respondedAt,
    degradedByQuotaFallback: input.degradedByQuotaFallback,
    quotaFallbackReason: input.quotaFallbackReason,
    quotaFallbackModel: input.quotaFallbackModel,
    ...(input.followUpAssistantMessageId === null
      ? {}
      : { followUpAssistantMessageId: input.followUpAssistantMessageId }),
    ...(input.turnRouting === undefined ? {} : { turnRouting: input.turnRouting }),
    completedAt: new Date().toISOString()
  };

  const replayWrites: Array<Promise<unknown>> = [];
  if (input.webChatTurnAttemptService) {
    replayWrites.push(
      input.webChatTurnAttemptService.markCompleted({
        assistantId: input.assistantId,
        userId: input.userId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        assistantMessageId: input.assistantMessageId,
        respondedAt: input.respondedAt,
        terminalPayload: replayState
      })
    );
  }
  replayWrites.push(
    input.bindingRepository.completeWebTurnProcessing(
      input.assistantId,
      "web_internal",
      "web_chat",
      replayState
    )
  );
  await Promise.all(replayWrites);
  input.markTraceStage?.("replay_completed");
  return replayState;
}

export async function persistWebTurnSkillStateAndQueueBackgroundCheck(input: {
  autoSkillRoutingStateService: Pick<AutoSkillRoutingStateService, "persistFromTurnRouting">;
  chatId: string;
  turnRouting?: AssistantRuntimeTurnRoutingSnapshot | null | undefined;
}): Promise<PersistedSkillState> {
  return await input.autoSkillRoutingStateService.persistFromTurnRouting({
    chatId: input.chatId,
    turnRouting: input.turnRouting
  });
}

export async function runWebTurnPostRuntimeCleanup(input: {
  logger: { warn(message: string): void };
  replayInput?: Parameters<typeof completeWebTurnReplay>[0] | undefined;
  skillStateInput: Parameters<typeof persistWebTurnSkillStateAndQueueBackgroundCheck>[0];
  skillStateFallback: PersistedSkillState;
  skillStateFailureMessage: (error: unknown) => string;
  cleanupFailureMessage: (error: unknown) => string;
}): Promise<PersistedSkillState> {
  const cleanupPromises: Array<Promise<unknown>> = [];

  if (input.replayInput !== undefined) {
    cleanupPromises.push(completeWebTurnReplay(input.replayInput));
  }

  const skillStatePromise = persistWebTurnSkillStateAndQueueBackgroundCheck(
    input.skillStateInput
  ).catch((error: unknown) => {
    input.logger.warn(input.skillStateFailureMessage(error));
    return input.skillStateFallback;
  });
  cleanupPromises.push(skillStatePromise);

  const results = await Promise.allSettled(cleanupPromises);
  for (const result of results) {
    if (result.status === "rejected") {
      input.logger.warn(input.cleanupFailureMessage(result.reason));
    }
  }

  return await skillStatePromise;
}
