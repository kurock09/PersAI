import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { TelegramAlbumCollectorService } from "./telegram-album-collector.service";
import { TelegramChannelAdapterService } from "./telegram-channel-adapter.service";
import {
  TELEGRAM_ALBUM_FINALIZER_BATCH_SIZE,
  TELEGRAM_ALBUM_FINALIZER_POLL_INTERVAL_MS,
  TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY
} from "./telegram-album.types";

@Injectable()
export class TelegramAlbumFinalizerSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramAlbumFinalizerSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly telegramAlbumCollectorService: TelegramAlbumCollectorService,
    private readonly telegramChannelAdapterService: TelegramChannelAdapterService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(TELEGRAM_ALBUM_FINALIZER_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueAlbumsBatch(limit = TELEGRAM_ALBUM_FINALIZER_BATCH_SIZE): Promise<number> {
    const claimed = await this.telegramAlbumCollectorService.claimAndFinalizeReady(
      new Date(),
      limit
    );
    let processed = 0;
    for (const album of claimed) {
      if (this.leaseLost) {
        break;
      }
      try {
        const outcome = await this.telegramChannelAdapterService.finalizeCollectedAlbum(album);
        if (outcome === "ok") {
          await this.telegramAlbumCollectorService.deleteClaimed(album.id, album.claimToken);
          processed += 1;
          continue;
        }
        await this.telegramAlbumCollectorService.releaseClaim(album.id, album.claimToken);
        this.logger.warn(
          `Telegram album finalization ${outcome} for ${album.assistantId}/${album.mediaGroupId}; collector row retained for retry.`
        );
      } catch (error) {
        await this.telegramAlbumCollectorService.releaseClaim(album.id, album.claimToken);
        this.logger.warn(
          `Telegram album finalization failed for ${album.assistantId}/${album.mediaGroupId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    return processed;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(TELEGRAM_ALBUM_FINALIZER_POLL_INTERVAL_MS);
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
        TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY
      );
      this.logger.warn(`Telegram album finalizer scheduler lease lost: ${reason}`);
    };
    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(
        TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY
      );
      const lease = await this.schedulerLeaseService.acquire(
        TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY
      );
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(
          TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY
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
          TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY
        );
      }

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY, lease.token)
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
        const runCount = await this.processDueAlbumsBatch();
        processed += runCount;
        if (runCount < TELEGRAM_ALBUM_FINALIZER_BATCH_SIZE) {
          break;
        }
      }
      if (processed > 0) {
        this.logger.log(`Finalized ${processed} Telegram media album(s).`);
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Telegram album finalizer scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        stack
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(
          TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY,
          leaseToken
        );
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(TELEGRAM_ALBUM_FINALIZER_POLL_INTERVAL_MS);
    }
  }
}
