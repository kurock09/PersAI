import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  NotificationClass,
  NotificationPriority,
  NotificationRenderStrategy
} from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { NotificationIntentService } from "./notifications/notification-intent.service";
import {
  DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG,
  type AdminSystemEventCode,
  type AdminSystemPolicyConfig,
  getAdminSystemEventDefinition,
  parseAdminSystemPolicyConfig,
  enrichAdminSystemSummaryWithUser
} from "./notifications/admin-system-config";
import { readPlatformSucceededPaymentsAllTime } from "./admin-ops-period-economics";

type RecipientAssistant = {
  id: string;
  userId: string;
  workspaceId: string;
  draftDisplayName: string | null;
  workspace: {
    timezone: string;
  };
};

export type AdminSystemEventInput = {
  eventCode: AdminSystemEventCode;
  summary: string;
  details?: Record<string, unknown>;
  traceId?: string | null;
  occurredAt?: string;
  notificationClass?: NotificationClass;
  priority?: NotificationPriority;
  scheduledAt?: Date | null;
};

type PolicyState = {
  enabled: boolean;
  config: AdminSystemPolicyConfig;
};

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

@Injectable()
export class AdminSystemNotificationProducerService {
  private readonly logger = new Logger(AdminSystemNotificationProducerService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly notificationIntentService: NotificationIntentService
  ) {}

  async emitEvent(input: AdminSystemEventInput): Promise<number> {
    const policy = await this.resolvePolicyState();
    if (!policy.enabled) {
      return 0;
    }
    if (!policy.config.eventCodes.includes(input.eventCode)) {
      return 0;
    }

    const recipients = await this.resolveRecipientAssistants(policy.config.recipientAssistantIds);
    if (recipients.length === 0) {
      return 0;
    }

    const definition = getAdminSystemEventDefinition(input.eventCode);
    const notificationClass = input.notificationClass ?? definition?.notificationClass;
    if (notificationClass === undefined) {
      return 0;
    }

    let emitted = 0;
    const scheduledAt = input.scheduledAt ?? null;
    const priority =
      input.priority ??
      (scheduledAt !== null && scheduledAt.getTime() > Date.now()
        ? NotificationPriority.scheduled
        : NotificationPriority.immediate);
    const details = input.details ?? {};
    const message = enrichAdminSystemSummaryWithUser(input.eventCode, input.summary, details);
    for (const recipient of recipients) {
      try {
        await this.notificationIntentService.createIntent({
          workspaceId: recipient.workspaceId,
          assistantId: recipient.id,
          userId: recipient.userId,
          source: "admin_system",
          class: notificationClass,
          priority,
          renderStrategy: NotificationRenderStrategy.static_fallback,
          factPayload: {
            message,
            eventCode: input.eventCode,
            details,
            occurredAt: input.occurredAt ?? new Date().toISOString()
          },
          allowedChannels: ["user_preferred"],
          dedupeKey: input.traceId
            ? `admin_system:${input.eventCode}:${input.traceId}:${recipient.id}`
            : null,
          scheduledAt,
          respectQuietHours: false,
          traceId: input.traceId ?? null
        });
        emitted += 1;
      } catch (error) {
        this.logger.warn(
          `Admin system event ${input.eventCode} failed for recipient ${recipient.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return emitted;
  }

  async processDueDailyReports(now = new Date()): Promise<number> {
    const policy = await this.resolvePolicyState();
    if (!policy.enabled || !policy.config.dailyReportEnabled) {
      return 0;
    }

    const recipients = await this.resolveRecipientAssistants(policy.config.recipientAssistantIds);
    if (recipients.length === 0) {
      return 0;
    }

    let emitted = 0;
    for (const recipient of recipients) {
      const timezone = this.resolveTimezone(recipient.workspace.timezone);
      const local = this.formatLocalParts(now, timezone);
      if (local === null) {
        continue;
      }
      if (!this.hasReachedDailyReportTime(local, policy.config.dailyReportTimeLocal)) {
        continue;
      }

      const localDateKey = this.toLocalDateKey(local);
      const { startedAt, endedAt } = await this.resolveUtcWindowForLocalDate(
        localDateKey,
        timezone
      );
      const message = await this.buildDailyReportMessage(startedAt, endedAt);
      const reportTraceId = `admin_system_daily:${localDateKey}:${recipient.id}`;

      try {
        await this.notificationIntentService.createIntent({
          workspaceId: recipient.workspaceId,
          assistantId: recipient.id,
          userId: recipient.userId,
          source: "admin_system",
          class: NotificationClass.administrative,
          priority: NotificationPriority.immediate,
          renderStrategy: NotificationRenderStrategy.static_fallback,
          factPayload: {
            message,
            eventCode: "daily_report",
            details: {
              reportDate: localDateKey,
              timezone,
              startedAt: startedAt.toISOString(),
              endedAt: endedAt.toISOString()
            },
            occurredAt: now.toISOString()
          },
          allowedChannels: ["user_preferred"],
          dedupeKey: reportTraceId,
          respectQuietHours: false,
          traceId: reportTraceId
        });
        emitted += 1;
      } catch (error) {
        this.logger.warn(
          `Admin daily report failed for recipient ${recipient.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return emitted;
  }

  private async buildDailyReportMessage(startedAt: Date, endedAt: Date): Promise<string> {
    const [
      dailyRevenueRows,
      dailyPaymentsCount,
      dailyCostAggregate,
      allTimeCostAggregate,
      newUsersToday,
      applyFailedToday,
      applyDegradedToday,
      unresolvedDeadLetters,
      allTimeRevenue
    ] = await Promise.all([
      this.prisma.workspacePaymentIntent.groupBy({
        by: ["currency"],
        where: {
          status: "succeeded",
          updatedAt: {
            gte: startedAt,
            lt: endedAt
          }
        },
        _sum: { amountMinor: true }
      }),
      this.prisma.workspacePaymentIntent.count({
        where: {
          status: "succeeded",
          updatedAt: {
            gte: startedAt,
            lt: endedAt
          }
        }
      }),
      this.prisma.modelCostLedgerEvent.aggregate({
        where: {
          currency: "USD",
          occurredAt: {
            gte: startedAt,
            lt: endedAt
          }
        },
        _sum: { actualCostMicros: true }
      }),
      this.prisma.modelCostLedgerEvent.aggregate({
        where: { currency: "USD" },
        _sum: { actualCostMicros: true }
      }),
      this.prisma.appUser.count({
        where: {
          createdAt: {
            gte: startedAt,
            lt: endedAt
          }
        }
      }),
      this.prisma.assistantAuditEvent.count({
        where: {
          eventCode: "assistant.runtime.apply_failed",
          createdAt: {
            gte: startedAt,
            lt: endedAt
          }
        }
      }),
      this.prisma.assistantAuditEvent.count({
        where: {
          eventCode: "assistant.runtime.apply_degraded",
          createdAt: {
            gte: startedAt,
            lt: endedAt
          }
        }
      }),
      this.prisma.notificationDeadLetter.count({
        where: { resolvedAt: null }
      }),
      readPlatformSucceededPaymentsAllTime(this.prisma)
    ]);

    const dailyCostUsdMicros = this.normalizeAggregateMicros(
      dailyCostAggregate._sum.actualCostMicros
    );
    const allTimeCostUsdMicros = this.normalizeAggregateMicros(
      allTimeCostAggregate._sum.actualCostMicros
    );

    const lines = [
      `PersAI daily admin report`,
      ``,
      `Today`,
      `- New users: ${newUsersToday}`,
      `- Successful payments: ${dailyPaymentsCount}`,
      `- Revenue: ${this.formatPaymentRows(dailyRevenueRows)}`,
      `- Cost: USD ${this.formatUsdMicros(dailyCostUsdMicros)}`,
      `- Runtime apply failed: ${applyFailedToday}`,
      `- Runtime apply degraded: ${applyDegradedToday}`,
      `- Unresolved dead letters: ${unresolvedDeadLetters}`,
      ``,
      `All time`,
      `- Revenue: ${this.formatAllTimeRevenue(allTimeRevenue)}`,
      `- Cost: USD ${this.formatUsdMicros(allTimeCostUsdMicros)}`
    ];

    return lines.join("\n");
  }

  private normalizeAggregateMicros(
    value: Prisma.Decimal | bigint | number | null | undefined
  ): number {
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "number") {
      return value;
    }
    if (value == null) {
      return 0;
    }
    return Number(value);
  }

  private formatUsdMicros(value: number): string {
    return (value / 1_000_000).toFixed(2);
  }

  private formatPaymentRows(
    rows: Array<{
      currency: string;
      _sum: { amountMinor: number | null };
    }>
  ): string {
    if (rows.length === 0) {
      return "none";
    }
    return rows
      .filter((row) => (row._sum.amountMinor ?? 0) > 0)
      .map((row) => {
        const totalMinor = row._sum.amountMinor ?? 0;
        return `${row.currency.toUpperCase()} ${(totalMinor / 100).toFixed(2)}`;
      })
      .join(", ");
  }

  private formatAllTimeRevenue(input: { rubTotalMinor: number; usdTotalMinor: number }): string {
    const entries: string[] = [];
    if (input.rubTotalMinor > 0) {
      entries.push(`RUB ${(input.rubTotalMinor / 100).toFixed(2)}`);
    }
    if (input.usdTotalMinor > 0) {
      entries.push(`USD ${(input.usdTotalMinor / 100).toFixed(2)}`);
    }
    return entries.length > 0 ? entries.join(", ") : "none";
  }

  private async resolvePolicyState(): Promise<PolicyState> {
    const row = await this.prisma.notificationPolicy.findUnique({
      where: { source: "admin_system" },
      select: {
        enabled: true,
        channels: true,
        config: true
      }
    });

    if (row === null) {
      return {
        enabled: true,
        config: { ...DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG }
      };
    }

    return {
      enabled: row.enabled,
      config: parseAdminSystemPolicyConfig(row.config)
    };
  }

  private async resolveRecipientAssistants(
    recipientAssistantIds: string[]
  ): Promise<RecipientAssistant[]> {
    if (recipientAssistantIds.length === 0) {
      return [];
    }
    return this.prisma.assistant.findMany({
      where: {
        id: { in: recipientAssistantIds }
      },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        draftDisplayName: true,
        workspace: {
          select: {
            timezone: true
          }
        }
      }
    });
  }

  private resolveTimezone(timezone: string | null): string {
    if (typeof timezone !== "string" || timezone.trim().length === 0) {
      return "UTC";
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      this.logger.warn(`Invalid admin-system timezone "${timezone}", using UTC.`);
      return "UTC";
    }
  }

  private formatLocalParts(now: Date, timezone: string): LocalDateTimeParts | null {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
      const parts = formatter.formatToParts(now);
      const read = (type: string): number => {
        const part = parts.find((entry) => entry.type === type);
        return part ? Number(part.value) : Number.NaN;
      };
      let hour = read("hour");
      if (hour === 24) {
        hour = 0;
      }
      const result = {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour,
        minute: read("minute")
      };
      if (Object.values(result).some((value) => Number.isNaN(value))) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  }

  private hasReachedDailyReportTime(local: LocalDateTimeParts, timeLocal: string): boolean {
    const [hourRaw, minuteRaw] = timeLocal.split(":");
    const targetHour = Number(hourRaw);
    const targetMinute = Number(minuteRaw);
    if (
      Number.isNaN(targetHour) ||
      Number.isNaN(targetMinute) ||
      targetHour < 0 ||
      targetHour > 23 ||
      targetMinute < 0 ||
      targetMinute > 59
    ) {
      return false;
    }
    const currentMinutes = local.hour * 60 + local.minute;
    const targetMinutes = targetHour * 60 + targetMinute;
    return currentMinutes >= targetMinutes;
  }

  private toLocalDateKey(local: LocalDateTimeParts): string {
    return `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(
      local.day
    ).padStart(2, "0")}`;
  }

  private async resolveUtcWindowForLocalDate(
    localDateKey: string,
    timezone: string
  ): Promise<{ startedAt: Date; endedAt: Date }> {
    const rows = await this.prisma.$queryRaw<Array<{ startedAt: Date; endedAt: Date }>>(Prisma.sql`
      SELECT
        (${localDateKey}::date::timestamp AT TIME ZONE ${timezone}) AS "startedAt",
        (((${localDateKey}::date + INTERVAL '1 day')::timestamp) AT TIME ZONE ${timezone}) AS "endedAt"
    `);
    const row = rows[0];
    return {
      startedAt: row?.startedAt ?? new Date(0),
      endedAt: row?.endedAt ?? new Date()
    };
  }
}
