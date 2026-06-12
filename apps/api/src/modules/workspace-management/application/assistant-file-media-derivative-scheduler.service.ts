import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { AssistantFileRegistryService } from "./assistant-file-registry.service";
import { AssistantFileMediaDerivativeService } from "./media/assistant-file-media-derivative.service";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 8;
const SCHEDULER_KEY = "assistant_file_media_derivative";

@Injectable()
export class AssistantFileMediaDerivativeSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantFileMediaDerivativeSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService,
    private readonly assistantFileRegistryService: AssistantFileRegistryService,
    private readonly assistantFileMediaDerivativeService: AssistantFileMediaDerivativeService
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
    if (this.stopped) return;
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
    let leaseLostReported = false;
    const markLeaseLost = (reason: string): void => {
      if (leaseLostReported) return;
      leaseLostReported = true;
      this.leaseLost = true;
      this.backgroundSchedulerMetricsService.recordLeaseLost(SCHEDULER_KEY);
      this.logger.warn(`Assistant file media-derivative scheduler lease lost: ${reason}`);
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

      while (!this.stopped && !this.leaseLost) {
        const parents =
          await this.assistantFileRegistryService.listPendingMediaDerivativeParents(BATCH_SIZE);
        if (parents.length === 0) {
          break;
        }
        for (const file of parents) {
          if (this.leaseLost) {
            break;
          }
          await this.assistantFileMediaDerivativeService.processParentFile({
            assistantId: file.assistantId,
            workspaceId: file.workspaceId,
            fileRef: file.fileRef
          });
          processed += 1;
        }
        if (parents.length < BATCH_SIZE) {
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
        `Assistant file media-derivative scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
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
}
