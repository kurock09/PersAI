import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AssistantWebChatActiveTurnState,
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState,
  AssistantWebChatState,
  AssistantWebChatTurnCurrentActivityState,
  AssistantWebChatTurnState
} from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { readPersistedDocumentLinkMetadata } from "./read-attachment-document-link";
import type { CompletedWebTurnReplayState } from "../domain/assistant-channel-surface-binding.repository";
import type { AssistantChatSkillDecisionState } from "../domain/assistant-chat.entity";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { toAssistantWebChatMessageAttachmentState } from "./media/media.types";

export type WebChatTurnAttemptStatus =
  | "unknown"
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export interface WebChatTurnStatusState {
  status: WebChatTurnAttemptStatus;
  chat: AssistantWebChatState | null;
  userMessage: AssistantWebChatMessageState | null;
  assistantMessage: AssistantWebChatMessageState | null;
  followUpAssistantMessage?: AssistantWebChatMessageState | null;
  currentActivity: WebChatTurnCurrentActivityState | null;
  runtime: AssistantWebChatTurnState["runtime"] | null;
  error: { code: string | null; message: string | null } | null;
}

export type WebChatTurnCurrentActivityState = AssistantWebChatTurnCurrentActivityState;

export type WebTurnClaimResult = "claimed" | "duplicate_handled" | "duplicate_inflight";

const TERMINAL_STATUSES = new Set<WebChatTurnAttemptStatus>(["completed", "failed", "interrupted"]);

function parseSkillDecisionState(value: unknown): AssistantChatSkillDecisionState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const status = row.status === "active" || row.status === "inactive" ? row.status : null;
  if (status === null) {
    return null;
  }
  return {
    status,
    activeSkillId:
      status === "active" && typeof row.activeSkillId === "string" ? row.activeSkillId : null,
    activeSkillName:
      status === "active" && typeof row.activeSkillName === "string" ? row.activeSkillName : null,
    activeScenarioKey:
      status === "active" && typeof row.activeScenarioKey === "string"
        ? row.activeScenarioKey
        : null,
    activeScenarioDisplayName:
      status === "active" && typeof row.activeScenarioDisplayName === "string"
        ? row.activeScenarioDisplayName
        : null,
    topicSummary: typeof row.topicSummary === "string" ? row.topicSummary : null
  };
}

function toAttachmentState(input: {
  id: string;
  storagePath: string | null;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: bigint;
  processingStatus: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): AssistantWebChatMessageAttachmentState {
  const metadata =
    input.metadata !== null && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : null;
  return toAssistantWebChatMessageAttachmentState({
    id: input.id,
    storagePath: input.storagePath,
    attachmentType: input.attachmentType,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    processingStatus: input.processingStatus,
    metadata,
    createdAt: input.createdAt,
    documentLink: readPersistedDocumentLinkMetadata(metadata)
  });
}

function readTerminalPayload(value: Prisma.JsonValue | null): CompletedWebTurnReplayState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.clientTurnId !== "string" ||
    typeof row.chatId !== "string" ||
    typeof row.userMessageId !== "string" ||
    typeof row.assistantMessageId !== "string" ||
    typeof row.respondedAt !== "string" ||
    typeof row.completedAt !== "string"
  ) {
    return null;
  }
  const turnRouting =
    typeof row.turnRouting === "object" &&
    row.turnRouting !== null &&
    !Array.isArray(row.turnRouting)
      ? (row.turnRouting as CompletedWebTurnReplayState["turnRouting"])
      : null;
  return {
    clientTurnId: row.clientTurnId,
    chatId: row.chatId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    ...(typeof row.followUpAssistantMessageId === "string"
      ? { followUpAssistantMessageId: row.followUpAssistantMessageId }
      : {}),
    respondedAt: row.respondedAt,
    degradedByQuotaFallback: row.degradedByQuotaFallback === true,
    quotaFallbackReason:
      typeof row.quotaFallbackReason === "string" ? row.quotaFallbackReason : null,
    quotaFallbackModel: typeof row.quotaFallbackModel === "string" ? row.quotaFallbackModel : null,
    ...(turnRouting === undefined ? {} : { turnRouting }),
    completedAt: row.completedAt
  };
}

function readCurrentActivityPayload(
  value: Prisma.JsonValue | null
): WebChatTurnCurrentActivityState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    row.type !== "tool_use" ||
    typeof row.toolName !== "string" ||
    typeof row.toolCallId !== "string" ||
    (row.phase !== "start" && row.phase !== "end") ||
    typeof row.isError !== "boolean" ||
    typeof row.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    type: "tool_use",
    toolName: row.toolName,
    toolCallId: row.toolCallId,
    phase: row.phase,
    isError: row.isError,
    updatedAt: row.updatedAt,
    ...(typeof row.toolInputPreview === "string" && row.toolInputPreview.trim().length > 0
      ? { toolInputPreview: row.toolInputPreview.trim() }
      : {})
  };
}

@Injectable()
export class WebChatTurnAttemptService {
  private readonly logger = new Logger(WebChatTurnAttemptService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async claim(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    claimedAt: Date;
    staleAfterMs: number;
    surfaceClient?: string | null;
  }): Promise<WebTurnClaimResult> {
    const existing = await this.prisma.assistantWebChatTurnAttempt.findUnique({
      where: {
        assistantId_userId_surfaceThreadKey_clientTurnId: {
          assistantId: input.assistantId,
          userId: input.userId,
          surfaceThreadKey: input.surfaceThreadKey,
          clientTurnId: input.clientTurnId
        }
      }
    });

    if (existing !== null) {
      if (existing.status === "completed") {
        this.logger.log(
          `web_turn_attempt_replay_duplicate_prevented assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} status=completed`
        );
        return "duplicate_handled";
      }
      const runningAt = existing.runningAt ?? existing.acceptedAt ?? existing.updatedAt;
      const fresh =
        !TERMINAL_STATUSES.has(existing.status as WebChatTurnAttemptStatus) &&
        input.claimedAt.getTime() - runningAt.getTime() < input.staleAfterMs;
      if (fresh) {
        this.logger.log(
          `web_turn_attempt_duplicate_inflight assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} status=${existing.status}`
        );
        return "duplicate_inflight";
      }
      await this.prisma.assistantWebChatTurnAttempt.update({
        where: { id: existing.id },
        data: {
          status: "accepted",
          acceptedAt: input.claimedAt,
          runningAt: null,
          completedAt: null,
          failedAt: null,
          interruptedAt: null,
          currentActivity: Prisma.DbNull,
          errorCode: null,
          errorMessage: null,
          surfaceClient: input.surfaceClient ?? existing.surfaceClient
        }
      });
      return "claimed";
    }

    await this.prisma.assistantWebChatTurnAttempt.create({
      data: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        surfaceClient: input.surfaceClient ?? null,
        status: "accepted",
        acceptedAt: input.claimedAt
      }
    });
    this.logger.log(
      `web_turn_attempt_accepted assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} surfaceClient=${input.surfaceClient ?? "unknown"}`
    );
    return "claimed";
  }

  async markRunning(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    chatId: string;
    /** Null for async continuations (no new user row; avoid history-merge heuristics). */
    userMessageId: string | null;
    surfaceClient?: string | null;
  }): Promise<void> {
    await this.prisma.assistantWebChatTurnAttempt.update({
      where: {
        assistantId_userId_surfaceThreadKey_clientTurnId: {
          assistantId: input.assistantId,
          userId: input.userId,
          surfaceThreadKey: input.surfaceThreadKey,
          clientTurnId: input.clientTurnId
        }
      },
      data: {
        status: "running",
        chatId: input.chatId,
        userMessageId: input.userMessageId,
        runningAt: new Date(),
        ...(input.surfaceClient === undefined ? {} : { surfaceClient: input.surfaceClient })
      }
    });
    this.logger.log(
      `web_turn_attempt_running assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} chatId=${input.chatId} userMessageId=${input.userMessageId ?? "null"}`
    );
  }

  /**
   * ADR-152 — busy before acceptance must not leave the attempt `running`
   * (duplicate_inflight) or terminal-failed (client toast). Reset to accepted
   * so the scheduler reclaim can claim again after requeue.
   */
  async resetToAccepted(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
  }): Promise<void> {
    const updated = await this.prisma.assistantWebChatTurnAttempt.updateMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        status: { in: ["accepted", "running"] }
      },
      data: {
        status: "accepted",
        runningAt: null,
        currentActivity: Prisma.DbNull,
        errorCode: null,
        errorMessage: null,
        userMessageId: null,
        assistantMessageId: null,
        respondedAt: null,
        terminalPayload: Prisma.DbNull
      }
    });
    if (updated.count === 0) {
      this.logger.log(
        `web_turn_attempt_reset_accepted_ignored assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} reason=already_terminal`
      );
      return;
    }
    this.logger.log(
      `web_turn_attempt_reset_accepted assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId}`
    );
  }

  async markCompleted(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    assistantMessageId: string;
    respondedAt: string;
    terminalPayload: CompletedWebTurnReplayState;
  }): Promise<void> {
    const updated = await this.prisma.assistantWebChatTurnAttempt.updateMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        status: { in: ["accepted", "running"] }
      },
      data: {
        status: "completed",
        assistantMessageId: input.assistantMessageId,
        respondedAt: new Date(input.respondedAt),
        currentActivity: Prisma.DbNull,
        terminalPayload: input.terminalPayload as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });
    if (updated.count === 0) {
      this.logger.log(
        `web_turn_attempt_completed_ignored assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} reason=already_terminal`
      );
      return;
    }
    this.logger.log(
      `web_turn_attempt_completed assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} assistantMessageId=${input.assistantMessageId}`
    );
  }

  async markFailed(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    code: string;
    message: string;
  }): Promise<void> {
    await this.markTerminalFailure({ ...input, status: "failed" });
  }

  async markInterrupted(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    assistantMessageId?: string | null;
    code?: string | null;
    message?: string | null;
  }): Promise<void> {
    await this.markTerminalFailure({ ...input, status: "interrupted" });
  }

  async markCurrentActivity(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    toolName: string;
    toolCallId: string;
    phase: "start" | "end";
    isError: boolean;
    toolInputPreview?: string;
    updatedAt?: Date;
  }): Promise<void> {
    const updatedAt = input.updatedAt ?? new Date();
    await this.prisma.assistantWebChatTurnAttempt.updateMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        status: { in: ["accepted", "running"] }
      },
      data: {
        currentActivity: {
          type: "tool_use",
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          phase: input.phase,
          isError: input.isError,
          updatedAt: updatedAt.toISOString(),
          ...(typeof input.toolInputPreview === "string" && input.toolInputPreview.trim().length > 0
            ? { toolInputPreview: input.toolInputPreview.trim() }
            : {})
        } satisfies WebChatTurnCurrentActivityState
      }
    });
  }

  /** ADR-149 H3 — progress-only heartbeat without clobbering currentActivity payload. */
  async touchRunningAttempt(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
  }): Promise<void> {
    await this.prisma.assistantWebChatTurnAttempt.updateMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        status: { in: ["accepted", "running"] }
      },
      data: {
        updatedAt: new Date()
      }
    });
  }

  async getCompletedReplay(input: {
    assistantId: string;
    userId: string;
    clientTurnId: string;
  }): Promise<CompletedWebTurnReplayState | null> {
    const attempt = await this.prisma.assistantWebChatTurnAttempt.findFirst({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        clientTurnId: input.clientTurnId,
        status: "completed"
      }
    });
    return attempt ? readTerminalPayload(attempt.terminalPayload) : null;
  }

  async getStatusForUser(
    userId: string,
    clientTurnId: string,
    assistantId?: string
  ): Promise<WebChatTurnStatusState> {
    const resolved = await this.resolveActiveAssistantService.execute({
      userId,
      ...(assistantId === undefined ? {} : { assistantId })
    });
    const attempt = await this.prisma.assistantWebChatTurnAttempt.findFirst({
      where: {
        assistantId: resolved.assistantId,
        userId,
        clientTurnId
      }
    });
    if (attempt === null) {
      this.logger.log(
        `web_turn_status_lookup_unknown assistantId=${resolved.assistantId} clientTurnId=${clientTurnId}`
      );
      return {
        status: "unknown",
        chat: null,
        userMessage: null,
        assistantMessage: null,
        currentActivity: null,
        runtime: null,
        error: null
      };
    }
    this.logger.log(
      `web_turn_status_lookup assistantId=${resolved.assistantId} clientTurnId=${clientTurnId} status=${attempt.status}`
    );
    return this.buildStatus(attempt.id);
  }

  async getActiveTurnForChat(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<AssistantWebChatActiveTurnState | null> {
    const attempt = await this.prisma.assistantWebChatTurnAttempt.findFirst({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        chatId: input.chatId,
        status: { in: ["accepted", "running"] }
      },
      orderBy: { updatedAt: "desc" }
    });
    if (attempt === null) {
      return null;
    }
    const status = await this.buildStatus(attempt.id);
    if (status.status !== "accepted" && status.status !== "running") {
      return null;
    }
    return {
      clientTurnId: attempt.clientTurnId,
      status: status.status,
      updatedAt: attempt.updatedAt.toISOString(),
      currentActivity: status.currentActivity,
      pendingUserMessageId: attempt.userMessageId,
      assistantMessageId: attempt.assistantMessageId,
      chat: status.chat,
      userMessage: status.userMessage,
      assistantMessage: status.assistantMessage,
      canReattach: status.status === "running"
    };
  }

  private async markTerminalFailure(input: {
    assistantId: string;
    userId: string;
    surfaceThreadKey: string;
    clientTurnId: string;
    status: "failed" | "interrupted";
    assistantMessageId?: string | null;
    code?: string | null;
    message?: string | null;
  }): Promise<void> {
    const updated = await this.prisma.assistantWebChatTurnAttempt.updateMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        surfaceThreadKey: input.surfaceThreadKey,
        clientTurnId: input.clientTurnId,
        status: { in: ["accepted", "running"] }
      },
      data: {
        status: input.status,
        ...(input.assistantMessageId === undefined
          ? {}
          : { assistantMessageId: input.assistantMessageId }),
        currentActivity: Prisma.DbNull,
        errorCode: input.code ?? null,
        errorMessage: input.message ?? null,
        ...(input.status === "failed" ? { failedAt: new Date() } : { interruptedAt: new Date() })
      }
    });
    if (updated.count === 0) {
      this.logger.log(
        `web_turn_attempt_terminal_write_ignored assistantId=${input.assistantId} threadKey=${input.surfaceThreadKey} clientTurnId=${input.clientTurnId} status=${input.status} reason=already_terminal`
      );
    }
  }

  private async buildStatus(attemptId: string): Promise<WebChatTurnStatusState> {
    const attempt = await this.prisma.assistantWebChatTurnAttempt.findUnique({
      where: { id: attemptId }
    });
    if (attempt === null) {
      throw new BadRequestException("Web chat turn attempt disappeared during status lookup.");
    }

    const terminal = readTerminalPayload(attempt.terminalPayload);
    const [chat, userMessage, assistantMessage, followUpAssistantMessage] = await Promise.all([
      attempt.chatId
        ? this.prisma.assistantChat.findUnique({ where: { id: attempt.chatId } })
        : Promise.resolve(null),
      attempt.userMessageId
        ? this.prisma.assistantChatMessage.findUnique({ where: { id: attempt.userMessageId } })
        : Promise.resolve(null),
      attempt.assistantMessageId
        ? this.prisma.assistantChatMessage.findUnique({
            where: { id: attempt.assistantMessageId }
          })
        : Promise.resolve(null),
      terminal?.followUpAssistantMessageId
        ? this.prisma.assistantChatMessage.findUnique({
            where: { id: terminal.followUpAssistantMessageId }
          })
        : Promise.resolve(null)
    ]);
    const messageIds = [userMessage?.id, assistantMessage?.id, followUpAssistantMessage?.id].filter(
      (id): id is string => typeof id === "string"
    );
    const attachments = await this.prisma.assistantChatMessageAttachment.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: { createdAt: "asc" }
    });
    const attachmentsByMessageId = new Map<string, AssistantWebChatMessageAttachmentState[]>();
    for (const attachment of attachments) {
      const existing = attachmentsByMessageId.get(attachment.messageId) ?? [];
      existing.push(toAttachmentState(attachment));
      attachmentsByMessageId.set(attachment.messageId, existing);
    }
    const status = attempt.status as WebChatTurnAttemptStatus;
    return {
      status,
      chat:
        chat === null
          ? null
          : {
              id: chat.id,
              assistantId: chat.assistantId,
              surface: chat.surface,
              surfaceThreadKey: chat.surfaceThreadKey,
              title: chat.title,
              chatMode: chat.chatMode,
              deepModeEnabled: chat.deepModeEnabled,
              skillDecisionState: parseSkillDecisionState(chat.skillDecisionState),
              archivedAt: chat.archivedAt?.toISOString() ?? null,
              lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
              createdAt: chat.createdAt.toISOString(),
              updatedAt: chat.updatedAt.toISOString()
            },
      userMessage:
        userMessage === null
          ? null
          : {
              id: userMessage.id,
              chatId: userMessage.chatId,
              assistantId: userMessage.assistantId,
              author: userMessage.author,
              content: userMessage.content,
              attachments: attachmentsByMessageId.get(userMessage.id) ?? [],
              createdAt: userMessage.createdAt.toISOString()
            },
      assistantMessage:
        assistantMessage === null
          ? null
          : {
              id: assistantMessage.id,
              chatId: assistantMessage.chatId,
              assistantId: assistantMessage.assistantId,
              author: assistantMessage.author,
              content: assistantMessage.content,
              attachments: attachmentsByMessageId.get(assistantMessage.id) ?? [],
              createdAt: assistantMessage.createdAt.toISOString()
            },
      ...(terminal?.followUpAssistantMessageId
        ? {
            followUpAssistantMessage:
              followUpAssistantMessage === null
                ? null
                : {
                    id: followUpAssistantMessage.id,
                    chatId: followUpAssistantMessage.chatId,
                    assistantId: followUpAssistantMessage.assistantId,
                    author: followUpAssistantMessage.author,
                    content: followUpAssistantMessage.content,
                    attachments: attachmentsByMessageId.get(followUpAssistantMessage.id) ?? [],
                    createdAt: followUpAssistantMessage.createdAt.toISOString()
                  }
          }
        : {}),
      currentActivity: TERMINAL_STATUSES.has(status)
        ? null
        : readCurrentActivityPayload(attempt.currentActivity),
      runtime:
        terminal === null
          ? null
          : {
              respondedAt: terminal.respondedAt,
              degradedByQuotaFallback: terminal.degradedByQuotaFallback,
              quotaFallbackReason:
                terminal.quotaFallbackReason === "token_budget_limit_reached"
                  ? terminal.quotaFallbackReason
                  : null,
              quotaFallbackModel: terminal.quotaFallbackModel,
              ...(terminal.turnRouting === undefined ? {} : { turnRouting: terminal.turnRouting })
            },
      error:
        attempt.errorCode === null && attempt.errorMessage === null
          ? null
          : { code: attempt.errorCode, message: attempt.errorMessage }
    };
  }
}
