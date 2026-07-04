import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, type WorkspaceFileMicroDescriptionJob } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { WorkspaceFileMicroDescriptionJobService } from "./workspace-file-micro-description-job.service";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 4;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const SCHEDULER_KEY = "workspace_file_micro_description";

type ClaimedJob = Pick<
  WorkspaceFileMicroDescriptionJob,
  | "id"
  | "workspaceId"
  | "path"
  | "sourceAssistantId"
  | "attemptCount"
  | "maxAttempts"
  | "schedulerClaimToken"
>;

@Injectable()
export class WorkspaceFileMicroDescriptionJobSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkspaceFileMicroDescriptionJobSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly workspaceFileMicroDescriptionJobService: WorkspaceFileMicroDescriptionJobService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(POLL_INTERVAL_MS);
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
      this.scheduleNext(POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    this.leaseLost = false;
    const startedAt = Date.now();
    let processed = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;
    try {
      const lease = await this.schedulerLeaseService.acquire(SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(SCHEDULER_KEY);
        return;
      }
      leaseToken = lease.token;
      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(SCHEDULER_KEY, lease.token)
          .then((stillLeader) => {
            if (!stillLeader) {
              this.leaseLost = true;
            }
          })
          .catch(() => {
            this.leaseLost = true;
          });
      }, LEASE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      while (!this.stopped && !this.leaseLost) {
        const claimed = await this.claimDueJobs(BATCH_SIZE);
        if (claimed.length === 0) {
          break;
        }
        for (const job of claimed) {
          if (this.leaseLost) {
            break;
          }
          try {
            await this.workspaceFileMicroDescriptionJobService.processClaimedJob(job);
          } catch (error) {
            await this.workspaceFileMicroDescriptionJobService.markFailed(job, error);
          }
          processed += 1;
        }
        if (claimed.length < BATCH_SIZE) {
          break;
        }
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      this.logger.error(
        `Workspace file micro-description scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(SCHEDULER_KEY, leaseToken);
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<ClaimedJob[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
    const claimToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          path: string;
          sourceAssistantId: string | null;
          attemptCount: number;
          maxAttempts: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "workspace_id" AS "workspaceId",
          "path",
          "source_assistant_id" AS "sourceAssistantId",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts"
        FROM "workspace_file_micro_description_jobs"
        WHERE (
            "status" = 'pending'
            AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          )
          OR (
            "status" = 'processing'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "created_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await tx.workspaceFileMicroDescriptionJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "processing",
          schedulerClaimToken: claimToken,
          schedulerClaimedAt: now,
          schedulerClaimExpiresAt: claimExpiresAt
        }
      });
      return rows.map((row) => ({
        ...row,
        schedulerClaimToken: claimToken
      }));
    });
  }
}
