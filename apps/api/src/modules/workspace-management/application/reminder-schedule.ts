import { Cron } from "croner";

export type ReminderSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

const CRON_EVAL_CACHE_MAX = 256;
const cronEvalCache = new Map<string, Cron>();

function resolveCronTimezone(tz?: string): string {
  const trimmed = typeof tz === "string" ? tz.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function resolveCachedCron(expr: string, timezone: string): Cron {
  const key = `${timezone}\u0000${expr}`;
  const cached = cronEvalCache.get(key);
  if (cached) {
    return cached;
  }
  if (cronEvalCache.size >= CRON_EVAL_CACHE_MAX) {
    const oldest = cronEvalCache.keys().next().value;
    if (oldest) {
      cronEvalCache.delete(oldest);
    }
  }
  const next = new Cron(expr, { timezone, catch: false });
  cronEvalCache.set(key, next);
  return next;
}

function resolveCron(schedule: { expr?: unknown; tz?: unknown }): Cron {
  const expr = typeof schedule.expr === "string" ? schedule.expr.trim() : "";
  if (!expr) {
    throw new Error("invalid reminder cron schedule: expr is required");
  }
  const tz = typeof schedule.tz === "string" ? schedule.tz : undefined;
  return resolveCachedCron(expr, resolveCronTimezone(tz));
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseAbsoluteTimeMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseReminderSchedule(value: unknown): ReminderSchedule | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (row.kind === "at") {
    const at = typeof row.at === "string" ? row.at.trim() : "";
    return at ? { kind: "at", at } : null;
  }
  if (row.kind === "every") {
    const everyMs = coerceFiniteNumber(row.everyMs);
    if (everyMs === undefined || everyMs < 1) {
      return null;
    }
    const anchorMs = coerceFiniteNumber(row.anchorMs);
    return {
      kind: "every",
      everyMs: Math.max(1, Math.floor(everyMs)),
      ...(anchorMs === undefined ? {} : { anchorMs: Math.max(0, Math.floor(anchorMs)) })
    };
  }
  if (row.kind === "cron") {
    const expr = typeof row.expr === "string" ? row.expr.trim() : "";
    const tz = typeof row.tz === "string" ? row.tz.trim() : "";
    if (!expr) {
      return null;
    }
    return {
      kind: "cron",
      expr,
      ...(tz ? { tz } : {})
    };
  }
  return null;
}

export function computeReminderNextRunAtMs(
  schedule: ReminderSchedule,
  nowMs: number
): number | undefined {
  if (schedule.kind === "at") {
    const atMs = parseAbsoluteTimeMs(schedule.at);
    if (atMs === null) {
      return undefined;
    }
    return atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === "every") {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) {
      return anchor;
    }
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
    return anchor + steps * everyMs;
  }

  const cron = resolveCron(schedule);
  const next = cron.nextRun(new Date(nowMs));
  if (!next) {
    return undefined;
  }
  const nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) {
    return undefined;
  }

  if (nextMs <= nowMs) {
    const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
    const retry = cron.nextRun(new Date(nextSecondMs));
    if (retry) {
      const retryMs = retry.getTime();
      if (Number.isFinite(retryMs) && retryMs > nowMs) {
        return retryMs;
      }
    }
    const tomorrowMs = new Date(nowMs).setUTCHours(24, 0, 0, 0);
    const retryTomorrow = cron.nextRun(new Date(tomorrowMs));
    if (retryTomorrow) {
      const retryTomorrowMs = retryTomorrow.getTime();
      if (Number.isFinite(retryTomorrowMs) && retryTomorrowMs > nowMs) {
        return retryTomorrowMs;
      }
    }
    return undefined;
  }

  return nextMs;
}

export function clearReminderScheduleCacheForTest(): void {
  cronEvalCache.clear();
}
