import { Injectable, Logger } from "@nestjs/common";
import {
  ANSWERED_WINDOW_HOURS,
  AUTO_MUTE_AFTER_UNANSWERED,
  AUTO_MUTE_DURATION_DAYS,
  MIN_INTERVAL_HOURS,
  QUIET_HOURS_END_LOCAL,
  QUIET_HOURS_START_LOCAL
} from "./proactive-push-policy.constants";

// ADR-074 Slice T1 — pure proactive-push policy evaluator.
//
// Hard constraints from the slice handoff prompt:
//   * #8  — five policy constants live in `./proactive-push-policy.constants.ts`.
//           NO admin surface, NO plan-policy fields, NO per-workspace overrides.
//   * #9  — quiet hours = DEFER to next 09:00 local; interval block = DEFER to
//           `lastFiredAt + 48h`; auto-mute = DEFER to `lastFiredAt + 14d` OR
//           release on ANY user-initiated message.
//   * #10 — auto-mute release is broader than "answered the specific push";
//           the 24h answered window only governs the unanswered counter.
//   * #11 — gate is for `audience="user"` ONLY. We defensively re-check inside
//           the evaluator and return `allow` for `audience="assistant"` so a
//           caller that wires the gate too eagerly cannot block assistant-side
//           work; the scheduler nonetheless skips the gate entirely on the
//           assistant path (locked by an explicit test assertion that this
//           service's mock is NOT invoked there).
//
// The evaluator is deliberately PURE: it accepts a snapshot of the relevant
// task row + the latest cross-thread user-reply timestamp + the workspace
// timezone, and returns both the action AND the new column values the
// scheduler should write back atomically with the claim release.

export type ProactivePushPolicyDecisionReason =
  | "auto_mute"
  | "interval"
  | "quiet_hours"
  | "audience_assistant";

export type ProactivePushPolicyDecision =
  | {
      readonly action: "allow";
      readonly consecutiveUnansweredAfter: number;
      readonly lastAnsweredCheckAtAfter: Date | null;
    }
  | {
      readonly action: "defer";
      readonly deferUntil: Date;
      readonly reason: ProactivePushPolicyDecisionReason;
      readonly consecutiveUnansweredAfter: number;
      readonly lastAnsweredCheckAtAfter: Date | null;
    };

export interface ProactivePushPolicyInput {
  readonly now: Date;
  readonly audience: "user" | "assistant";
  /**
   * IANA timezone identifier from `Workspace.timezone` (e.g. `"Europe/Moscow"`).
   * Falls back to UTC if the value is empty or unparseable; quiet-hours math
   * still runs but on UTC wall-clock — logged at warn level so we notice.
   */
  readonly timezone: string | null;
  readonly lastFiredAt: Date | null;
  readonly lastAnsweredCheckAt: Date | null;
  readonly consecutiveUnanswered: number;
  /**
   * Most recent user-initiated message timestamp anywhere for this
   * (assistantId, userId) pair, or `null` if no user message has ever been
   * sent. Composed by the scheduler from the existing M3.2 cross-thread
   * `lastUserMessageAt` data path — NO new repository method per hard
   * constraint #6.
   */
  readonly latestUserMessageAt: Date | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class ProactivePushPolicyService {
  private readonly logger = new Logger(ProactivePushPolicyService.name);

  evaluateProactivePush(input: ProactivePushPolicyInput): ProactivePushPolicyDecision {
    if (input.audience === "assistant") {
      // Defensive — see hard constraint #11. The scheduler skips the gate
      // entirely on the assistant path; this branch only protects against a
      // future caller that wires the gate too eagerly.
      return {
        action: "allow",
        consecutiveUnansweredAfter: input.consecutiveUnanswered,
        lastAnsweredCheckAtAfter: input.lastAnsweredCheckAt
      };
    }

    const { effectiveCounter, effectiveLastAnsweredCheckAt } = this.recomputeCounter(input);

    if (input.lastFiredAt !== null) {
      // Auto-mute check — auto-mute release on ANY user-initiated message
      // since `lastFiredAt` was already folded into `effectiveCounter` by
      // `recomputeCounter` (it resets to 0 on any newer user message).
      if (
        effectiveCounter >= AUTO_MUTE_AFTER_UNANSWERED &&
        input.now.getTime() < input.lastFiredAt.getTime() + AUTO_MUTE_DURATION_DAYS * DAY_MS
      ) {
        return {
          action: "defer",
          deferUntil: new Date(input.lastFiredAt.getTime() + AUTO_MUTE_DURATION_DAYS * DAY_MS),
          reason: "auto_mute",
          consecutiveUnansweredAfter: effectiveCounter,
          lastAnsweredCheckAtAfter: effectiveLastAnsweredCheckAt
        };
      }

      // Interval block.
      if (input.now.getTime() < input.lastFiredAt.getTime() + MIN_INTERVAL_HOURS * HOUR_MS) {
        return {
          action: "defer",
          deferUntil: new Date(input.lastFiredAt.getTime() + MIN_INTERVAL_HOURS * HOUR_MS),
          reason: "interval",
          consecutiveUnansweredAfter: effectiveCounter,
          lastAnsweredCheckAtAfter: effectiveLastAnsweredCheckAt
        };
      }
    }

    // Quiet-hours check.
    const quietDeferUntil = this.computeQuietHoursDefer(input.now, input.timezone);
    if (quietDeferUntil !== null) {
      return {
        action: "defer",
        deferUntil: quietDeferUntil,
        reason: "quiet_hours",
        consecutiveUnansweredAfter: effectiveCounter,
        lastAnsweredCheckAtAfter: effectiveLastAnsweredCheckAt
      };
    }

    return {
      action: "allow",
      consecutiveUnansweredAfter: effectiveCounter,
      lastAnsweredCheckAtAfter: effectiveLastAnsweredCheckAt
    };
  }

  /**
   * Lazy bookkeeping for the unanswered counter. Per ADR-074 Slice T1
   * hard constraints #9 + #10:
   *
   *   * Any user-initiated message after `lastFiredAt` releases the auto-mute
   *     and resets the counter to 0 (broader than "answered the specific push").
   *   * Otherwise: once `lastFiredAt + ANSWERED_WINDOW_HOURS` has elapsed AND
   *     we have not yet credited / penalised this specific push (tracked via
   *     `lastAnsweredCheckAt`), bump the counter by exactly 1. This is what
   *     makes "2 consecutive unanswered" terminate cleanly.
   *
   * `lastAnsweredCheckAt` is set to `lastFiredAt + ANSWERED_WINDOW_HOURS` (the
   * end of the window we just evaluated) so the bump fires exactly once per
   * push, regardless of how many times the scheduler re-evaluates the row.
   */
  private recomputeCounter(input: ProactivePushPolicyInput): {
    effectiveCounter: number;
    effectiveLastAnsweredCheckAt: Date | null;
  } {
    const counterIn = Math.max(0, input.consecutiveUnanswered | 0);

    if (input.lastFiredAt === null) {
      return {
        effectiveCounter: counterIn,
        effectiveLastAnsweredCheckAt: input.lastAnsweredCheckAt
      };
    }

    // Auto-mute release: any user-initiated message strictly after
    // `lastFiredAt` resets the counter to 0 (#10).
    if (
      input.latestUserMessageAt !== null &&
      input.latestUserMessageAt.getTime() > input.lastFiredAt.getTime()
    ) {
      return {
        effectiveCounter: 0,
        effectiveLastAnsweredCheckAt: input.lastAnsweredCheckAt
      };
    }

    const windowEndMs = input.lastFiredAt.getTime() + ANSWERED_WINDOW_HOURS * HOUR_MS;
    const alreadyEvaluated =
      input.lastAnsweredCheckAt !== null && input.lastAnsweredCheckAt.getTime() >= windowEndMs;

    if (input.now.getTime() >= windowEndMs && !alreadyEvaluated) {
      // Window elapsed and we have not yet bumped for this push: it counts
      // as unanswered (we already short-circuited on a user reply above).
      return {
        effectiveCounter: counterIn + 1,
        effectiveLastAnsweredCheckAt: new Date(windowEndMs)
      };
    }

    return {
      effectiveCounter: counterIn,
      effectiveLastAnsweredCheckAt: input.lastAnsweredCheckAt
    };
  }

  /**
   * Returns the next `QUIET_HOURS_END_LOCAL:00` local instant if `now` falls
   * inside the quiet-hours window, or `null` if the wall-clock is awake.
   */
  private computeQuietHoursDefer(now: Date, timezone: string | null): Date | null {
    const tz = this.resolveTimezone(timezone);
    const local = this.formatLocalParts(now, tz);
    if (local === null) {
      return null;
    }

    const inQuietWindow =
      local.hour >= QUIET_HOURS_START_LOCAL || local.hour < QUIET_HOURS_END_LOCAL;
    if (!inQuietWindow) {
      return null;
    }

    return this.computeNextLocalNineAm(now, tz, local);
  }

  private resolveTimezone(timezone: string | null): string {
    if (typeof timezone !== "string" || timezone.trim().length === 0) {
      return "UTC";
    }
    try {
      // Validate by constructing a formatter once.
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      this.logger.warn(
        `Workspace timezone "${timezone}" is not a valid IANA identifier; falling back to UTC for quiet-hours math.`
      );
      return "UTC";
    }
  }

  private formatLocalParts(
    now: Date,
    timezone: string
  ): { year: number; month: number; day: number; hour: number; minute: number } | null {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
      const parts = fmt.formatToParts(now);
      const get = (type: string): number => {
        const part = parts.find((p) => p.type === type);
        return part ? Number(part.value) : Number.NaN;
      };
      let hour = get("hour");
      // `Intl.DateTimeFormat` with `hour12: false` can emit "24" at midnight
      // in some engines — normalise.
      if (hour === 24) {
        hour = 0;
      }
      const result = {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour,
        minute: get("minute")
      };
      if (
        Number.isNaN(result.year) ||
        Number.isNaN(result.month) ||
        Number.isNaN(result.day) ||
        Number.isNaN(result.hour) ||
        Number.isNaN(result.minute)
      ) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Compute the next `QUIET_HOURS_END_LOCAL:00` wall-clock instant in the
   * user's timezone, returned as a UTC `Date`. Uses a small fixed-point
   * iteration to handle DST transitions correctly.
   */
  private computeNextLocalNineAm(
    now: Date,
    timezone: string,
    local: { year: number; month: number; day: number; hour: number; minute: number }
  ): Date {
    // Pick the local calendar date the next 09:00 belongs to: today if we're
    // still in the late-evening half of the quiet window (hour >= 22), else
    // today (we're in the pre-09:00 half).
    const targetLocalYear = local.year;
    const targetLocalMonth = local.month;
    let targetLocalDay = local.day;
    if (local.hour >= QUIET_HOURS_START_LOCAL) {
      // Roll to the next calendar day in local time.
      const tomorrow = this.addDaysInTz(now, 1, timezone);
      targetLocalDay = tomorrow.day;
      return this.solveLocalWallClock(
        tomorrow.year,
        tomorrow.month,
        targetLocalDay,
        QUIET_HOURS_END_LOCAL,
        0,
        timezone
      );
    }
    return this.solveLocalWallClock(
      targetLocalYear,
      targetLocalMonth,
      targetLocalDay,
      QUIET_HOURS_END_LOCAL,
      0,
      timezone
    );
  }

  private addDaysInTz(
    now: Date,
    days: number,
    timezone: string
  ): { year: number; month: number; day: number } {
    const next = new Date(now.getTime() + days * DAY_MS);
    const parts = this.formatLocalParts(next, timezone);
    if (parts === null) {
      // Fall back to UTC arithmetic.
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
    }
    return { year: parts.year, month: parts.month, day: parts.day };
  }

  /**
   * Solve for the UTC `Date` whose wall-clock projection in `timezone`
   * matches the requested local Y-M-D H:M. Uses the standard 2-pass
   * timezone offset trick which converges in one iteration outside DST gaps.
   */
  private solveLocalWallClock(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string
  ): Date {
    const targetUtcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const guess1 = new Date(targetUtcGuess);
    const offsetMs1 = this.computeTzOffsetMs(guess1, timezone);
    const adjusted1 = new Date(targetUtcGuess - offsetMs1);
    const offsetMs2 = this.computeTzOffsetMs(adjusted1, timezone);
    return new Date(targetUtcGuess - offsetMs2);
  }

  private computeTzOffsetMs(when: Date, timezone: string): number {
    const parts = this.formatLocalParts(when, timezone);
    if (parts === null) {
      return 0;
    }
    const localUtcReading = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      when.getUTCSeconds(),
      when.getUTCMilliseconds()
    );
    return localUtcReading - when.getTime();
  }
}
