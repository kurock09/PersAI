import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, type SafetyModerationReviewJob } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ProcessSafetyModerationReviewService } from "./process-safety-moderation-review.service";

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
export class SafetyModerationReviewSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SafetyModerationReviewSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly processSafetyModerationReviewService: ProcessSafetyModerationReviewService
  ) {}

  onModuleInit(): void {
    const config = loadApiConfig(process.env);
    if (!config.SAFETY_MODERATION_ENABLED) {
      this.logger.log("Safety moderation review scheduler is disabled by configuration.");
      return;
    }
    this.scheduleNext(config.SAFETY_MODERATION_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueJobsBatch(limit?: number): Promise<number> {
    const config = loadApiConfig(process.env);
    const batchSize = limit ?? config.SAFETY_MODERATION_BATCH_SIZE;
    const claimed = await this.claimDueJobs(
      batchSize,
      config.SAFETY_MODERATION_STUCK_PROCESSING_MS
    );
    for (const job of claimed) {
      try {
        await this.processSafetyModerationReviewService.processClaimedJob(job);
      } catch (error) {
        await this.processSafetyModerationReviewService.markJobFailed(job.id, error);
      }
    }
    return claimed.length;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    const config = loadApiConfig(process.env);
    if (this.stopped || this.running || !config.SAFETY_MODERATION_ENABLED) {
      this.scheduleNext(config.SAFETY_MODERATION_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      await this.processDueJobsBatch();
    } catch (error) {
      this.logger.error(
        `Safety moderation review scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      this.running = false;
      this.scheduleNext(config.SAFETY_MODERATION_POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(
    limit: number,
    stuckProcessingMs: number
  ): Promise<ClaimedSafetyModerationReviewJob[]> {
    const stuckBefore = new Date(Date.now() - stuckProcessingMs);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedSafetyModerationReviewJob[]>(Prisma.sql`
        UPDATE safety_moderation_review_jobs AS jobs
        SET status = 'processing', updated_at = NOW()
        FROM (
          SELECT id
          FROM safety_moderation_review_jobs
          WHERE status = 'pending'
             OR (
               status = 'processing'
               AND updated_at <= ${stuckBefore}
             )
          ORDER BY created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ) AS picked
        WHERE jobs.id = picked.id
        RETURNING
          jobs.id AS "id",
          jobs.trigger_key AS "triggerKey",
          jobs.user_id AS "userId",
          jobs.assistant_id AS "assistantId",
          jobs.workspace_id AS "workspaceId",
          jobs.chat_id AS "chatId",
          jobs.surface AS "surface",
          jobs.surface_thread_key AS "surfaceThreadKey",
          jobs.message_snapshot AS "messageSnapshot",
          jobs.precheck_outcome AS "precheckOutcome"
      `);
      return rows;
    });
  }
}
