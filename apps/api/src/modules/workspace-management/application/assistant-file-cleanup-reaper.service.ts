import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { AssistantFileRegistryService } from "./assistant-file-registry.service";

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 200;
const SCHEDULER_KEY = "assistant_file_cleanup_reaper" as const;

type EligibleAssistantRow = {
  assistantId: string;
  workspaceId: string;
};

@Injectable()
export class AssistantFileCleanupReaperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantFileCleanupReaperService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService,
    private readonly assistantFileRegistryService: AssistantFileRegistryService
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
    let assistantsTouched = 0;
    let totalDeletedCount = 0;
    let totalDeletedBytes = 0;
    let totalSkippedPinnedCount = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;
    let leaseLostReported = false;

    const markLeaseLost = (reason: string): void => {
      if (leaseLostReported) {
        return;
      }
      leaseLostReported = true;
      this.leaseLost = true;
      this.backgroundSchedulerMetricsService.recordLeaseLost(SCHEDULER_KEY);
      this.logger.warn(`[assistant-file-cleanup-reaper] lease lost: ${reason}`);
    };

    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(SCHEDULER_KEY);
      const lease = await this.schedulerLeaseService.acquire(SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(SCHEDULER_KEY);
        return;
      }
      leaseToken = lease.token;
      if (
        previousLease !== null &&
        previousLease.holderId !== "" &&
        previousLease.expiresAt.getTime() <= startedAt
      ) {
        this.backgroundSchedulerMetricsService.recordLeaseExpiredRecovered(SCHEDULER_KEY);
      }

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(SCHEDULER_KEY, lease.token)
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

      const eligibleAssistants = await this.queryEligibleAssistants(BATCH_SIZE);

      for (const row of eligibleAssistants) {
        if (this.stopped || this.leaseLost) {
          break;
        }
        try {
          const result = await this.assistantFileRegistryService.cleanupAssistantFileCache({
            assistantId: row.assistantId,
            workspaceId: row.workspaceId
          });
          assistantsTouched += 1;
          totalDeletedCount += result.deletedCount;
          totalDeletedBytes += result.deletedBytes;
          totalSkippedPinnedCount += result.skippedPinnedCount;
        } catch (error) {
          this.logger.error(
            `[assistant-file-cleanup-reaper] error processing assistant ${row.assistantId}: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined
          );
        }
      }

      this.backgroundSchedulerMetricsService.recordTickAcquired(
        SCHEDULER_KEY,
        Date.now() - startedAt,
        assistantsTouched
      );

      this.logger.log(
        `[assistant-file-cleanup-reaper] tick complete: assistantsTouched=${assistantsTouched} deletedCount=${totalDeletedCount} deletedBytes=${totalDeletedBytes} skippedPinnedCount=${totalSkippedPinnedCount} durationMs=${Date.now() - startedAt}`
      );
    } catch (error) {
      this.logger.error(
        `[assistant-file-cleanup-reaper] tick failed: ${error instanceof Error ? error.message : String(error)}`,
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

  private async queryEligibleAssistants(limit: number): Promise<EligibleAssistantRow[]> {
    return this.prisma.$queryRaw<EligibleAssistantRow[]>(Prisma.sql`
      SELECT DISTINCT
        af.assistant_id AS "assistantId",
        af.workspace_id AS "workspaceId"
      FROM assistant_files af
      WHERE af.origin = 'uploaded_attachment'
        AND af.mime_type LIKE 'audio/%'
        AND af.created_at < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1
          FROM assistant_chat_message_attachments acma
          WHERE acma.assistant_file_id = af.id
        )
      LIMIT ${limit}
    `);
  }
}
