import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { AdminSystemNotificationProducerService } from "./admin-system-notification-producer.service";

const ADMIN_SYSTEM_DAILY_REPORT_SCHEDULER_KEY = "admin_system_daily_report";
const ADMIN_SYSTEM_DAILY_REPORT_POLL_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class AdminSystemDailyReportSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminSystemDailyReportSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly adminSystemNotificationProducerService: AdminSystemNotificationProducerService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(0);
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
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(ADMIN_SYSTEM_DAILY_REPORT_POLL_INTERVAL_MS);
      return;
    }

    this.running = true;
    this.leaseLost = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;

    try {
      const lease = await this.schedulerLeaseService.acquire(
        ADMIN_SYSTEM_DAILY_REPORT_SCHEDULER_KEY
      );
      if (lease === null) {
        return;
      }
      leaseToken = lease.token;

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(ADMIN_SYSTEM_DAILY_REPORT_SCHEDULER_KEY, lease.token)
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

      if (!this.leaseLost) {
        const created = await this.adminSystemNotificationProducerService.processDueDailyReports();
        if (created > 0) {
          this.logger.log(`Created ${created} admin daily report notification(s).`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Admin daily report scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(
          ADMIN_SYSTEM_DAILY_REPORT_SCHEDULER_KEY,
          leaseToken
        );
      }
      this.running = false;
      this.leaseLost = false;
      this.scheduleNext(ADMIN_SYSTEM_DAILY_REPORT_POLL_INTERVAL_MS);
    }
  }
}
