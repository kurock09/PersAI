import { Injectable, Logger } from "@nestjs/common";
import type { AssistantInboundSurface } from "./assistant-inbound.types";
import { createAssistantInboundSafetyRestrictedError } from "./assistant-inbound-error";
import {
  buildSafetyModerationTriggerKey,
  EvaluateInboundSafetyPrecheckService
} from "./evaluate-inbound-safety-precheck.service";
import { EnqueueSafetyModerationReviewService } from "./enqueue-safety-moderation-review.service";
import { PersistSafetyInboundThreadNoticeService } from "./persist-safety-inbound-thread-notice.service";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../domain/safety-policy.types";
import {
  requiresInboundSafetySyncHold,
  shouldEnqueueContour2Review
} from "./safety-moderation-review.shared";
import { SafetyModerationReviewCoreService } from "./safety-moderation-review-core.service";

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
        const review = await this.safetyModerationReviewCoreService.reviewTrigger({
          triggerKey,
          userId: input.userId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          surface: input.surface,
          surfaceThreadKey: input.surfaceThreadKey,
          triggerText: input.message,
          precheck,
          ...(settings?.syncHoldTimeoutMs !== undefined
            ? { moderationTimeoutMs: settings.syncHoldTimeoutMs }
            : {})
        });
        if (review.alreadyExisted) {
          return;
        }
        if (review.decision === "block_user" || review.restrictionCreated) {
          await this.persistSafetyInboundThreadNoticeService.persistPlaceholderIfPossible({
            chatId: input.chatId,
            assistantId: input.assistantId,
            reasonCode: review.reasonCode ?? precheck.reasonCode
          });
          throw createAssistantInboundSafetyRestrictedError(
            SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE,
            { reasonCode: review.reasonCode ?? precheck.reasonCode }
          );
        }
        return;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted"))
        ) {
          this.logger.debug(
            `Safety sync moderation aborted for ${triggerKey}; falling back to async contour-2 enqueue.`
          );
        } else {
          throw error;
        }
      }
    }

    if (shouldEnqueueContour2Review(precheck.route)) {
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
}
