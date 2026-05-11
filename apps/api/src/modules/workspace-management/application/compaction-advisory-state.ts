import type { RuntimeSession } from "@prisma/client";

export const MIN_AUTO_COMPACTION_STREAK_FOR_EXHAUSTION = 3;
export const DEFAULT_COMPACTION_ADVISORY_SUPPRESSION_MINUTES = 60;
export const MIN_EFFECTIVE_AUTO_COMPACTION_REDUCTION_RATIO = 0.2;

export type RecentCompactionReasonRow = {
  reason: string | null;
};

export type CompactionAdvisoryState = {
  found: boolean;
  session: Pick<
    RuntimeSession,
    "id" | "currentTokens" | "totalTokensFresh" | "compactionCount" | "updatedAt"
  > | null;
  reserveTokens: number;
  autoCompactionEnabled: boolean;
  recentAutoCompactionStreak: number;
  exhaustedAtPlanLimit: boolean;
};

export function countRecentAutoCompactionStreak(
  rows: readonly RecentCompactionReasonRow[]
): number {
  let streak = 0;
  for (const row of rows) {
    if (row.reason !== "auto_compaction") {
      break;
    }
    streak += 1;
  }
  return streak;
}

export function isLatestAutoCompactionWeak(input: {
  latestCompactionBaselineTokens: number | null;
  currentTokens: number | null;
  totalTokensFresh: boolean;
  minReductionRatio?: number;
}): boolean {
  if (!input.totalTokensFresh || typeof input.currentTokens !== "number") {
    return false;
  }

  if (typeof input.latestCompactionBaselineTokens !== "number") {
    return false;
  }

  if (
    input.latestCompactionBaselineTokens <= 0 ||
    input.currentTokens >= input.latestCompactionBaselineTokens
  ) {
    return true;
  }

  const reductionRatio =
    (input.latestCompactionBaselineTokens - input.currentTokens) /
    input.latestCompactionBaselineTokens;
  return (
    reductionRatio < (input.minReductionRatio ?? MIN_EFFECTIVE_AUTO_COMPACTION_REDUCTION_RATIO)
  );
}

export function isCompactionExhaustedAtPlanLimit(input: {
  currentTokens: number | null;
  totalTokensFresh: boolean;
  reserveTokens: number;
  autoCompactionEnabled: boolean;
  recentAutoCompactionStreak: number;
  latestAutoCompactionWeak?: boolean;
}): boolean {
  if (!input.autoCompactionEnabled) {
    return false;
  }
  if (!input.totalTokensFresh) {
    return false;
  }
  if (typeof input.currentTokens !== "number") {
    return false;
  }
  const reachedPlanLimit = input.currentTokens >= Math.max(1, input.reserveTokens);
  const compactionStalled = input.latestAutoCompactionWeak === true;
  if (!reachedPlanLimit && !compactionStalled) {
    return false;
  }
  return input.recentAutoCompactionStreak >= MIN_AUTO_COMPACTION_STREAK_FOR_EXHAUSTION;
}

export function resolveCompactionAdvisorySuppressionMinutes(input: {
  policyCooldownMinutes: number | null;
  config: Record<string, unknown>;
}): number {
  const configured = input.config["compactionAdvisorySuppressionMinutes"];
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.floor(configured));
  }
  if (
    typeof input.policyCooldownMinutes === "number" &&
    Number.isFinite(input.policyCooldownMinutes) &&
    input.policyCooldownMinutes > 0
  ) {
    return Math.max(1, Math.floor(input.policyCooldownMinutes));
  }
  return DEFAULT_COMPACTION_ADVISORY_SUPPRESSION_MINUTES;
}

export function buildCompactionAdvisoryDedupeKey(input: {
  assistantId: string;
  surface: "web" | "telegram";
  surfaceThreadKey: string;
  suppressionMinutes: number;
  now?: Date;
}): string {
  const windowMs = Math.max(1, input.suppressionMinutes) * 60_000;
  const now = input.now ?? new Date();
  const suppressionBucket = Math.floor(now.getTime() / windowMs);
  return [
    "compaction_advisory",
    input.assistantId,
    input.surface,
    input.surfaceThreadKey,
    String(suppressionBucket)
  ].join(":");
}

export function isCompactionExhaustedAdvisoryPayload(
  value: unknown
): value is { advisoryKind: "compaction_exhausted" } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).advisoryKind === "compaction_exhausted"
  );
}
