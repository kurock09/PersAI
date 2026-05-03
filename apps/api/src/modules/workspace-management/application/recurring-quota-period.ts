export type RecurringQuotaPeriodSource = "subscription_period" | "calendar_month_fallback";

export type RecurringQuotaPeriodInput = {
  currentPeriodStartedAt?: string | null;
  currentPeriodEndsAt?: string | null;
};

export type RecurringQuotaPeriod = {
  periodStartedAt: Date;
  periodEndsAt: Date;
  periodSource: RecurringQuotaPeriodSource;
};

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfNextUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveRecurringQuotaPeriod(
  subscription: RecurringQuotaPeriodInput,
  now = new Date()
): RecurringQuotaPeriod {
  const periodStartedAt = parseIsoDate(subscription.currentPeriodStartedAt);
  const periodEndsAt = parseIsoDate(subscription.currentPeriodEndsAt);
  if (
    periodStartedAt !== null &&
    periodEndsAt !== null &&
    periodEndsAt.getTime() > periodStartedAt.getTime()
  ) {
    return {
      periodStartedAt,
      periodEndsAt,
      periodSource: "subscription_period"
    };
  }

  return {
    periodStartedAt: startOfUtcMonth(now),
    periodEndsAt: startOfNextUtcMonth(now),
    periodSource: "calendar_month_fallback"
  };
}
