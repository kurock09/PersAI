import { Injectable, Logger } from "@nestjs/common";
import type { AssistantInboundSurface } from "./assistant-inbound.types";
import type { InboundSafetyPrecheckOutcome } from "../domain/safety-policy.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { buildSafetyModerationTriggerKey } from "./evaluate-inbound-safety-precheck.service";
import { shouldEnqueueContour2Review } from "./safety-moderation-review.shared";

export type EnqueueSafetyModerationReviewInput = {
  userId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string | null;
  surface: AssistantInboundSurface;
  surfaceThreadKey: string | null;
  message: string;
  precheck: InboundSafetyPrecheckOutcome;
};

@Injectable()
export class EnqueueSafetyModerationReviewService {
  private readonly logger = new Logger(EnqueueSafetyModerationReviewService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async enqueueIfDeferred(input: EnqueueSafetyModerationReviewInput): Promise<void> {
    if (!shouldEnqueueContour2Review(input.precheck.route)) {
      return;
    }

    const triggerKey = buildSafetyModerationTriggerKey({
      userId: input.userId,
      assistantId: input.assistantId,
      surface: input.surface,
      surfaceThreadKey: input.surfaceThreadKey,
      message: input.message
    });

    await this.prisma.safetyModerationReviewJob.upsert({
      where: { triggerKey },
      create: {
        triggerKey,
        userId: input.userId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        messageSnapshot: {
          triggerText: input.message.trim(),
          textLength: input.message.trim().length,
          hasText: input.message.trim().length > 0
        },
        precheckOutcome: input.precheck,
        status: "pending"
      },
      update: {
        messageSnapshot: {
          triggerText: input.message.trim(),
          textLength: input.message.trim().length,
          hasText: input.message.trim().length > 0
        },
        precheckOutcome: input.precheck,
        status: "pending"
      }
    });

    this.logger.debug(
      `Queued safety moderation review ${triggerKey} route=${input.precheck.route} pack=${input.precheck.rulePack ?? "none"}`
    );
  }
}
