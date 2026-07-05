/** ADR-138 D5 — default when plan billing hint `browserProfileTtlDays` is absent. */
export const DEFAULT_BROWSER_PROFILE_TTL_DAYS = 30;

export function resolveBrowserProfileTtlDays(
  plan: { browserProfileTtlDays?: number | null } | null | undefined
): number {
  const value = plan?.browserProfileTtlDays;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_BROWSER_PROFILE_TTL_DAYS;
}
