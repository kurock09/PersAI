import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ReconcileOrphanTurnReceiptsService } from "./reconcile-orphan-turn-receipts.service";

const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 32;

@Injectable()
export class OrphanTurnReceiptReconcileSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrphanTurnReceiptReconcileSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly reconcileOrphanTurnReceiptsService: ReconcileOrphanTurnReceiptsService
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
    const result = await this.reconcileOrphanTurnReceiptsService.executeBatch(limit);
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
    try {
      await this.processDueBatch(BATCH_SIZE);
    } catch (error) {
      this.logger.error(
        `Orphan turn receipt reconcile scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      this.running = false;
      this.scheduleNext(POLL_INTERVAL_MS);
    }
  }
}
