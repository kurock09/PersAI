import { Injectable, Logger } from "@nestjs/common";
import type { AssistantInboundSurface } from "./assistant-inbound.types";
import { createAssistantInboundSafetyRestrictedError } from "./assistant-inbound-error";
import { countRecentSafetyWarnCases } from "./count-user-safety-warn-strikes";
import {
  buildSafetyModerationTriggerKey,
  EvaluateInboundSafetyPrecheckService
} from "./evaluate-inbound-safety-precheck.service";
import { EnqueueSafetyModerationReviewService } from "./enqueue-safety-moderation-review.service";
import { PersistSafetyInboundThreadNoticeService } from "./persist-safety-inbound-thread-notice.service";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../domain/safety-policy.types";
import type { InboundSafetyPrecheckOutcome } from "../domain/safety-policy.types";
import {
  requiresInboundSafetySyncHold,
  shouldEnqueueContour2Review
} from "./safety-moderation-review.shared";
import { isWarnFirstSafetyPack } from "./safety-moderation-decision";
import { SafetyModerationReviewCoreService } from "./safety-moderation-review-core.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type EnforceInboundSafetyPrecheckFollowThroughInput = {
  userId: string;
  assistantId: string;
  workspaceId: string;
  surface: AssistantInboundSurface;
  surfaceThreadKey: string;
  message: string;
  chatId: string | null;
  attachmentCount?: number;
};

@Injectable()
export class EnforceInboundSafetyPrecheckFollowThroughService {
  private readonly logger = new Logger(EnforceInboundSafetyPrecheckFollowThroughService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly evaluateInboundSafetyPrecheckService: EvaluateInboundSafetyPrecheckService,
    private readonly safetyModerationReviewCoreService: SafetyModerationReviewCoreService,
    private readonly enqueueSafetyModerationReviewService: EnqueueSafetyModerationReviewService,
    private readonly persistSafetyInboundThreadNoticeService: PersistSafetyInboundThreadNoticeService
  ) {}

  async enforce(input: EnforceInboundSafetyPrecheckFollowThroughInput): Promise<void> {
    const precheck = await this.evaluateInboundSafetyPrecheckService.evaluate({
      userId: input.userId,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      surface: input.surface,
      message: input.message,
      ...(input.attachmentCount !== undefined ? { attachmentCount: input.attachmentCount } : {})
    });
    const settings = this.evaluateInboundSafetyPrecheckService.getCachedSettings();
    if (settings?.contour2Enabled === false || precheck.route === "allow") {
      return;
    }

    const triggerKey = buildSafetyModerationTriggerKey({
      userId: input.userId,
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      message: input.message
    });

    if (requiresInboundSafetySyncHold(precheck.route)) {
      try {
        await this.reviewAndDenyIfBlocked({
          input,
          precheck,
          triggerKey,
          ...(settings?.syncHoldTimeoutMs !== undefined
            ? { moderationTimeoutMs: settings.syncHoldTimeoutMs }
            : {})
        });
        return;
      } catch (error) {
        if (this.isModerationAbortError(error)) {
          this.logger.debug(
            `Safety sync moderation aborted for ${triggerKey}; falling back to async contour-2 enqueue.`
          );
          await this.enqueueSafetyModerationReviewService.enqueueIfDeferred({
            userId: input.userId,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            surface: input.surface,
            surfaceThreadKey: input.surfaceThreadKey,
            message: input.message,
            precheck
          });
          return;
        }
        throw error;
      }
    }

    if (shouldEnqueueContour2Review(precheck.route)) {
      if (await this.shouldEscalateInboundStrikeReview(input.userId, precheck)) {
        await this.reviewAndDenyIfBlocked({ input, precheck, triggerKey });
        return;
      }
      await this.enqueueSafetyModerationReviewService.enqueueIfDeferred({
        userId: input.userId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        message: input.message,
        precheck
      });
    }
  }

  private async shouldEscalateInboundStrikeReview(
    userId: string,
    precheck: InboundSafetyPrecheckOutcome
  ): Promise<boolean> {
    if (!isWarnFirstSafetyPack(precheck.rulePack) || precheck.reasonCode === "none") {
      return false;
    }
    const priorWarnCases = await countRecentSafetyWarnCases(this.prisma, {
      userId,
      reasonCode: precheck.reasonCode,
      windowDays: this.readStrikeWindowDays()
    });
    return priorWarnCases >= 1;
  }

  private async reviewAndDenyIfBlocked(input: {
    input: EnforceInboundSafetyPrecheckFollowThroughInput;
    precheck: InboundSafetyPrecheckOutcome;
    triggerKey: string;
    moderationTimeoutMs?: number;
  }): Promise<void> {
    const review = await this.safetyModerationReviewCoreService.reviewTrigger({
      triggerKey: input.triggerKey,
      userId: input.input.userId,
      assistantId: input.input.assistantId,
      workspaceId: input.input.workspaceId,
      chatId: input.input.chatId,
      surface: input.input.surface,
      surfaceThreadKey: input.input.surfaceThreadKey,
      triggerText: input.input.message,
      precheck: input.precheck,
      ...(input.moderationTimeoutMs !== undefined
        ? { moderationTimeoutMs: input.moderationTimeoutMs }
        : {})
    });
    if (review.alreadyExisted) {
      return;
    }
    if (review.decision === "block_user" || review.restrictionCreated) {
      await this.persistSafetyInboundThreadNoticeService.persistRestrictedPlaceholderIfPossible({
        chatId: input.input.chatId,
        assistantId: input.input.assistantId,
        reasonCode: review.reasonCode ?? input.precheck.reasonCode
      });
      throw createAssistantInboundSafetyRestrictedError(
        SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE,
        { reasonCode: review.reasonCode ?? input.precheck.reasonCode }
      );
    }
  }

  private isModerationAbortError(error: unknown): boolean {
    return (
      error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))
    );
  }

  private readStrikeWindowDays(): number {
    const parsed = Number(process.env.SAFETY_MODERATION_STRIKE_WINDOW_DAYS ?? 30);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 30;
  }
}
