import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantAsyncJobHandleStateService } from "./assistant-async-job-handle-state.service";
import { AssistantDocumentJobReadService } from "./assistant-document-job-read.service";
import type {
  AssistantWebChatActiveDocumentJobState,
  AssistantWebChatActiveMediaJobState,
  AssistantWebChatActiveSandboxJobState,
  AssistantWebChatMessageAttachmentState
} from "./web-chat.types";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { WebChatTurnStreamRegistry } from "./web-chat-turn-stream-registry.service";
import { AssistantMediaJobService } from "./workspace-media-job.service";

export type OpenWebUserTurnAttempt = {
  assistantId: string;
  userId: string;
  chatId: string;
  surfaceThreadKey: string;
  clientTurnId: string;
  userMessageId: string;
  assistantMessageId: string | null;
};

/**
 * ADR-165 — single live-present contour for open USER_TURN web streams.
 *
 * Job completion (await-inline or ordinary deferred that finishes while the
 * source turn is still streaming) publishes the same SSE shapes the turn
 * owner already understands: `media` for receipts and `async_jobs_open` for
 * the Working banner. No second websocket / parallel client handler family.
 */
@Injectable()
export class WebChatLiveTurnPresentService {
  private readonly logger = new Logger(WebChatLiveTurnPresentService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly streamRegistry: WebChatTurnStreamRegistry,
    private readonly webChatTurnAttemptService: WebChatTurnAttemptService,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly assistantDocumentJobReadService: AssistantDocumentJobReadService,
    @Inject(AssistantAsyncJobHandleStateService)
    private readonly asyncJobHandleState: Pick<
      AssistantAsyncJobHandleStateService,
      "claimOpenTurnLivePresent" | "listOpenSandboxJobsForWebChat"
    >,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async findOpenUserTurnAttempt(input: {
    assistantId: string;
    chatId: string;
    userMessageId: string;
  }): Promise<OpenWebUserTurnAttempt | null> {
    const row = await this.prisma.assistantWebChatTurnAttempt.findFirst({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        userMessageId: input.userMessageId,
        status: "running",
        NOT: { surfaceClient: "async_continuation" }
      },
      orderBy: [{ runningAt: "desc" }, { updatedAt: "desc" }],
      select: {
        assistantId: true,
        userId: true,
        chatId: true,
        surfaceThreadKey: true,
        clientTurnId: true,
        userMessageId: true,
        assistantMessageId: true
      }
    });
    if (
      row === null ||
      row.chatId === null ||
      row.userMessageId === null ||
      typeof row.clientTurnId !== "string" ||
      row.clientTurnId.trim().length === 0
    ) {
      return null;
    }
    return {
      assistantId: row.assistantId,
      userId: row.userId,
      chatId: row.chatId,
      surfaceThreadKey: row.surfaceThreadKey,
      clientTurnId: row.clientTurnId,
      userMessageId: row.userMessageId,
      assistantMessageId: row.assistantMessageId
    };
  }

  /**
   * Prefer the running attempt's bound assistant row; create+bind an early
   * empty bubble when mid-loop media lands before the first delta.
   */
  async ensureOpenTurnAssistantMessage(input: {
    attempt: OpenWebUserTurnAttempt;
    preferredMessageId?: string | null;
  }): Promise<string> {
    const preferred =
      typeof input.preferredMessageId === "string" && input.preferredMessageId.trim().length > 0
        ? input.preferredMessageId.trim()
        : null;
    if (preferred !== null) {
      if (input.attempt.assistantMessageId !== preferred) {
        await this.webChatTurnAttemptService.bindAssistantMessageId({
          assistantId: input.attempt.assistantId,
          userId: input.attempt.userId,
          surfaceThreadKey: input.attempt.surfaceThreadKey,
          clientTurnId: input.attempt.clientTurnId,
          assistantMessageId: preferred
        });
        input.attempt.assistantMessageId = preferred;
      }
      return preferred;
    }
    if (
      typeof input.attempt.assistantMessageId === "string" &&
      input.attempt.assistantMessageId.trim().length > 0
    ) {
      return input.attempt.assistantMessageId;
    }
    const early = await this.assistantChatRepository.createMessage({
      chatId: input.attempt.chatId,
      assistantId: input.attempt.assistantId,
      author: "assistant",
      content: "",
      metadata: {
        sourceUserMessageId: input.attempt.userMessageId,
        inlineMediaPlacement: []
      }
    });
    await this.webChatTurnAttemptService.bindAssistantMessageId({
      assistantId: input.attempt.assistantId,
      userId: input.attempt.userId,
      surfaceThreadKey: input.attempt.surfaceThreadKey,
      clientTurnId: input.attempt.clientTurnId,
      assistantMessageId: early.id
    });
    input.attempt.assistantMessageId = early.id;
    return early.id;
  }

  async claimInlineForOpenTurnPresent(input: {
    kind: "media" | "document";
    canonicalJobId: string;
  }): Promise<boolean> {
    return this.asyncJobHandleState.claimOpenTurnLivePresent(input);
  }

  publishMedia(input: {
    attempt: OpenWebUserTurnAttempt;
    assistantMessageId: string;
    attachments: AssistantWebChatMessageAttachmentState[];
    afterToolCallId?: string;
  }): void {
    if (input.attachments.length === 0) {
      return;
    }
    this.streamRegistry.publish({
      assistantId: input.attempt.assistantId,
      clientTurnId: input.attempt.clientTurnId,
      userId: input.attempt.userId,
      event: "media",
      payload: {
        assistantMessageId: input.assistantMessageId,
        attachments: input.attachments,
        ...(input.afterToolCallId === undefined ? {} : { afterToolCallId: input.afterToolCallId })
      }
    });
  }

  async publishOpenJobsSnapshot(input: { attempt: OpenWebUserTurnAttempt }): Promise<void> {
    try {
      const [activeMediaJobs, activeDocumentJobs, activeSandboxJobs] = await Promise.all([
        this.assistantMediaJobService.listOpenJobsForWebChat({
          assistantId: input.attempt.assistantId,
          userId: input.attempt.userId,
          chatId: input.attempt.chatId
        }),
        this.assistantDocumentJobReadService.listOpenJobsForWebChat({
          assistantId: input.attempt.assistantId,
          userId: input.attempt.userId,
          chatId: input.attempt.chatId
        }),
        this.asyncJobHandleState.listOpenSandboxJobsForWebChat({
          assistantId: input.attempt.assistantId,
          chatId: input.attempt.chatId
        })
      ]);
      this.streamRegistry.publish({
        assistantId: input.attempt.assistantId,
        clientTurnId: input.attempt.clientTurnId,
        userId: input.attempt.userId,
        event: "async_jobs_open",
        payload: {
          activeMediaJobs,
          activeDocumentJobs,
          activeSandboxJobs
        } satisfies {
          activeMediaJobs: AssistantWebChatActiveMediaJobState[];
          activeDocumentJobs: AssistantWebChatActiveDocumentJobState[];
          activeSandboxJobs: AssistantWebChatActiveSandboxJobState[];
        }
      });
    } catch (error) {
      this.logger.warn(
        `web_chat_live_open_jobs_publish_failed assistantId=${input.attempt.assistantId} clientTurnId=${input.attempt.clientTurnId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
