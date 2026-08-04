import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  AssistantAsyncJobHandleStateService,
  type OpenTurnLivePresentClaimOutcome
} from "./assistant-async-job-handle-state.service";
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
import type { PublicTurnEvent } from "./turn-event-wire-projection";

export type { OpenTurnLivePresentClaimOutcome };

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
    return this.findOpenOrdinaryUserTurnAttempt({
      assistantId: input.assistantId,
      chatId: input.chatId,
      userMessageId: input.userMessageId
    });
  }

  /**
   * ADR-167 — chat-scoped open ordinary USER_TURN for runtime register when
   * messageId is omitted. Same ownership filter as `findOpenUserTurnAttempt`
   * (running, not async_continuation); does not invent a second binding path.
   */
  async findOpenOrdinaryUserTurnAttemptForChat(input: {
    assistantId: string;
    chatId: string;
  }): Promise<OpenWebUserTurnAttempt | null> {
    return this.findOpenOrdinaryUserTurnAttempt({
      assistantId: input.assistantId,
      chatId: input.chatId
    });
  }

  private async findOpenOrdinaryUserTurnAttempt(input: {
    assistantId: string;
    chatId: string;
    userMessageId?: string;
  }): Promise<OpenWebUserTurnAttempt | null> {
    const row = await this.prisma.assistantWebChatTurnAttempt.findFirst({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        ...(input.userMessageId === undefined ? {} : { userMessageId: input.userMessageId }),
        status: "running",
        OR: [{ surfaceClient: null }, { surfaceClient: { not: "async_continuation" } }]
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
        const bound = await this.webChatTurnAttemptService.bindAssistantMessageId({
          assistantId: input.attempt.assistantId,
          userId: input.attempt.userId,
          surfaceThreadKey: input.attempt.surfaceThreadKey,
          clientTurnId: input.attempt.clientTurnId,
          assistantMessageId: preferred
        });
        if (bound !== null) {
          input.attempt.assistantMessageId = bound;
        }
      }
      return input.attempt.assistantMessageId ?? preferred;
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
      metadata: { sourceUserMessageId: input.attempt.userMessageId }
    });
    const bound = await this.webChatTurnAttemptService.bindOrDiscardAssistantMessageCandidate({
      assistantId: input.attempt.assistantId,
      userId: input.attempt.userId,
      surfaceThreadKey: input.attempt.surfaceThreadKey,
      clientTurnId: input.attempt.clientTurnId,
      candidateAssistantMessageId: early.id
    });
    if (bound === null) {
      throw new Error("Open web turn no longer accepts an assistant message binding.");
    }
    input.attempt.assistantMessageId = bound;
    return bound;
  }

  async claimInlineForOpenTurnPresent(input: {
    kind: "media" | "document";
    canonicalJobId: string;
  }): Promise<OpenTurnLivePresentClaimOutcome> {
    return this.asyncJobHandleState.claimOpenTurnLivePresent(input);
  }

  publishMedia(input: {
    attempt: OpenWebUserTurnAttempt;
    assistantMessageId: string;
    attachments: AssistantWebChatMessageAttachmentState[];
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
        attachments: input.attachments
      }
    });
  }

  async publishTurnEventsForOpenAttempt(input: {
    assistantId: string;
    assistantMessageId: string;
    events: PublicTurnEvent[];
  }): Promise<void> {
    if (input.events.length === 0) {
      return;
    }
    try {
      // Delivery belongs to this assistant message; its active stream may be
      // an async continuation, unlike the source-user-message lookup above.
      const attempt = await this.prisma.assistantWebChatTurnAttempt.findFirst({
        where: {
          assistantId: input.assistantId,
          assistantMessageId: input.assistantMessageId,
          status: "running"
        },
        orderBy: [{ runningAt: "desc" }, { updatedAt: "desc" }],
        select: {
          assistantId: true,
          userId: true,
          clientTurnId: true
        }
      });
      if (attempt === null) {
        this.logger.warn(
          `web_chat_live_turn_events_no_running_attempt assistantMessageId=${input.assistantMessageId} eventCount=${String(input.events.length)}`
        );
        return;
      }
      for (const event of input.events) {
        this.streamRegistry.publish({
          assistantId: attempt.assistantId,
          clientTurnId: attempt.clientTurnId,
          userId: attempt.userId,
          event: "turn_event",
          payload: { event }
        });
      }
    } catch (error) {
      this.logger.warn(
        `web_chat_live_turn_events_publish_failed assistantId=${input.assistantId} assistantMessageId=${input.assistantMessageId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async publishOpenJobsSnapshot(input: {
    attempt: OpenWebUserTurnAttempt;
    terminalJob?: { kind: "media" | "document"; id: string };
  }): Promise<void> {
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
          activeSandboxJobs,
          ...(input.terminalJob === undefined ? {} : { terminalJob: input.terminalJob })
        } satisfies {
          activeMediaJobs: AssistantWebChatActiveMediaJobState[];
          activeDocumentJobs: AssistantWebChatActiveDocumentJobState[];
          activeSandboxJobs: AssistantWebChatActiveSandboxJobState[];
          terminalJob?: { kind: "media" | "document"; id: string };
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
