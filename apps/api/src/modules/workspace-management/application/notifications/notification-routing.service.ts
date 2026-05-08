import { Injectable } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  NotificationPolicyRow,
  RoutingPlan
} from "./notification-platform.types";
import {
  NotificationChannelHealth,
  NotificationPriority,
  NotificationQuietHoursTimezoneMode
} from "./notification-platform.types";

type QuietHoursInput = {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: NotificationQuietHoursTimezoneMode;
  defaultTimezone: string | null;
  appliesToSources: string[];
} | null;

type IntentTimingInput = {
  priority: NotificationPriority;
  respectQuietHours: boolean;
};

/**
 * Pure routing logic service.
 * Given intent + policy + channel registry health, returns ordered channels
 * and escalation plan. Has no side effects, no DB writes.
 * ADR-088 §Service architecture – notification-routing.service.ts.
 */
@Injectable()
export class NotificationRoutingService {
  /**
   * Resolve the primary delivery channel and escalation plan for an intent.
   * Returns null primaryChannel when no eligible channel is available.
   */
  resolveRoutingPlan(input: {
    allowedChannels: string[];
    policy: Pick<
      NotificationPolicyRow,
      "escalationAfterMinutes" | "escalationChannel" | "respectQuietHours"
    > | null;
    channelRegistry: ChannelRegistryRow[];
    escalationAfterMinutes: number | null;
    escalationChannel: string | null;
    priority: NotificationPriority;
    respectQuietHours: boolean;
    quietHours: QuietHoursInput;
    source: string;
  }): RoutingPlan {
    const healthyByType = new Map(
      input.channelRegistry.map((r) => [r.channelType as string, r.healthStatus])
    );

    // Find first allowed channel that is not down
    const primaryChannel = input.allowedChannels.find((ch) => {
      const health = healthyByType.get(ch);
      return health !== undefined && health !== NotificationChannelHealth.down;
    });

    const deferUntil = this.computeQuietHoursDeferral({
      intent: { priority: input.priority, respectQuietHours: input.respectQuietHours },
      quietHours: input.quietHours,
      source: input.source
    });

    const skipReason = primaryChannel === undefined ? "no_eligible_channel" : null;

    return {
      primaryChannel: primaryChannel ?? "",
      escalationChannel: input.escalationChannel ?? input.policy?.escalationChannel ?? null,
      escalationAfterMinutes:
        input.escalationAfterMinutes ?? input.policy?.escalationAfterMinutes ?? null,
      respectQuietHours: input.respectQuietHours,
      deferUntil,
      skipReason
    };
  }

  /**
   * Compute quiet-hours deferral time for a non-immediate intent.
   * Returns the Date to defer until, or null if no deferral needed.
   */
  computeQuietHoursDeferral(input: {
    intent: IntentTimingInput;
    quietHours: QuietHoursInput;
    source: string;
  }): Date | null {
    const { intent, quietHours } = input;

    // immediate priority always overrides quiet hours
    if (intent.priority === NotificationPriority.immediate) {
      return null;
    }

    if (!intent.respectQuietHours) {
      return null;
    }

    if (!quietHours?.enabled) {
      return null;
    }

    if (!quietHours.appliesToSources.includes(input.source)) {
      return null;
    }

    const tz = this.resolveTimezone(quietHours);
    const now = new Date();

    if (!this.isInsideQuietWindow(now, quietHours.startLocal, quietHours.endLocal, tz)) {
      return null;
    }

    // Defer to end of quiet window
    return this.nextWindowEnd(now, quietHours.endLocal, tz);
  }

  private resolveTimezone(quietHours: {
    timezoneMode: NotificationQuietHoursTimezoneMode;
    defaultTimezone: string | null;
  }): string {
    if (
      quietHours.timezoneMode === NotificationQuietHoursTimezoneMode.workspace_default &&
      quietHours.defaultTimezone
    ) {
      return quietHours.defaultTimezone;
    }
    return "UTC";
  }

  private isInsideQuietWindow(
    now: Date,
    startLocal: string,
    endLocal: string,
    tz: string
  ): boolean {
    try {
      const localTime = this.getLocalHHMM(now, tz);
      const start = this.parseHHMM(startLocal);
      const end = this.parseHHMM(endLocal);
      const current = this.parseHHMM(localTime);

      if (start <= end) {
        return current >= start && current < end;
      }
      // overnight window e.g. 22:00 – 08:00
      return current >= start || current < end;
    } catch {
      return false;
    }
  }

  private nextWindowEnd(now: Date, endLocal: string, tz: string): Date {
    try {
      // Use a full date+time formatter so we can compute the tz UTC offset.
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      const parts = formatter.formatToParts(now);
      const year = Number(parts.find((p) => p.type === "year")?.value);
      const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
      const day = Number(parts.find((p) => p.type === "day")?.value);
      const lHour = Number(parts.find((p) => p.type === "hour")?.value);
      const lMin = Number(parts.find((p) => p.type === "minute")?.value);
      const lSec = Number(parts.find((p) => p.type === "second")?.value);

      // Derive the UTC offset for tz at now (handles DST correctly).
      const localAsUtcMs = Date.UTC(year, month, day, lHour, lMin, lSec);
      const tzOffsetMs = localAsUtcMs - now.getTime();

      // Build "today at endLocal in tz" as a UTC timestamp.
      const [endH = 0, endM = 0] = endLocal.split(":").map(Number);
      const endAsUtcMs = Date.UTC(year, month, day, endH, endM, 0) - tzOffsetMs;
      const deferUntil = new Date(endAsUtcMs);

      // If already past (overnight window end is on the next calendar day), add 24 h.
      if (deferUntil <= now) {
        deferUntil.setTime(deferUntil.getTime() + 24 * 60 * 60 * 1000);
      }
      return deferUntil;
    } catch {
      // Fallback: defer 8 hours
      return new Date(now.getTime() + 8 * 60 * 60 * 1000);
    }
  }

  private getLocalHHMM(date: Date, tz: string): string {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
  }

  private parseHHMM(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }
}
