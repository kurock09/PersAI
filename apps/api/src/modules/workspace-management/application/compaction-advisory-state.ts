import type { RuntimeSession } from "@prisma/client";

export const MIN_AUTO_COMPACTION_STREAK_FOR_EXHAUSTION = 3;
export const DEFAULT_COMPACTION_ADVISORY_SUPPRESSION_MINUTES = 60;

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

export function isCompactionExhaustedAtPlanLimit(input: {
  currentTokens: number | null;
  totalTokensFresh: boolean;
  reserveTokens: number;
  autoCompactionEnabled: boolean;
  recentAutoCompactionStreak: number;
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
  if (input.currentTokens < Math.max(1, input.reserveTokens)) {
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
