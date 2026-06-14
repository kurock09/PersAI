import { Injectable, Logger } from "@nestjs/common";
import type { SafetyModerationReviewJob } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { readPrecheckOutcome, readTriggerText } from "./safety-moderation-review.shared";
import { SafetyModerationReviewCoreService } from "./safety-moderation-review-core.service";

type ClaimedSafetyModerationReviewJob = Pick<
  SafetyModerationReviewJob,
  | "id"
  | "triggerKey"
  | "userId"
  | "assistantId"
  | "workspaceId"
  | "chatId"
  | "surface"
  | "surfaceThreadKey"
  | "messageSnapshot"
  | "precheckOutcome"
>;

@Injectable()
export class ProcessSafetyModerationReviewService {
  private readonly logger = new Logger(ProcessSafetyModerationReviewService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly safetyModerationReviewCoreService: SafetyModerationReviewCoreService
  ) {}

  async processClaimedJob(job: ClaimedSafetyModerationReviewJob): Promise<void> {
    const precheck = readPrecheckOutcome(job.precheckOutcome);
    const triggerText = await this.resolveTriggerText(job);
    await this.safetyModerationReviewCoreService.reviewTrigger({
      triggerKey: job.triggerKey,
      userId: job.userId,
      assistantId: job.assistantId,
      workspaceId: job.workspaceId,
      chatId: job.chatId,
      surface: job.surface,
      surfaceThreadKey: job.surfaceThreadKey,
      triggerText,
      precheck
    });
    await this.prisma.safetyModerationReviewJob.update({
      where: { id: job.id },
      data: { status: "completed" }
    });
  }

  async markJobFailed(jobId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Safety moderation review job ${jobId} failed: ${message}`);
    await this.prisma.safetyModerationReviewJob.update({
      where: { id: jobId },
      data: { status: "failed" }
    });
  }

  private async resolveTriggerText(job: ClaimedSafetyModerationReviewJob): Promise<string> {
    const fromSnapshot = readTriggerText(job.messageSnapshot);
    if (fromSnapshot.length > 0) {
      return fromSnapshot;
    }
    if (job.chatId === null) {
      return "";
    }
    const latestUserMessage = await this.prisma.assistantChatMessage.findFirst({
      where: {
        chatId: job.chatId,
        assistantId: job.assistantId,
        author: "user"
      },
      orderBy: { createdAt: "desc" },
      select: { content: true }
    });
    return latestUserMessage?.content.trim() ?? "";
  }
}
