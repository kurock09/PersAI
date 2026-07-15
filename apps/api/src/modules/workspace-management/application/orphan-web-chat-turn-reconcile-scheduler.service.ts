import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { ReconcileOrphanWebChatTurnAttemptsService } from "./reconcile-orphan-web-chat-turn-attempts.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 32;
const SCHEDULER_KEY = "orphan_web_turn_attempt";

@Injectable()
export class OrphanWebChatTurnReconcileSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrphanWebChatTurnReconcileSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly reconcileOrphanWebChatTurnAttemptsService: ReconcileOrphanWebChatTurnAttemptsService,
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

  async processDueBatch(limit = BATCH_SIZE): Promise<number> {
    const result = await this.reconcileOrphanWebChatTurnAttemptsService.executeBatch(limit);
    return result.applied;
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
        const applied = await this.processDueBatch(BATCH_SIZE);
        processed += applied;
        if (applied < BATCH_SIZE) {
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
        `Orphan web turn reconcile scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
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
