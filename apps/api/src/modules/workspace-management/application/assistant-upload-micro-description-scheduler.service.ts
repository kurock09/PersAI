import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, type AssistantUploadMicroDescriptionJob } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { AssistantUploadMicroDescriptionJobService } from "./assistant-upload-micro-description-job.service";

const UPLOAD_MICRO_DESCRIPTION_POLL_INTERVAL_MS = 5_000;
const UPLOAD_MICRO_DESCRIPTION_BATCH_SIZE = 6;
const UPLOAD_MICRO_DESCRIPTION_CLAIM_TTL_MS = 10 * 60 * 1000;
const UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY = "upload_micro_description";

type ClaimedUploadMicroDescriptionJob = Pick<
  AssistantUploadMicroDescriptionJob,
  | "id"
  | "assistantId"
  | "workspaceId"
  | "assistantFileId"
  | "sourceAttachmentId"
  | "attemptCount"
  | "maxAttempts"
> & {
  claimToken: string;
};

@Injectable()
export class AssistantUploadMicroDescriptionSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssistantUploadMicroDescriptionSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService,
    private readonly assistantUploadMicroDescriptionJobService: AssistantUploadMicroDescriptionJobService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(UPLOAD_MICRO_DESCRIPTION_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      this.scheduleNext(UPLOAD_MICRO_DESCRIPTION_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    this.leaseLost = false;
    const startedAt = Date.now();
    let processed = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;
    let leaseLostReported = false;
    const markLeaseLost = (reason: string): void => {
      if (leaseLostReported) {
        return;
      }
      leaseLostReported = true;
      this.leaseLost = true;
      this.backgroundSchedulerMetricsService.recordLeaseLost(
        UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY
      );
      this.logger.warn(`Upload micro-description scheduler lease lost: ${reason}`);
    };
    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(
        UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY
      );
      const lease = await this.schedulerLeaseService.acquire(
        UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY
      );
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(
          UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY
        );
        return;
      }
      leaseToken = lease.token;
      if (
        previousLease !== null &&
        previousLease.holderId !== "" &&
        previousLease.expiresAt.getTime() <= startedAt
      ) {
        this.backgroundSchedulerMetricsService.recordLeaseExpiredRecovered(
          UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY
        );
      }
      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY, lease.token)
          .then((stillLeader) => {
            if (!stillLeader) {
              markLeaseLost("heartbeat token no longer matched active leader");
            }
          })
          .catch((error) => {
            markLeaseLost(error instanceof Error ? error.message : String(error));
          });
      }, LEASE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      while (!this.stopped && !this.leaseLost) {
        const claimed = await this.claimDueJobs(UPLOAD_MICRO_DESCRIPTION_BATCH_SIZE);
        if (claimed.length === 0) {
          break;
        }
        for (const job of claimed) {
          if (this.leaseLost) {
            break;
          }
          try {
            await this.assistantUploadMicroDescriptionJobService.markRunning(job.id);
            await this.assistantUploadMicroDescriptionJobService.processClaimedJob(job);
          } catch (error) {
            await this.assistantUploadMicroDescriptionJobService.markFailed(job, error);
          }
          processed += 1;
        }
        if (claimed.length < UPLOAD_MICRO_DESCRIPTION_BATCH_SIZE) {
          break;
        }
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      this.logger.error(
        `Upload micro-description scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(
          UPLOAD_MICRO_DESCRIPTION_SCHEDULER_KEY,
          leaseToken
        );
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(UPLOAD_MICRO_DESCRIPTION_POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<ClaimedUploadMicroDescriptionJob[]> {
    const now = new Date();
    const claimToken = randomUUID();
    const claimExpiresAt = new Date(now.getTime() + UPLOAD_MICRO_DESCRIPTION_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          workspaceId: string;
          assistantFileId: string;
          sourceAttachmentId: string | null;
          attemptCount: number;
          maxAttempts: number;
        }>
      >(Prisma.sql`
        SELECT
          id,
          assistant_id AS "assistantId",
          workspace_id AS "workspaceId",
          assistant_file_id AS "assistantFileId",
          source_attachment_id AS "sourceAttachmentId",
          attempt_count AS "attemptCount",
          max_attempts AS "maxAttempts"
        FROM assistant_upload_micro_description_jobs
        WHERE status = 'queued'
          AND (next_retry_at IS NULL OR next_retry_at <= ${now})
          AND (scheduler_claim_expires_at IS NULL OR scheduler_claim_expires_at <= ${now})
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await tx.assistantUploadMicroDescriptionJob.updateMany({
        where: { id: { in: ids } },
        data: {
          schedulerClaimToken: claimToken,
          schedulerClaimedAt: now,
          schedulerClaimExpiresAt: claimExpiresAt
        }
      });
      return rows.map((row) => ({
        ...row,
        claimToken
      }));
    });
  }
}
