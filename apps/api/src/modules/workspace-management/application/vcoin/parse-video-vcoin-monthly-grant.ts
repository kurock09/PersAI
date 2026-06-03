/**
 * ADR-108 Slice 3 — shared parser for a plan's monthly Vcoin grant field.
 *
 * Extracted from the private `toVideoVcoinMonthlyGrant` helper in
 * `manage-admin-plans.service.ts` so the grant service can also read
 * plan grant values without going through the admin-only plan service.
 *
 * **Behavior contract:**
 *   - `value` is a valid non-negative integer  → returns it as-is.
 *   - `value` is missing / null / undefined / non-number / non-integer /
 *     negative                                 → returns 0 (conservative default).
 *
 * The zero default is intentional: it is safe (no money moves), and an
 * honest zero is a better fallback than throwing when admin input is
 * slightly malformed. Callers that need strict validation (e.g. admin write
 * paths) should add their own guards on top of this helper.
 */
export function parseVideoVcoinMonthlyGrant(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return 0;
}
